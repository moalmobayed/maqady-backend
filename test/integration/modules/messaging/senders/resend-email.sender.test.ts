import { OutboxDrainService } from '../../../../../src/modules/messaging/outbox-drain.service';
import { RESEND_EMAILS_URL } from '../../../../../src/modules/messaging/messaging.constants';
import { EmailSender } from '../../../../../src/modules/messaging/senders/email-sender';
import { ResendEmailSender } from '../../../../../src/modules/messaging/senders/resend-email.sender';
import { TestClock } from '../../../../support/clock';
import { readMessage } from '../../../../support/messaging/messages';
import { MessagingProbeModule } from '../../../../support/messaging/messaging-probe.module';
import { createTestApp } from '../../../../support/test-app';
import { buildTestConfig } from '../../../../support/test-config';
import type { TestApp } from '../../../../support/types';

const RESEND_KEY = 're_integration_test_key';
const FROM = 'Maqady <tickets@maqady.example>';
const TOKEN = 'resend-integration-token-0123456789';

function resendAnswer(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * The real app with `EMAIL_DRIVER=resend`: the real `ResendEmailSender`, built by the module's
 * factory, with only the network replaced (`fetch`, Resend's genuinely external API).
 */
describe('ResendEmailSender in the outbox (integration)', () => {
  let testApp: TestApp;
  const clock = new TestClock(new Date('2026-10-20T22:30:00Z'));
  let drain: OutboxDrainService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeAll(async () => {
    testApp = await createTestApp({
      config: buildTestConfig(
        {},
        { EMAIL_DRIVER: 'resend', RESEND_API_KEY: RESEND_KEY, EMAIL_FROM: FROM },
      ),
      imports: [MessagingProbeModule],
      clock,
    });
    drain = testApp.app.get(OutboxDrainService);
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(async () => {
    await drain.whenIdle();
    clock.set(new Date('2026-10-20T22:30:00Z'));
    await testApp.knex('messages').truncate();
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function queueOne(): Promise<number> {
    const response = await testApp
      .http()
      .post('/api/v1/test-messaging/emails')
      .send({ recipient: 'nour@example.com', name: 'Nour', token: TOKEN });
    expect(response.status).toBe(201);
    await drain.whenIdle();
    return (response.body.ids as number[])[0]!;
  }

  it('is the sender the app builds for EMAIL_DRIVER=resend', () => {
    expect(testApp.app.get(EmailSender)).toBeInstanceOf(ResendEmailSender);
  });

  it('posts the email with the message id as the Idempotency-Key and records the Resend id', async () => {
    fetchMock.mockResolvedValue(resendAnswer(200, { id: 'b6d24b8e-af0b-4c3c-be0c-359bbd97381e' }));
    const id = await queueOne();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(RESEND_EMAILS_URL);
    const headers = init!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(String(id));
    expect(headers.Authorization).toBe(`Bearer ${RESEND_KEY}`);
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ from: FROM, to: ['nour@example.com'] });
    expect(body.text).toContain(`token=${TOKEN}`);

    expect(await readMessage(testApp.knex, id)).toMatchObject({
      status: 'sent',
      attempts: 1,
      provider_message_id: 'b6d24b8e-af0b-4c3c-be0c-359bbd97381e',
      payload_ciphertext: null,
    });
  });

  it('keeps a message refused for the daily quota queued until the next UTC midnight, then sends it', async () => {
    fetchMock.mockResolvedValue(
      resendAnswer(429, {
        statusCode: 429,
        name: 'daily_quota_exceeded',
        message: 'You have reached your daily email sending quota.',
      }),
    );
    const id = await queueOne();

    expect(await readMessage(testApp.knex, id)).toMatchObject({
      status: 'queued',
      attempts: 0,
      last_error_code: 'daily_quota_exceeded',
      next_attempt_at: new Date('2026-10-21T00:00:00Z'),
    });
    clock.set(new Date('2026-10-20T23:59:59Z'));
    expect((await drain.drain('flush')).claimed).toBe(0);

    fetchMock.mockResolvedValue(resendAnswer(200, { id: 're-next-day' }));
    clock.set(new Date('2026-10-21T00:00:00Z'));
    expect(await drain.drain('batch')).toMatchObject({ claimed: 1, sent: 1 });
    expect(await readMessage(testApp.knex, id)).toMatchObject({
      status: 'sent',
      provider_message_id: 're-next-day',
      last_error_code: null,
    });
  });

  it('counts an attempt and backs off on a 5xx', async () => {
    fetchMock.mockResolvedValue(
      resendAnswer(500, { statusCode: 500, name: 'application_error', message: 'Oops' }),
    );
    const id = await queueOne();

    expect(await readMessage(testApp.knex, id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      last_error_code: 'application_error',
      next_attempt_at: new Date('2026-10-20T22:31:00Z'),
    });
  });

  it('marks a message failed on a 4xx validation error, never storing Resend’s message', async () => {
    fetchMock.mockResolvedValue(
      resendAnswer(422, {
        statusCode: 422,
        name: 'validation_error',
        message: 'Invalid `to` field: nour@example.com',
      }),
    );
    const id = await queueOne();

    const row = await readMessage(testApp.knex, id);
    expect(row).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error_code: 'validation_error',
      next_attempt_at: null,
    });
    clock.set(new Date('2026-10-23T00:00:00Z'));
    expect((await drain.drain('flush')).claimed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const id = await queueOne();
    expect(await readMessage(testApp.knex, id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      last_error_code: 'network_error',
    });
  });
});
