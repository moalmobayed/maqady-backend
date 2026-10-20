import type { AppConfig } from '../../../../src/common/config/types';
import type { DataEncryptionService } from '../../../../src/common/crypto/data-encryption.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import { MessageTemplateRegistry } from '../../../../src/modules/messaging/message-template.registry';
import type { MessagesRepository } from '../../../../src/modules/messaging/messages.repository';
import { REDACTED_LINK } from '../../../../src/modules/messaging/messaging.constants';
import { MessagingService } from '../../../../src/modules/messaging/messaging.service';
import { escapeHtml } from '../../../../src/modules/messaging/simple-html';
import type { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import type { MessageTemplate, NewMessageRow } from '../../../../src/modules/messaging/types';
import { TestClock } from '../../../support/clock';
import { oneTimeLinkTemplate, smsNoticeTemplate } from '../../../support/messaging/test-templates';
import type { OneTimeLinkParams } from '../../../support/types';

const NOW = new Date('2026-10-20T10:00:00Z');
const TOKEN = 'unit-secret-token-0123456789abcdef';

function setup() {
  const hooks: (() => void | Promise<void>)[] = [];
  const transactions = {
    run: jest.fn((fn: () => Promise<unknown>) => fn()),
    afterCommit: jest.fn((hook: () => void) => {
      hooks.push(hook);
      return Promise.resolve();
    }),
  };
  const messages = {
    nextId: jest.fn().mockResolvedValue(31),
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const encryption = { encrypt: jest.fn((plain: string, aad: string) => `enc(${plain}|${aad})`) };
  const drain = { requestDrain: jest.fn() };
  const registry = new MessageTemplateRegistry();
  registry.register(oneTimeLinkTemplate);
  registry.register(smsNoticeTemplate);
  const service = new MessagingService(
    { frontendBaseUrl: 'https://maqady.example' } as AppConfig,
    transactions as unknown as TransactionRepository,
    messages as unknown as MessagesRepository,
    registry,
    encryption as unknown as DataEncryptionService,
    new TestClock(NOW),
    drain as unknown as OutboxDrainService,
  );
  return { service, transactions, messages, encryption, drain, registry, hooks };
}

function insertedRow(messages: { insert: jest.Mock }): NewMessageRow {
  return messages.insert.mock.calls[0]![0] as NewMessageRow;
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('MessagingService.queue', () => {
  it('inserts a queued email with redacted bodies and the parameters encrypted for its row', async () => {
    const { service, messages, encryption, transactions } = setup();

    await expect(
      service.queue({
        template: oneTimeLinkTemplate,
        recipient: 'mona@example.com',
        params: { name: 'Mona', token: TOKEN },
        related: { customerId: 5, bookingId: 9 },
      }),
    ).resolves.toEqual({ id: 31 });

    expect(transactions.run).toHaveBeenCalledTimes(1);
    expect(encryption.encrypt).toHaveBeenCalledWith(
      JSON.stringify({ name: 'Mona', token: TOKEN }),
      'messages:31',
    );
    const row = insertedRow(messages);
    expect(row).toMatchObject({
      id: 31,
      channel: 'email',
      template: 'test.one_time_link',
      recipient: 'mona@example.com',
      subject: 'Confirm your email, Mona',
      status: 'queued',
      attempts: 0,
      next_attempt_at: NOW,
      created_at: NOW,
      updated_at: NOW,
      sent_at: null,
      provider_message_id: null,
      related_customer_id: 5,
      related_staff_user_id: null,
      related_booking_id: 9,
    });
    expect(row.payload_ciphertext).toBe(
      `enc(${JSON.stringify({ name: 'Mona', token: TOKEN })}|messages:31)`,
    );
    expect(row.body_text).toContain(REDACTED_LINK);
    expect(row.body_html).toContain(REDACTED_LINK);
    expect(`${row.subject}${row.body_text}${row.body_html}`).not.toContain(TOKEN);
  });

  it('asks for a drain only once the transaction commits', async () => {
    const { service, drain, hooks } = setup();
    await service.queue({
      template: oneTimeLinkTemplate,
      recipient: 'mona@example.com',
      params: { name: 'Mona', token: TOKEN },
    });
    expect(drain.requestDrain).not.toHaveBeenCalled();
    expect(hooks).toHaveLength(1);
    await hooks[0]!();
    expect(drain.requestDrain).toHaveBeenCalledWith('batch');
  });

  it('stores an SMS with no subject or HTML', async () => {
    const { service, messages } = setup();
    await service.queue({
      template: smsNoticeTemplate,
      recipient: '+201001234567',
      params: { text: 'Hi' },
    });
    expect(insertedRow(messages)).toMatchObject({
      channel: 'sms',
      subject: null,
      body_html: null,
      body_text: 'Hi',
    });
  });

  it('refuses a template that would store a secret parameter, and writes nothing', async () => {
    const { service, registry, messages } = setup();
    const leaky: MessageTemplate<OneTimeLinkParams> = {
      name: 'test.leaky',
      channel: 'email',
      secretParams: ['token'],
      render: ({ token }, links) => ({
        subject: 'Reset',
        text: `Open ${links.page('/reset-password', { token })}`,
        html: '<p>Reset</p>',
      }),
    };
    registry.register(leaky);
    const error = await rejection(
      service.queue({ template: leaky, recipient: 'a@b.co', params: { name: 'A', token: TOKEN } }),
    );
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('secret parameter "token"');
    expect(error.message).not.toContain(TOKEN);
    expect(messages.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['HTML-escaped', (code: string) => `<p>Your code: ${escapeHtml(code)}</p>`],
    ['form-encoded', (code: string) => `<p>${new URLSearchParams({ code }).toString()}</p>`],
  ])('refuses a secret parameter stored %s', async (_form, html) => {
    const { service, registry, messages } = setup();
    const secret = "it's a <secret> & more";
    const leaky: MessageTemplate<{ code: string }> = {
      name: 'test.leaky_encoded',
      channel: 'email',
      secretParams: ['code'],
      render: ({ code }) => ({ subject: 'Code', text: 'See the HTML part.', html: html(code) }),
    };
    registry.register(leaky);
    const error = await rejection(
      service.queue({ template: leaky, recipient: 'a@b.co', params: { code: secret } }),
    );
    expect(error.message).toContain('secret parameter "code"');
    expect(messages.insert).not.toHaveBeenCalled();
  });

  it('refuses a template whose secret parameter is empty', async () => {
    const { service } = setup();
    const error = await rejection(
      service.queue({
        template: oneTimeLinkTemplate,
        recipient: 'a@b.co',
        params: { name: 'A', token: '' },
      }),
    );
    expect(error.code).toBe('INTERNAL');
  });

  it.each([
    ['email', 'not-an-email'],
    ['email', 'two@@example.com'],
    ['email', `${'a'.repeat(310)}@example.com`],
    ['sms', '01001234567'],
    ['sms', '+0123456789'],
    ['sms', 'mona@example.com'],
  ])('refuses the %s recipient %p without echoing it', async (channel, recipient) => {
    const { service, messages } = setup();
    const error = await rejection(
      channel === 'email'
        ? service.queue({
            template: oneTimeLinkTemplate,
            recipient,
            params: { name: 'A', token: TOKEN },
          })
        : service.queue({ template: smsNoticeTemplate, recipient, params: { text: 'Hi' } }),
    );
    expect(error.code).toBe('INTERNAL');
    expect(error.message).not.toContain(recipient);
    expect(messages.insert).not.toHaveBeenCalled();
  });

  it('refuses a template that was never registered', async () => {
    const { service } = setup();
    const stranger: MessageTemplate<OneTimeLinkParams> = { ...oneTimeLinkTemplate };
    const error = await rejection(
      service.queue({
        template: stranger,
        recipient: 'a@b.co',
        params: { name: 'A', token: TOKEN },
      }),
    );
    expect(error.message).toContain('not registered');
  });

  it('refuses an email template that renders no subject or HTML, and an SMS that renders HTML', async () => {
    const { service, registry } = setup();
    const bareEmail: MessageTemplate<{ text: string }> = {
      name: 'test.bare_email',
      channel: 'email',
      secretParams: [],
      render: ({ text }) => ({ text }),
    };
    const htmlSms: MessageTemplate<{ text: string }> = {
      name: 'test.html_sms',
      channel: 'sms',
      secretParams: [],
      render: ({ text }) => ({ text, html: `<p>${text}</p>` }),
    };
    registry.register(bareEmail);
    registry.register(htmlSms);
    await expect(
      service.queue({ template: bareEmail, recipient: 'a@b.co', params: { text: 'x' } }),
    ).rejects.toThrow(AppError);
    await expect(
      service.queue({ template: htmlSms, recipient: '+201001234567', params: { text: 'x' } }),
    ).rejects.toThrow(AppError);
  });
});
