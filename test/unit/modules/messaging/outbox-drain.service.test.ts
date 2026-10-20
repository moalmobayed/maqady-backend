import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../../../src/common/config/types';
import type { DataEncryptionService } from '../../../../src/common/crypto/data-encryption.service';
import { AppError } from '../../../../src/common/errors/app-error';
import { MessageTemplateRegistry } from '../../../../src/modules/messaging/message-template.registry';
import type { MessagesRepository } from '../../../../src/modules/messaging/messages.repository';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import type { ClaimedMessage, SendOutcome } from '../../../../src/modules/messaging/types';
import { TestClock } from '../../../support/clock';
import { oneTimeLinkTemplate, smsNoticeTemplate } from '../../../support/messaging/test-templates';

const NOW = new Date('2026-10-20T10:00:00Z');
const TOKEN = 'drain-unit-token-abcdef';

function email(id: number, attempts = 0): ClaimedMessage {
  return {
    id,
    channel: 'email',
    template: 'test.one_time_link',
    recipient: `guest${id}@example.com`,
    attempts,
    payload_ciphertext: JSON.stringify({ name: 'Guest', token: TOKEN }),
  };
}

function sms(id: number): ClaimedMessage {
  return {
    id,
    channel: 'sms',
    template: 'test.sms_notice',
    recipient: '+201001234567',
    attempts: 0,
    payload_ciphertext: JSON.stringify({ text: 'Moved to 21:30' }),
  };
}

