import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { addToInstant } from '../../../../src/common/time/time';
import { REDACTED_LINK } from '../../../../src/modules/messaging/messaging.constants';
import { MessagingService } from '../../../../src/modules/messaging/messaging.service';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { staffPasswordResetTemplate } from '../../../../src/modules/staff/templates/staff-password-reset.template';
import { TestClock } from '../../../support/clock';
import { MessagingProbeModule } from '../../../support/messaging/messaging-probe.module';
import { oneTimeTokenFrom } from '../../../support/messaging/one-time-link';
import {
  recordedProviderId,
  RecordingEmailSender,
} from '../../../support/messaging/recording-email-sender';
import { smsNoticeTemplate } from '../../../support/messaging/test-templates';
import { createStaffMember, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

const MESSAGES = '/api/v1/admin/messages';
const STAFF = '/api/v1/admin/staff';
const SET_PASSWORD_PATH = '/admin/set-password';
const CAIRO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[23]:00$/;

/** The ids of a list response's items, in order. */
function itemIds(response: Response): number[] {
  return (response.body.items as { id: number }[]).map((item) => item.id);
}

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

describe('Message log (integration)', () => {
  let testApp: TestApp;
  let drain: OutboxDrainService;
  let admin: StaffSession;
  const sender = new RecordingEmailSender();
  const clock = new TestClock();

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [MessagingProbeModule],
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    drain = testApp.app.get(OutboxDrainService);
  });

  afterAll(async () => {
    await drain.whenIdle();
    await testApp.close();
  });

  async function reset(): Promise<void> {
    await drain.whenIdle();
    sender.reset();
    clock.set(new Date());
    await testApp.knex.raw(
      'TRUNCATE TABLE messages, one_time_tokens, sessions, audit_events, idempotency_keys, staff_users RESTART IDENTITY CASCADE',
    );
    admin = await staffSession(testApp, 'admin');
  }

  const get = (path: string, session: StaffSession = admin) =>
    testApp.http().get(path).set('Authorization', session.authorization);

  describe('one-time links never appear', () => {
    beforeAll(reset);

    it('lists and opens invite, resend and reset messages, queued and sent, with every link hidden', async () => {
      const member = await createStaffMember(testApp, { role: 'box_office' });
      sender.hold();
      const invited = await testApp
        .http()
        .post(STAFF)
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ fullName: 'Hana Said', email: 'hana@maqady.example', role: 'admin' });
      expect(invited.status).toBe(201);
      await testApp
        .http()
        .post(`${STAFF}/${invited.body.id}/invitations`)
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', randomUUID())
        .send()
        .expect(201);
      await testApp
        .http()
        .post('/api/v1/admin/auth/password-reset-requests')
        .send({ email: member.email })
        .expect(202);

      let tokens: string[] = [];
      const assertNoLinks = async (status: string): Promise<void> => {
        const list = await get(`${MESSAGES}?limit=100`);
        expect(list.status).toBe(200);
        expect(list.body.total).toBe(3);
        expect((list.body.items as { template: string }[]).map((item) => item.template)).toEqual([
          'staff.password_reset',
          'staff.invite',
          'staff.invite',
        ]);
        expect(
          (list.body.items as { status: string }[]).every((item) => item.status === status),
        ).toBe(true);
        const bodies = [JSON.stringify(list.body)];
        for (const item of list.body.items as { id: number }[]) {
          const detail = await get(`${MESSAGES}/${item.id}`);
          expect(detail.status).toBe(200);
          expect(detail.body.bodyText).toContain(REDACTED_LINK);
          expect(detail.body.bodyHtml).toContain(REDACTED_LINK);
          expect(Object.keys(detail.body).sort()).toEqual(
            [
              'attempts',
              'bodyHtml',
              'bodyText',
              'channel',
              'createdAt',
              'id',
              'lastErrorCode',
              'nextAttemptAt',
              'providerMessageId',
              'recipient',
              'related',
              'sentAt',
              'status',
              'subject',
              'template',
              'updatedAt',
            ].sort(),
          );
          bodies.push(JSON.stringify(detail.body));
        }
        const everything = bodies.join('\n');
        expect(everything).not.toContain('token=');
        expect(everything).not.toMatch(/payload|ciphertext/i);
        for (const token of tokens) expect(everything).not.toContain(token);
      };

      // While held, the drain has claimed the messages but not sent them: they are still queued.
      await assertNoLinks('queued');

      sender.release();
      await drain.whenIdle();
      tokens = sender.calls.map((email) => oneTimeTokenFrom(email.text, SET_PASSWORD_PATH));
      expect(new Set(tokens).size).toBe(3);
      await assertNoLinks('sent');
    });
  });

  describe('listing', () => {
    let start: Date;
    let ids: number[];

    beforeAll(async () => {
      await reset();
      start = new Date('2026-10-20T07:00:00.250Z');
      const staffMember = await createStaffMember(testApp, { role: 'box_office' });
      sender.respondWith((email) =>
        email.to === 'bounce@maqady.example'
          ? { kind: 'rejected', errorCode: 'validation_error' }
          : email.to === 'later@maqady.example'
            ? { kind: 'retry', errorCode: 'http_500' }
            : { kind: 'sent', providerMessageId: recordedProviderId(email.messageId) },
      );
      const messaging = testApp.app.get(MessagingService);
      const resetEmail = (recipient: string) => ({
        template: staffPasswordResetTemplate,
        recipient,
        params: { fullName: 'Someone', token: randomUUID() },
        related: { staffUserId: staffMember.id },
      });
      const queued = [
        () => messaging.queue(resetEmail('first@maqady.example')),
        () =>
          messaging.queue({
            template: smsNoticeTemplate,
            recipient: '+201001234567',
            params: { text: 'Hi' },
          }),
        () => messaging.queue(resetEmail('bounce@maqady.example')),
        () => messaging.queue(resetEmail('fourth@maqady.example')),
        () => messaging.queue(resetEmail('later@maqady.example')),
      ];
      ids = [];
      for (const [minute, queue] of queued.entries()) {
        clock.set(addToInstant(start, { minutes: minute }));
        ids.push((await queue()).id);
        await drain.whenIdle();
      }
      // Back to the real time for the admin's session.
      clock.set(new Date());
      admin = await staffSession(testApp, 'admin');
    });

    it('lists newest first across pages, with nextCursor, total and the screen’s columns', async () => {
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response: Response = await get(
          `${MESSAGES}?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(response.status).toBe(200);
        expect(response.body.total).toBe(5);
        seen.push(...(response.body.items as { id: number }[]).map((item) => item.id));
        cursor = response.body.nextCursor;
        pages += 1;
      } while (cursor !== null);
      expect(pages).toBe(3);
      expect(seen).toEqual([...ids].reverse());

      const first = await get(`${MESSAGES}?limit=1`);
      expect(first.body.items[0]).toEqual({
        id: ids[4],
        channel: 'email',
        template: 'staff.password_reset',
        recipient: 'later@maqady.example',
        subject: 'Reset your Maqady dashboard password',
        status: 'queued',
        attempts: 1,
        lastErrorCode: 'http_500',
        nextAttemptAt: expect.stringMatching(CAIRO_TIME),
        sentAt: null,
        related: { customerId: null, staffUserId: expect.any(Number), bookingId: null },
        createdAt: expect.stringMatching(CAIRO_TIME),
      });
    });

    it('filters by channel and status, with total counting the same filter', async () => {
      const sms = await get(`${MESSAGES}?channel=sms`);
      expect(sms.body).toEqual({
        items: [
          expect.objectContaining({
            id: ids[1],
            channel: 'sms',
            subject: null,
            status: 'sent',
            related: { customerId: null, staffUserId: null, bookingId: null },
          }),
        ],
        nextCursor: null,
        total: 1,
      });
      const failed = await get(`${MESSAGES}?status=failed`);
      expect(failed.body.items).toEqual([
        expect.objectContaining({
          id: ids[2],
          status: 'failed',
          lastErrorCode: 'validation_error',
        }),
      ]);
      const queued = await get(`${MESSAGES}?status=queued&channel=email`);
      expect(itemIds(queued)).toEqual([ids[4]]);
      const sentEmail = await get(`${MESSAGES}?status=sent&channel=email`);
      expect(itemIds(sentEmail)).toEqual([ids[3], ids[0]]);
      expect(sentEmail.body.total).toBe(2);
    });

    it('filters by time: from inclusive, to exclusive, at millisecond precision, in any offset', async () => {
      const at = (minutes: number) => addToInstant(start, { minutes }).toISOString();
      const range = await get(`${MESSAGES}?from=${at(1)}&to=${at(3)}`);
      expect(itemIds(range)).toEqual([ids[2], ids[1]]);
      expect(range.body.total).toBe(2);

      // The same instants written in Cairo time (+03:00), URL-encoded.
      const cairo = encodeURIComponent('2026-10-20T10:01:00.250+03:00');
      const fromCairo = await get(`${MESSAGES}?from=${cairo}`);
      expect(fromCairo.body.total).toBe(4);

      const justAfter = addToInstant(start, { minutes: 1, milliseconds: 1 }).toISOString();
      const after = await get(`${MESSAGES}?from=${justAfter}`);
      expect(after.body.total).toBe(3);
    });

    it('opens one message with its stored bodies and delivery details', async () => {
      const detail = await get(`${MESSAGES}/${ids[0]}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        id: ids[0],
        recipient: 'first@maqady.example',
        status: 'sent',
        attempts: 1,
        sentAt: expect.stringMatching(CAIRO_TIME),
        providerMessageId: recordedProviderId(ids[0]!),
        updatedAt: expect.stringMatching(CAIRO_TIME),
        bodyHtml: expect.stringContaining('<!doctype html>'),
      });
      expect(detail.body.bodyText).toContain('Hello Someone,');
      const sms = await get(`${MESSAGES}/${ids[1]}`);
      expect(sms.body).toMatchObject({ channel: 'sms', bodyText: 'Hi', bodyHtml: null });
    });

    it('refuses bad filters, a tampered cursor and an unknown or malformed id', async () => {
      const at = (minutes: number) => addToInstant(start, { minutes }).toISOString();
      for (const query of [
        `?from=${at(2)}&to=${at(2)}`,
        `?from=${at(3)}&to=${at(2)}`,
        '?from=2026-10-20',
        '?to=yesterday',
        '?channel=fax',
        '?status=delivered',
        '?limit=0',
        '?cursor=not!a!cursor',
        `?cursor=${Buffer.from(JSON.stringify(['Mona', 3])).toString('base64url')}`,
        '?recipient=first@maqady.example',
      ]) {
        const response = await get(`${MESSAGES}${query}`);
        expect({ query, status: response.status, code: response.body?.error?.code }).toEqual({
          query,
          status: 400,
          code: 'VALIDATION_FAILED',
        });
      }
      expectError(await get(`${MESSAGES}/999999`), 404, 'NOT_FOUND');
      expectError(await get(`${MESSAGES}/abc`), 400, 'VALIDATION_FAILED');
      expectError(await get(`${MESSAGES}/0`), 400, 'VALIDATION_FAILED');
    });

    it('is for admins only', async () => {
      const boxOffice = await staffSession(testApp, 'box_office');
      expectError(await get(MESSAGES, boxOffice), 403, 'FORBIDDEN');
      expectError(await get(`${MESSAGES}/${ids[0]}`, boxOffice), 403, 'FORBIDDEN');
      expectError(await testApp.http().get(MESSAGES), 401, 'UNAUTHENTICATED');
    });
  });
});
