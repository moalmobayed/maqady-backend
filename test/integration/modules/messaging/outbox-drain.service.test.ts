import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { TestClock } from '../../../support/clock';
import { readMessage, readMessages } from '../../../support/messaging/messages';
import { MessagingProbeModule } from '../../../support/messaging/messaging-probe.module';
import { RecordingEmailSender, waitFor } from '../../../support/messaging/recording-email-sender';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

const START = new Date('2026-10-20T10:00:00Z');

describe('OutboxDrainService (integration)', () => {
  let testApp: TestApp;
  const sender = new RecordingEmailSender();
  const clock = new TestClock(START);
  let drain: OutboxDrainService;

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [MessagingProbeModule],
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    drain = testApp.app.get(OutboxDrainService);
  });

  afterEach(async () => {
    sender.release();
    await drain.whenIdle();
    sender.reset();
    clock.set(START);
    await testApp.knex('messages').truncate();
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function queueEmails(count = 1): Promise<number[]> {
    const response = await testApp
      .http()
      .post('/api/v1/test-messaging/emails')
      .send({ recipient: 'karim@example.com', name: 'Karim', token: 'tok-123', count });
    expect(response.status).toBe(201);
    return response.body.ids as number[];
  }

  it('sends each of 15 due messages exactly once when drains run concurrently', async () => {
    sender.hold();
    const ids = await queueEmails(15);
    // The post-commit drain has claimed the first 10 and is blocked sending the first of them.
    await waitFor(() => sender.heldCount() === 1);

    const racing = [drain.drain('batch'), drain.drain('batch')];
    // At least one of the two direct drains claimed the remaining 5 and is blocked too.
    await waitFor(() => sender.heldCount() >= 2);
    sender.release();
    const [first, second] = await Promise.all(racing);
    await drain.whenIdle();

    // The 10 rows under the first drain's lease were never claimed again.
    expect(first!.claimed + second!.claimed).toBe(5);
    const sentIds = sender.calls.map((call) => call.messageId);
    expect(sentIds).toHaveLength(15);
    expect(new Set(sentIds).size).toBe(15);
    expect([...sentIds].sort((a, b) => a - b)).toEqual(ids);
    const rows = await readMessages(testApp.knex);
    expect(rows.map(({ status, attempts }) => ({ status, attempts }))).toEqual(
      ids.map(() => ({ status: 'sent', attempts: 1 })),
    );
  });

  it('does not claim a message again within its lease, but does after the lease ends', async () => {
    sender.hold();
    const [id] = await queueEmails();
    await waitFor(() => sender.heldCount() === 1);

    expect((await drain.drain('batch')).claimed).toBe(0);
    clock.advance({ minutes: 4, seconds: 59 });
    expect((await drain.drain('batch')).claimed).toBe(0);

    // A drain that died mid-send: once the 5-minute lease ends, the message is claimed again,
    // with the same message id, which Resend uses as the idempotency key.
    clock.advance({ seconds: 2 });
    const reclaim = drain.drain('batch');
    await waitFor(() => sender.heldCount() === 2);
    sender.release();
    expect((await reclaim).claimed).toBe(1);
    await drain.whenIdle();

    expect(sender.calls.map((call) => call.messageId)).toEqual([id, id]);
    // Only the first recorded result counts; the second finds the row no longer queued.
    expect(await readMessage(testApp.knex, id!)).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('retries a temporary failure after the backoff, counting each attempt', async () => {
    sender.respondWith(() => ({ kind: 'retry', errorCode: 'application_error' }));
    const [id] = await queueEmails();
    await drain.whenIdle();

    expect(await readMessage(testApp.knex, id!)).toMatchObject({
      status: 'queued',
      attempts: 1,
      last_error_code: 'application_error',
      next_attempt_at: new Date('2026-10-20T10:01:00Z'),
    });
    expect((await drain.drain('batch')).claimed).toBe(0);

    clock.advance({ minutes: 1 });
    expect(await drain.drain('batch')).toMatchObject({ claimed: 1, retried: 1 });
    expect(await readMessage(testApp.knex, id!)).toMatchObject({
      status: 'queued',
      attempts: 2,
      next_attempt_at: new Date('2026-10-20T10:06:00Z'),
    });

    sender.reset();
    clock.advance({ minutes: 5 });
    expect(await drain.drain('batch')).toMatchObject({ claimed: 1, sent: 1 });
    expect(await readMessage(testApp.knex, id!)).toMatchObject({
      status: 'sent',
      attempts: 3,
      last_error_code: null,
    });
  });

  it('marks a message failed after its 10th temporary failure', async () => {
    sender.respondWith(() => ({ kind: 'retry', errorCode: 'application_error' }));
    const [id] = await queueEmails();
    await drain.whenIdle();
    for (let attempt = 2; attempt <= 10; attempt += 1) {
      clock.advance({ hours: 6 });
      await drain.drain('batch');
    }

    expect(await readMessage(testApp.knex, id!)).toMatchObject({
      status: 'failed',
      attempts: 10,
      last_error_code: 'attempts_exhausted',
      next_attempt_at: null,
    });
    clock.advance({ hours: 24 });
    expect((await drain.drain('flush')).claimed).toBe(0);
    expect(sender.calls).toHaveLength(10);
  });

  it('marks a refused message failed for good and keeps its encrypted payload', async () => {
    sender.respondWith(() => ({ kind: 'rejected', errorCode: 'validation_error' }));
    const [id] = await queueEmails();
    await drain.whenIdle();

    const row = await readMessage(testApp.knex, id!);
    expect(row).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error_code: 'validation_error',
      next_attempt_at: null,
      sent_at: null,
    });
    expect(row.payload_ciphertext).not.toBeNull();
    clock.advance({ hours: 48 });
    expect((await drain.drain('flush')).claimed).toBe(0);
    expect(sender.calls).toHaveLength(1);
  });

  it('coalesces post-commit drains, and a flush stops after 10 batches even if messages remain', async () => {
    sender.hold();
    await queueEmails(50);
    await queueEmails(50);
    await queueEmails(25);
    await waitFor(() => sender.heldCount() === 1);
    sender.release();
    await drain.whenIdle();
    // Three writes while the first drain ran: one drain more, not three (one batch each).
    expect(sender.calls).toHaveLength(20);

    sender.reset();
    const result = await drain.drain('flush');
    expect(result).toEqual({ claimed: 100, sent: 100, retried: 0, throttled: 0, failed: 0 });
    const statuses = (await readMessages(testApp.knex)).map((row) => row.status);
    expect(statuses.filter((status) => status === 'queued')).toHaveLength(5);
    expect(statuses.filter((status) => status === 'sent')).toHaveLength(120);
  });
});