function setup(batches: ClaimedMessage[][] = []) {
  const messages = {
    claimDue: jest.fn(),
    markSent: jest.fn().mockResolvedValue(undefined),
    markRetry: jest.fn().mockResolvedValue(undefined),
    markThrottled: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
  for (const batch of batches) messages.claimDue.mockResolvedValueOnce(batch);
  messages.claimDue.mockResolvedValue([]);
  // The "ciphertext" is the plain JSON here; decryption is checked against the AAD.
  const encryption = {
    decrypt: jest.fn((ciphertext: string, aad: string) => {
      if (!aad.startsWith('messages:')) throw new AppError('INTERNAL');
      return ciphertext;
    }),
  };
  const emailSender = {
    send: jest.fn<Promise<SendOutcome>, [{ messageId: number }]>((message) =>
      Promise.resolve({ kind: 'sent', providerMessageId: `re-${message.messageId}` }),
    ),
  };
  const smsSender = {
    send: jest.fn<Promise<SendOutcome>, [{ messageId: number }]>((message) =>
      Promise.resolve({ kind: 'sent', providerMessageId: `simulated-sms-${message.messageId}` }),
    ),
  };
  const registry = new MessageTemplateRegistry();
  registry.register(oneTimeLinkTemplate);
  registry.register(smsNoticeTemplate);
  const clock = new TestClock(NOW);
  const service = new OutboxDrainService(
    { frontendBaseUrl: 'https://maqady.example' } as AppConfig,
    messages as unknown as MessagesRepository,
    registry,
    encryption as unknown as DataEncryptionService,
    clock,
    emailSender,
    smsSender,
  );
  return { service, messages, encryption, emailSender, smsSender, clock };
}

describe('OutboxDrainService.drain', () => {
  let logs: unknown[];

  beforeEach(() => {
    logs = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(message);
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logs.push(message);
    });
  });

  it('claims 10 due messages with a 5-minute lease and sends each with the real link', async () => {
    const { service, messages, emailSender } = setup([[email(1)]]);
    await expect(service.drain('batch')).resolves.toEqual({
      claimed: 1,
      sent: 1,
      retried: 0,
      throttled: 0,
      failed: 0,
    });
    expect(messages.claimDue).toHaveBeenCalledWith(NOW, new Date('2026-10-20T10:05:00Z'), 10);
    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 1,
        to: 'guest1@example.com',
        text: expect.stringContaining(`https://maqady.example/verify-email?token=${TOKEN}`),
      }),
    );
    expect(messages.markSent).toHaveBeenCalledWith(1, 're-1', NOW);
  });

  it('decrypts each payload bound to its own row', async () => {
    const { service, encryption } = setup([[email(4)]]);
    await service.drain('batch');
    expect(encryption.decrypt).toHaveBeenCalledWith(expect.any(String), 'messages:4');
  });

  it('records a temporary failure with the backoff for that attempt', async () => {
    const { service, messages, emailSender } = setup([[email(1, 0), email(2, 3), email(3, 7)]]);
    emailSender.send.mockResolvedValue({ kind: 'retry', errorCode: 'application_error' });
    await expect(service.drain('batch')).resolves.toMatchObject({ claimed: 3, retried: 3 });
    expect(messages.markRetry.mock.calls).toEqual([
      [1, 1, new Date('2026-10-20T10:01:00Z'), 'application_error', NOW],
      [2, 4, new Date('2026-10-20T11:00:00Z'), 'application_error', NOW],
      [3, 8, new Date('2026-10-20T16:00:00Z'), 'application_error', NOW],
    ]);
  });

  it('fails a message on its 10th temporary failure', async () => {
    const { service, messages, emailSender } = setup([[email(1, 9)]]);
    emailSender.send.mockResolvedValue({ kind: 'retry', errorCode: 'application_error' });
    await expect(service.drain('batch')).resolves.toMatchObject({ failed: 1, retried: 0 });
    expect(messages.markFailed).toHaveBeenCalledWith(1, 10, 'attempts_exhausted', NOW);
    expect(messages.markRetry).not.toHaveBeenCalled();
  });

  it('fails a rejected message at once, counting the attempt', async () => {
    const { service, messages, emailSender } = setup([[email(1, 2)]]);
    emailSender.send.mockResolvedValue({ kind: 'rejected', errorCode: 'validation_error' });
    await expect(service.drain('batch')).resolves.toMatchObject({ failed: 1 });
    expect(messages.markFailed).toHaveBeenCalledWith(1, 3, 'validation_error', NOW);
  });

  it('stops at a 429: the batch’s other emails wait for the same instant, its SMS still go', async () => {
    const retryAt = new Date('2026-10-21T00:00:00Z');
    const { service, messages, emailSender, smsSender } = setup([
      [email(1), email(2), sms(3), email(4)],
      [email(5)],
    ]);
    emailSender.send.mockResolvedValueOnce({
      kind: 'throttled',
      errorCode: 'daily_quota_exceeded',
      retryAt,
    });

    await expect(service.drain('flush')).resolves.toEqual({
      claimed: 4,
      sent: 1,
      retried: 0,
      throttled: 3,
      failed: 0,
    });
    expect(emailSender.send).toHaveBeenCalledTimes(1);
    expect(smsSender.send).toHaveBeenCalledTimes(1);
    expect(messages.markThrottled.mock.calls).toEqual([
      [[1], retryAt, 'daily_quota_exceeded', NOW],
      [[2], retryAt, 'daily_quota_exceeded', NOW],
      [[4], retryAt, 'daily_quota_exceeded', NOW],
    ]);
    expect(messages.markSent).toHaveBeenCalledWith(3, 'simulated-sms-3', NOW);
    // The 429 ended the flush: the second batch was never claimed.
    expect(messages.claimDue).toHaveBeenCalledTimes(1);
  });

  it('retries a message whose template this release does not know', async () => {
    const { service, messages, emailSender } = setup([
      [{ ...email(1), template: 'later.unit_template' }],
    ]);
    await expect(service.drain('batch')).resolves.toMatchObject({ retried: 1 });
    expect(emailSender.send).not.toHaveBeenCalled();
    expect(messages.markRetry).toHaveBeenCalledWith(
      1,
      1,
      new Date('2026-10-20T10:01:00Z'),
      'template_unknown',
      NOW,
    );
  });

  it('retries a message whose payload cannot be decrypted or parsed', async () => {
    const { service, messages, encryption } = setup([
      [email(1), { ...email(2), payload_ciphertext: 'not json' }],
    ]);
    encryption.decrypt.mockImplementationOnce(() => {
      throw new AppError('INTERNAL', 'A stored value could not be decrypted.');
    });
    await expect(service.drain('batch')).resolves.toMatchObject({ retried: 2 });
    expect(messages.markRetry.mock.calls.map((call) => call[3] as string)).toEqual([
      'render_failed',
      'render_failed',
    ]);
  });

  it('treats a sender that throws as a retry, and stores no unsafe error code', async () => {
    const { service, messages, emailSender } = setup([[email(1), email(2)]]);
    emailSender.send.mockRejectedValueOnce(new Error('boom'));
    emailSender.send.mockResolvedValueOnce({
      kind: 'retry',
      errorCode: 'Upstream said: guest2@example.com',
    });
    await service.drain('batch');
    expect(messages.markRetry.mock.calls.map((call) => call[3] as string)).toEqual([
      'network_error',
      'provider_error',
    ]);
  });

  it('runs one batch for batch mode, and up to 10 batches until one is empty for flush', async () => {
    const full = (start: number) => Array.from({ length: 10 }, (_, index) => email(start + index));
    const batchRun = setup([full(1), full(11)]);
    await expect(batchRun.service.drain('batch')).resolves.toMatchObject({ claimed: 10 });
    expect(batchRun.messages.claimDue).toHaveBeenCalledTimes(1);

    const shortFlush = setup([full(1), [email(11)]]);
    await expect(shortFlush.service.drain('flush')).resolves.toMatchObject({
      claimed: 11,
      sent: 11,
    });
    expect(shortFlush.messages.claimDue).toHaveBeenCalledTimes(3);

    const longFlush = setup(Array.from({ length: 12 }, (_, index) => full(index * 10 + 1)));
    await expect(longFlush.service.drain('flush')).resolves.toMatchObject({ claimed: 100 });
    expect(longFlush.messages.claimDue).toHaveBeenCalledTimes(10);
  });

  it('logs one line per message without the recipient or the body', async () => {
    const { service, emailSender } = setup([[email(1), sms(2)]]);
    emailSender.send.mockResolvedValueOnce({ kind: 'retry', errorCode: 'application_error' });
    await service.drain('batch');
    expect(logs).toEqual([
      {
        messageId: 1,
        template: 'test.one_time_link',
        channel: 'email',
        outcome: 'retry',
        errorCode: 'application_error',
        attempts: 1,
      },
      {
        messageId: 2,
        template: 'test.sms_notice',
        channel: 'sms',
        outcome: 'sent',
        errorCode: null,
        attempts: 1,
      },
    ]);
    const text = JSON.stringify(logs);
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('+2010');
    expect(text).not.toContain(TOKEN);
  });
});

