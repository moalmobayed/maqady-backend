import { DataEncryptionService } from '../../../../src/common/crypto/data-encryption.service';
import { AppError } from '../../../../src/common/errors/app-error';
import { REDACTED_LINK } from '../../../../src/modules/messaging/messaging.constants';
import { MessagingService } from '../../../../src/modules/messaging/messaging.service';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { TestClock } from '../../../support/clock';
import { readMessage, readMessages } from '../../../support/messaging/messages';
import { MessagingProbeModule } from '../../../support/messaging/messaging-probe.module';
import {
  recordedProviderId,
  RecordingEmailSender,
} from '../../../support/messaging/recording-email-sender';
import { oneTimeLinkTemplate } from '../../../support/messaging/test-templates';
import { registerCustomer } from '../../../support/customer-auth';
import { createTestApp } from '../../../support/test-app';
import { TEST_FRONTEND_BASE_URL } from '../../../support/test-config';
import type { TestApp } from '../../../support/types';

const RECIPIENT = 'layla@example.com';
const TOKEN = 'q5Yt0kSecretToken_-AbCdEfGhIjKlMnOpQrStUvW';
const REAL_LINK = `${TEST_FRONTEND_BASE_URL}/verify-email?token=${TOKEN}`;
const START = new Date('2026-10-20T10:00:00Z');

describe('MessagingService.queue (integration)', () => {
  let testApp: TestApp;
  const sender = new RecordingEmailSender();
  const clock = new TestClock(START);
  let drain: OutboxDrainService;
  let customerId: number;

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [MessagingProbeModule],
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    drain = testApp.app.get(OutboxDrainService);
    // `messages.related_customer_id` references customers (U9), so the related customer is real.
    // Registering queues a verification email; it is cleared so each test sees only its own.
    customerId = (await registerCustomer(testApp)).customerId;
    await drain.whenIdle();
    sender.reset();
    await testApp.knex('messages').truncate();
  });

  afterEach(async () => {
    await drain.whenIdle();
    sender.reset();
    clock.set(START);
    await testApp.knex('messages').truncate();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const queueEmail = (body: Record<string, unknown> = {}) =>
    testApp
      .http()
      .post('/api/v1/test-messaging/emails')
      .send({ recipient: RECIPIENT, name: 'Layla', token: TOKEN, ...body });

  it('stores nothing and sends nothing when the transaction rolls back', async () => {
    const response = await queueEmail({ count: 2, fail: true });
    expect(response.status).toBe(409);
    await drain.whenIdle();

    expect(await readMessages(testApp.knex)).toEqual([]);
    expect(sender.calls).toEqual([]);
  });

  it('sends a committed message through the sender and records it as sent with the provider id', async () => {
    const response = await queueEmail({ relatedCustomerId: customerId });
    expect(response.status).toBe(201);
    const [id] = response.body.ids as number[];
    await drain.whenIdle();

    expect(sender.calls).toHaveLength(1);
    const [email] = sender.calls;
    expect(email).toMatchObject({
      messageId: id,
      to: RECIPIENT,
      subject: 'Confirm your email, Layla',
    });
    expect(email!.text).toContain(REAL_LINK);
    expect(email!.html).toContain(`href="${REAL_LINK}"`);

    const row = await readMessage(testApp.knex, id!);
    expect(row).toMatchObject({
      channel: 'email',
      template: 'test.one_time_link',
      recipient: RECIPIENT,
      status: 'sent',
      attempts: 1,
      provider_message_id: recordedProviderId(id!),
      payload_ciphertext: null,
      next_attempt_at: null,
      last_error_code: null,
      related_customer_id: customerId,
      related_staff_user_id: null,
      related_booking_id: null,
    });
    expect(row.sent_at).toEqual(START);
    expect(row.created_at).toEqual(START);
  });

  it('never stores the raw token, while queued or after sending, and clears the payload once sent', async () => {
    sender.hold();
    const response = await queueEmail();
    const [id] = response.body.ids as number[];

    const queued = await readMessage(testApp.knex, id!);
    expect(queued.status).toBe('queued');
    for (const stored of [queued.subject, queued.body_text, queued.body_html]) {
      expect(stored).not.toContain(TOKEN);
      expect(stored).not.toContain('token=');
    }
    expect(queued.body_text).toContain(REDACTED_LINK);
    expect(queued.body_html).toContain(REDACTED_LINK);
    expect(queued.body_html).not.toContain('href=');

    // The parameters are kept, encrypted and bound to this row only.
    const ciphertext = queued.payload_ciphertext!;
    expect(ciphertext).not.toContain(TOKEN);
    const encryption = testApp.app.get(DataEncryptionService);
    expect(JSON.parse(encryption.decrypt(ciphertext, `messages:${id}`))).toEqual({
      name: 'Layla',
      token: TOKEN,
    });
    expect(() => encryption.decrypt(ciphertext, `messages:${id! + 1}`)).toThrow(AppError);

    sender.release();
    await drain.whenIdle();
    const sent = await readMessage(testApp.knex, id!);
    expect(sent.status).toBe('sent');
    expect(sent.payload_ciphertext).toBeNull();
    for (const stored of [sent.subject, sent.body_text, sent.body_html]) {
      expect(stored).not.toContain(TOKEN);
    }
    expect(sender.calls[0]!.text).toContain(TOKEN);
  });

  it('joins a transaction opened outside a request, and sends only after it commits', async () => {
    const transactions = testApp.app.get(TransactionRepository);
    const messaging = testApp.app.get(MessagingService);
    let queuedId = 0;
    await transactions.run(async () => {
      ({ id: queuedId } = await messaging.queue({
        template: oneTimeLinkTemplate,
        recipient: RECIPIENT,
        params: { name: 'Omar', token: TOKEN },
      }));
      // Not yet committed: nothing is visible outside the transaction, nothing was sent.
      expect(await testApp.knex('messages').count({ n: 'id' }).first()).toEqual({ n: 0 });
      expect(sender.calls).toEqual([]);
    });
    await drain.whenIdle();
    expect((await readMessage(testApp.knex, queuedId)).status).toBe('sent');
    expect(sender.calls.map((call) => call.messageId)).toEqual([queuedId]);
  });

  it('records an SMS as sent by the simulated sender, with no subject or HTML', async () => {
    const response = await testApp
      .http()
      .post('/api/v1/test-messaging/sms')
      .send({ recipient: '+201001234567', text: 'Your showtime moved to 21:30.' });
    expect(response.status).toBe(201);
    const { id } = response.body as { id: number };
    await drain.whenIdle();

    const row = await readMessage(testApp.knex, id);
    expect(row).toMatchObject({
      channel: 'sms',
      template: 'test.sms_notice',
      subject: null,
      body_html: null,
      body_text: 'Your showtime moved to 21:30.',
      status: 'sent',
      attempts: 1,
      provider_message_id: `simulated-sms-${id}`,
      payload_ciphertext: null,
    });
    expect(sender.calls).toEqual([]);
  });

  it('refuses a recipient that does not fit the channel, and stores nothing', async () => {
    const response = await queueEmail({ recipient: 'not-an-email' });
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(response.body)).not.toContain('not-an-email');
    expect(await readMessages(testApp.knex)).toEqual([]);
  });
});
