import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { TestClock } from '../../../support/clock';
import { readMessage } from '../../../support/messaging/messages';
import { MessagingProbeModule } from '../../../support/messaging/messaging-probe.module';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

const START = new Date('2026-10-20T10:00:00Z');

/**
 * What starts a drain besides `queue()`'s own post-commit hook: any successful write request,
 * and a `200` from `GET /health/ready` (the daily keep-alive). A plain read starts none.
 */
describe('Drain triggers (integration)', () => {
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
    await drain.whenIdle();
    sender.reset();
    clock.set(START);
    await testApp.knex('messages').truncate();
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** Queues `count` emails whose first attempt fails, so they are due again a minute later. */
  async function queueRetried(count: number): Promise<number[]> {
    sender.respondWith(() => ({ kind: 'retry', errorCode: 'application_error' }));
    const response = await testApp
      .http()
      .post('/api/v1/test-messaging/emails')
      .send({ recipient: 'sara@example.com', name: 'Sara', token: 'tok-abc', count });
    expect(response.status).toBe(201);
    await drain.whenIdle();
    sender.reset();
    clock.advance({ minutes: 1 });
    return response.body.ids as number[];
  }

  it('does not drain after a read', async () => {
    const [id] = await queueRetried(1);
    const response = await testApp.http().get('/api/v1/test-messaging/ping');
    expect(response.status).toBe(200);
    await drain.whenIdle();

    expect(sender.calls).toEqual([]);
    expect((await readMessage(testApp.knex, id!)).status).toBe('queued');
  });

  it('drains one batch of due messages after any successful write', async () => {
    const ids = await queueRetried(12);
    const response = await testApp.http().post('/api/v1/test-messaging/noop');
    expect(response.status).toBe(204);
    await drain.whenIdle();

    expect(sender.calls.map((call) => call.messageId)).toEqual(ids.slice(0, 10));
  });

  it('does not drain after a failed write', async () => {
    const [id] = await queueRetried(1);
    const response = await testApp
      .http()
      .post('/api/v1/test-messaging/emails')
      .send({ recipient: 'sara@example.com', name: 'Sara', token: 'tok-abc', fail: true });
    expect(response.status).toBe(409);
    await drain.whenIdle();

    expect(sender.calls).toEqual([]);
    expect((await readMessage(testApp.knex, id!)).status).toBe('queued');
  });

  it('flushes the whole queue after GET /health/ready answers 200', async () => {
    const ids = await queueRetried(25);
    const response = await testApp.http().get('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    await drain.whenIdle();

    // Three batches, each claiming the oldest due first and sending in id order: the 5 never
    // attempted with the first 5 retried, then the other 15 retried.
    const sentIds = sender.calls.map((call) => call.messageId);
    expect(sentIds).toEqual([...ids.slice(0, 5), ...ids.slice(20), ...ids.slice(5, 20)]);
    for (const id of ids) {
      expect((await readMessage(testApp.knex, id)).status).toBe('sent');
    }
  });
});