describe('OutboxDrainService.requestDrain', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('runs one drain at a time and coalesces requests into one more run, in the stronger mode', async () => {
    const { service } = setup();
    let release!: () => void;
    const drainSpy = jest
      .spyOn(service, 'drain')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ claimed: 0, sent: 0, retried: 0, throttled: 0, failed: 0 });
          }),
      )
      .mockResolvedValue({ claimed: 0, sent: 0, retried: 0, throttled: 0, failed: 0 });

    service.requestDrain('batch');
    service.requestDrain('batch');
    service.requestDrain('flush');
    service.requestDrain('batch');
    expect(drainSpy).toHaveBeenCalledTimes(1);
    release();
    await service.whenIdle();

    expect(drainSpy.mock.calls).toEqual([['batch'], ['flush']]);
  });

  it('logs a drain that throws and keeps accepting requests', async () => {
    const { service } = setup();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const drainSpy = jest
      .spyOn(service, 'drain')
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue({ claimed: 0, sent: 0, retried: 0, throttled: 0, failed: 0 });

    service.requestDrain('batch');
    await service.whenIdle();
    expect(errorSpy).toHaveBeenCalledWith({ err: expect.any(Error) }, 'An outbox drain failed');
    service.requestDrain('batch');
    await service.whenIdle();
    expect(drainSpy).toHaveBeenCalledTimes(2);
  });

  it('is idle at once when nothing was requested, and shutdown waits for a running drain', async () => {
    const { service } = setup();
    await expect(service.whenIdle()).resolves.toBeUndefined();
    let finished = false;
    jest.spyOn(service, 'drain').mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
      return { claimed: 0, sent: 0, retried: 0, throttled: 0, failed: 0 };
    });
    service.requestDrain('batch');
    await service.beforeApplicationShutdown();
    expect(finished).toBe(true);
  });
});
