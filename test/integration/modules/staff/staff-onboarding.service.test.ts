import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { REDACTED_LINK } from '../../../../src/modules/messaging/messaging.constants';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import type { OutgoingEmail } from '../../../../src/modules/messaging/types';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { readMessages } from '../../../support/messaging/messages';
import { oneTimeTokenFrom } from '../../../support/messaging/one-time-link';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { createStaffMember, signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { TEST_FRONTEND_BASE_URL } from '../../../support/test-config';
import type { StaffSession, TestApp } from '../../../support/types';

// Real scrypt hashing in most tests; the project-level testTimeout is not applied to this project.
jest.setTimeout(60_000);

const STAFF = '/api/v1/admin/staff';
const SIGN_IN = '/api/v1/admin/auth/sessions';
const RESET_REQUESTS = '/api/v1/admin/auth/password-reset-requests';
const SETUPS = '/api/v1/admin/auth/password-setups';
const ME = '/api/v1/admin/me';
const SET_PASSWORD_PATH = '/admin/set-password';
const NEW_PASSWORD = 'Cinema2026-new';

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

describe('Staff invites, password resets and setups (integration)', () => {
  let testApp: TestApp;
  let drain: OutboxDrainService;
  let admin: StaffSession;
  const sender = new RecordingEmailSender();
  const clock = new TestClock();

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    drain = testApp.app.get(OutboxDrainService);
  });

  beforeEach(async () => {
    await drain.whenIdle();
    sender.reset();
    clock.set(new Date());
    await testApp.knex.raw(
      'TRUNCATE TABLE messages, one_time_tokens, sessions, audit_events, idempotency_keys, staff_users RESTART IDENTITY CASCADE',
    );
    admin = await staffSession(testApp, 'admin', { fullName: 'Zeina Admin' });
  });

  afterAll(async () => {
    await drain.whenIdle();
    await testApp.close();
  });

  const invite = (body: object, key: string | null = randomUUID(), session = admin) => {
    const request = testApp.http().post(STAFF).set('Authorization', session.authorization);
    return (key === null ? request : request.set('Idempotency-Key', key)).send(body);
  };

  const resend = (id: number, session = admin) =>
    testApp
      .http()
      .post(`${STAFF}/${id}/invitations`)
      .set('Authorization', session.authorization)
      .set('Idempotency-Key', randomUUID())
      .send();

  const setUp = (token: string, password = NEW_PASSWORD) =>
    testApp.http().post(SETUPS).send({ token, password });

  const requestReset = (email: string) => testApp.http().post(RESET_REQUESTS).send({ email });

  /** The emails sent to `to`, once every drain has finished. */
  async function emailsTo(to: string): Promise<OutgoingEmail[]> {
    await drain.whenIdle();
    return sender.calls.filter((email) => email.to === to);
  }

  /** The set-password token of the last email sent to `to`. */
  async function lastLinkTo(to: string): Promise<string> {
    const emails = await emailsTo(to);
    const last = emails[emails.length - 1];
    if (!last) throw new Error(`no email was sent to ${to}`);
    const token = oneTimeTokenFrom(last.text, SET_PASSWORD_PATH);
    expect(oneTimeTokenFrom(last.html, SET_PASSWORD_PATH)).toBe(token);
    return token;
  }

  const memberRow = (id: number) =>
    testApp
      .knex('staff_users')
      .select('status', 'password_hash')
      .where({ id })
      .first<{ status: string; password_hash: string | null }>();

  const tokenRows = (staffUserId: number) =>
    testApp
      .knex('one_time_tokens')
      .select('purpose', 'used_at')
      .where({ staff_user_id: staffUserId })
      .orderBy('id');

  const auditActions = async (entityId: number): Promise<string[]> =>
    testApp
      .knex('audit_events')
      .where({ entity_type: 'staff_user', entity_id: entityId })
      .orderBy('id')
      .pluck('action');

  describe('invite, then set the password, then sign in', () => {
    it('queues the invite with the link hidden, emails the real link, and the link activates the member', async () => {
      const email = 'mona.adel@maqady.example';
      const created = await invite({ fullName: 'Mona Adel', email, role: 'box_office' });
      expect(created.status).toBe(201);
      expect(created.body).toEqual({
        id: expect.any(Number),
        fullName: 'Mona Adel',
        email,
        role: 'box_office',
        status: 'invited',
        lastSignInAt: null,
        createdAt: expect.stringMatching(/\+0[23]:00$/),
      });
      const id = created.body.id as number;
      expect(await memberRow(id)).toEqual({ status: 'invited', password_hash: null });
      expect(await tokenRows(id)).toEqual([{ purpose: 'staff_invite', used_at: null }]);

      const token = await lastLinkTo(email);
      const [stored] = await readMessages(testApp.knex);
      expect(stored).toMatchObject({
        channel: 'email',
        template: 'staff.invite',
        recipient: email,
        related_staff_user_id: id,
        status: 'sent',
      });
      const storedCopy = [stored!.subject, stored!.body_text, stored!.body_html].join('\n');
      expect(storedCopy).toContain(REDACTED_LINK);
      expect(storedCopy).not.toContain(token);
      expect(JSON.stringify(created.body)).not.toContain(token);

      const [sent] = await emailsTo(email);
      expect(sent!.text).toContain(`${TEST_FRONTEND_BASE_URL}${SET_PASSWORD_PATH}?token=${token}`);
      expect(sent!.text).toContain('as Box office');

      const setup = await setUp(token);
      expect(setup.status).toBe(204);
      expect(setup.body).toEqual({});
      expect(await memberRow(id)).toEqual({
        status: 'active',
        password_hash: expect.stringMatching(/^scrypt\$/),
      });

      const signedIn = await testApp.http().post(SIGN_IN).send({ email, password: NEW_PASSWORD });
      expect(signedIn.status).toBe(201);
      expect(signedIn.body.staff).toMatchObject({ id, role: 'box_office' });

      expect(await auditActions(id)).toEqual(['staff_user.invited', 'staff_user.password_set']);
      const [setEvent] = await testApp
        .knex('audit_events')
        .select('actor_kind', 'actor_staff_user_id', 'changed_fields', 'metadata')
        .where({ action: 'staff_user.password_set' });
      expect(setEvent).toEqual({
        actor_kind: 'staff',
        actor_staff_user_id: id,
        changed_fields: ['password', 'status'],
        metadata: { purpose: 'staff_invite' },
      });
    });

    it('requires an Idempotency-Key, and a replay returns the same member without a second email', async () => {
      const body = { fullName: 'Omar Fathy', email: 'omar@maqady.example', role: 'admin' };
      expectError(await invite(body, null), 400, 'IDEMPOTENCY_KEY_REQUIRED');
      expect(await readMessages(testApp.knex)).toEqual([]);

      const key = randomUUID();
      const first = await invite(body, key);
      const replay = await invite(body, key);
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await readMessages(testApp.knex)).toHaveLength(1);
      expect(await emailsTo('omar@maqady.example')).toHaveLength(1);
    });

    it('answers EMAIL_TAKEN for an email any member has, whatever the case, and issues nothing', async () => {
      const existing = await createStaffMember(testApp, {
        role: 'box_office',
        email: 'taken@maqady.example',
      });
      await testApp
        .knex('staff_users')
        .update({ status: 'deactivated' })
        .where({ id: existing.id });

      for (const email of ['taken@maqady.example', 'TAKEN@Maqady.Example', admin.email]) {
        expectError(await invite({ fullName: 'Dup', email, role: 'admin' }), 409, 'EMAIL_TAKEN');
      }
      expect(await testApp.knex('one_time_tokens').count<{ n: number }[]>({ n: 'id' })).toEqual([
        { n: 0 },
      ]);
      expect(await readMessages(testApp.knex)).toEqual([]);
    });

    it('validates the invite form', async () => {
      for (const body of [
        { fullName: '   ', email: 'a@maqady.example', role: 'admin' },
        { fullName: 'A', email: 'not-an-email', role: 'admin' },
        { fullName: 'A', email: '"a b"@maqady.example', role: 'admin' },
        { fullName: 'A', email: 'a@maqady.example', role: 'owner' },
        { fullName: 'x'.repeat(101), email: 'a@maqady.example', role: 'admin' },
        { fullName: 'A', email: 'a@maqady.example', role: 'admin', status: 'active' },
      ]) {
        expectError(await invite(body), 400, 'VALIDATION_FAILED');
      }
    });
  });

  describe('resending an invite', () => {
    it('voids the previous link; the new one works', async () => {
      const email = 'karim@maqady.example';
      const { body } = await invite({ fullName: 'Karim Nabil', email, role: 'box_office' });
      const firstToken = await lastLinkTo(email);

      const resent = await resend(body.id);
      expect(resent.status).toBe(201);
      expect(resent.body).toEqual({
        staffUserId: body.id,
        expiresAt: expect.stringMatching(/\+0[23]:00$/),
      });
      const secondToken = await lastLinkTo(email);
      expect(secondToken).not.toBe(firstToken);
      expect(await tokenRows(body.id)).toEqual([{ purpose: 'staff_invite', used_at: null }]);

      expectError(await setUp(firstToken), 400, 'INVALID_TOKEN');
      expect((await setUp(secondToken)).status).toBe(204);
      expect(await auditActions(body.id)).toEqual([
        'staff_user.invited',
        'staff_user.invite_resent',
        'staff_user.password_set',
      ]);
    });

    it('answers NOT_INVITED for an active member and NOT_FOUND for an unknown one', async () => {
      const active = await createStaffMember(testApp, { role: 'box_office' });
      const refused = await resend(active.id);
      expectError(refused, 409, 'NOT_INVITED');
      expect(refused.body.error.details).toEqual({ status: 'active' });
      expectError(await resend(99_999), 404, 'NOT_FOUND');
      expectError(
        await testApp
          .http()
          .post(`${STAFF}/abc/invitations`)
          .set('Authorization', admin.authorization)
          .set('Idempotency-Key', randomUUID())
          .send(),
        400,
        'VALIDATION_FAILED',
      );
      expect(await readMessages(testApp.knex)).toEqual([]);
    });

    it('works again for a member deactivated before setting a password, once reactivated', async () => {
      const email = 'dina@maqady.example';
      const { body } = await invite({ fullName: 'Dina Fawzy', email, role: 'box_office' });
      const firstToken = await lastLinkTo(email);
      const patch = (status: string) =>
        testApp
          .http()
          .patch(`${STAFF}/${body.id}`)
          .set('Authorization', admin.authorization)
          .send({ status });

      expect((await patch('deactivated')).status).toBe(200);
      expectError(await resend(body.id), 409, 'NOT_INVITED');
      expectError(await setUp(firstToken), 400, 'INVALID_TOKEN');

      expect((await patch('active')).body.status).toBe('invited');
      expect((await resend(body.id)).status).toBe(201);
      expect((await setUp(await lastLinkTo(email))).status).toBe(204);
      expect((await memberRow(body.id))?.status).toBe('active');
    });

    it('refuses an invite link after 72 hours and leaves the member invited; a resend works', async () => {
      const email = 'late@maqady.example';
      const { body } = await invite({ fullName: 'Late Joiner', email, role: 'admin' });
      const token = await lastLinkTo(email);

      clock.advance({ hours: 72, seconds: 1 });
      expectError(await setUp(token), 400, 'INVALID_TOKEN');
      expect(await memberRow(body.id)).toEqual({ status: 'invited', password_hash: null });

      // The admin's 12-hour session ended meanwhile; a fresh one resends.
      const later = await signInStaff(testApp, admin.email, admin.password);
      expect((await resend(body.id, later)).status).toBe(201);
      expect((await setUp(await lastLinkTo(email))).status).toBe(204);
    });

    it('accepts an invite link just before 72 hours', async () => {
      const email = 'ontime@maqady.example';
      await invite({ fullName: 'On Time', email, role: 'admin' });
      const token = await lastLinkTo(email);
      clock.advance({ hours: 71, minutes: 59 });
      expect((await setUp(token)).status).toBe(204);
    });
  });

  describe('setting a password', () => {
    async function invitedMember(email: string): Promise<{ id: number; token: string }> {
      const { body } = await invite({ fullName: 'New Member', email, role: 'box_office' });
      return { id: body.id as number, token: await lastLinkTo(email) };
    }

    it('works once: the same link again is INVALID_TOKEN', async () => {
      const { token } = await invitedMember('once@maqady.example');
      expect((await setUp(token)).status).toBe(204);
      expectError(await setUp(token, 'Another2026'), 400, 'INVALID_TOKEN');
    });

    it('lets one of two concurrent setups with one link win', async () => {
      const { id, token } = await invitedMember('race@maqady.example');
      const results = await Promise.all([setUp(token, 'FirstPass1'), setUp(token, 'SecondPass2')]);
      expect(results.map((result) => result.status).sort()).toEqual([204, 400]);
      expect(results.find((result) => result.status === 400)?.body.error.code).toBe(
        'INVALID_TOKEN',
      );
      expect(await tokenRows(id)).toEqual([{ purpose: 'staff_invite', used_at: expect.any(Date) }]);
    });

    it('refuses a weak password without spending the link', async () => {
      const { token } = await invitedMember('weak@maqady.example');
      for (const password of ['short1', 'no-digits-here', 'x'.repeat(120) + '1'.repeat(9)]) {
        expectError(await setUp(token, password), 400, 'VALIDATION_FAILED');
      }
      expect((await setUp(token)).status).toBe(204);
    });

    it('answers INVALID_TOKEN for an unknown, malformed or empty-looking token, never VALIDATION_FAILED', async () => {
      for (const token of ['q3VbI2vT0xSx5n2b7i1d9mJ8kQe4zW6yR0tP5uL3aGc', 'abc', 'x'.repeat(128)]) {
        expectError(await setUp(token), 400, 'INVALID_TOKEN');
      }
      expectError(await setUp(''), 400, 'VALIDATION_FAILED');
      expectError(await setUp('x'.repeat(129)), 400, 'VALIDATION_FAILED');
    });

    it('refuses the link of a member deactivated after the invite (the link is gone)', async () => {
      const { id, token } = await invitedMember('gone@maqady.example');
      await testApp
        .http()
        .patch(`${STAFF}/${id}`)
        .set('Authorization', admin.authorization)
        .send({ status: 'deactivated' })
        .expect(200);
      expectError(await setUp(token), 400, 'INVALID_TOKEN');
      expect(await memberRow(id)).toEqual({ status: 'deactivated', password_hash: null });
    });

    it('waits for a deactivation in flight instead of deadlocking with it, then refuses the link', async () => {
      const { id, token } = await invitedMember('inflight@maqady.example');

      // A deactivation as U2a runs it: lock the member, then delete their unused links.
      const deactivation = await testApp.knex.transaction();
      try {
        await deactivation.raw('SELECT id FROM staff_users WHERE id = ? FOR NO KEY UPDATE', [id]);
        const setup = setUp(token).then((response) => response);
        await waitForLockWaiters(testApp.knex, 1);
        // The setup waits on the member and holds no lock on the link: had it used the link
        // first, this would fail (55P03), and the delete below would deadlock with it.
        await expect(
          deactivation.raw(
            'SELECT id FROM one_time_tokens WHERE staff_user_id = ? FOR UPDATE NOWAIT',
            [id],
          ),
        ).resolves.toBeDefined();
        await deactivation('one_time_tokens')
          .where({ staff_user_id: id })
          .whereNull('used_at')
          .delete();
        await deactivation('staff_users').update({ status: 'deactivated' }).where({ id });
        await deactivation.commit();
        expectError(await setup, 400, 'INVALID_TOKEN');
      } finally {
        if (!deactivation.isCompleted()) await deactivation.rollback();
      }
      expect(await memberRow(id)).toEqual({ status: 'deactivated', password_hash: null });
    });
  });

  describe('forgot password', () => {
    it('answers 202 with no body for every email, and emails only an active member', async () => {
      const active = await createStaffMember(testApp, {
        role: 'box_office',
        email: 'active@maqady.example',
      });
      await invite({ fullName: 'Invited', email: 'invited@maqady.example', role: 'box_office' });
      const off = await createStaffMember(testApp, {
        role: 'box_office',
        email: 'off@maqady.example',
      });
      await testApp.knex('staff_users').update({ status: 'deactivated' }).where({ id: off.id });
      await drain.whenIdle();
      sender.reset();
      const before = await readMessages(testApp.knex);

      for (const email of [
        'nobody@maqady.example',
        'invited@maqady.example',
        'off@maqady.example',
        ' ACTIVE@maqady.example ',
      ]) {
        const response = await requestReset(email);
        expect({ email, status: response.status, body: response.text }).toEqual({
          email,
          status: 202,
          body: '',
        });
      }

      const added = (await readMessages(testApp.knex)).slice(before.length);
      expect(added).toEqual([
        expect.objectContaining({
          template: 'staff.password_reset',
          recipient: 'active@maqady.example',
          related_staff_user_id: active.id,
        }),
      ]);
      expect(added[0]!.body_text).toContain(REDACTED_LINK);
      expect((await emailsTo('active@maqady.example')).length).toBe(1);
      expect(sender.calls).toHaveLength(1);
      expect(
        await testApp
          .knex('one_time_tokens')
          .where({ purpose: 'staff_password_reset' })
          .pluck('staff_user_id'),
      ).toEqual([active.id]);
      expect(await auditActions(active.id)).toContain('staff_user.password_reset_requested');
    });

    it('validates the email', async () => {
      expectError(await requestReset('not-an-email'), 400, 'VALIDATION_FAILED');
      expectError(
        await testApp.http().post(RESET_REQUESTS).send({ email: 'a@maqady.example', extra: 1 }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('resets once: the new password signs in, the old one and old sessions stop working', async () => {
      const member = await staffSession(testApp, 'box_office', { email: 'reset@maqady.example' });
      expect((await requestReset(member.email)).status).toBe(202);
      const token = await lastLinkTo(member.email);
      expect((await emailsTo(member.email))[0]!.subject).toBe(
        'Reset your Maqady dashboard password',
      );

      expect((await setUp(token)).status).toBe(204);
      expectError(
        await testApp.http().post(SIGN_IN).send({ email: member.email, password: member.password }),
        401,
        'INVALID_CREDENTIALS',
      );
      expect(
        (await testApp.http().post(SIGN_IN).send({ email: member.email, password: NEW_PASSWORD }))
          .status,
      ).toBe(201);
      expectError(
        await testApp.http().get(ME).set('Authorization', member.authorization),
        401,
        'SESSION_REVOKED',
      );
      expectError(await setUp(token, 'Another2026'), 400, 'INVALID_TOKEN');

      const [event] = await testApp
        .knex('audit_events')
        .select('changed_fields', 'metadata')
        .where({ action: 'staff_user.password_set' });
      expect(event).toEqual({
        changed_fields: ['password'],
        metadata: { purpose: 'staff_password_reset' },
      });
    });

    it('voids the previous reset link when another is requested', async () => {
      const member = await createStaffMember(testApp, { role: 'admin' });
      await requestReset(member.email);
      const first = await lastLinkTo(member.email);
      await requestReset(member.email);
      const second = await lastLinkTo(member.email);

      expectError(await setUp(first), 400, 'INVALID_TOKEN');
      expect((await setUp(second)).status).toBe(204);
    });

    it('refuses a reset link after 1 hour', async () => {
      const member = await createStaffMember(testApp, { role: 'admin' });
      await requestReset(member.email);
      const token = await lastLinkTo(member.email);
      clock.advance({ hours: 1, seconds: 1 });
      expectError(await setUp(token), 400, 'INVALID_TOKEN');
    });

    it('opens no session for the old password when a sign-in checked it while the reset was in flight', async () => {
      const member = await createStaffMember(testApp, {
        role: 'box_office',
        email: 'racing@maqady.example',
      });
      await requestReset(member.email);
      const token = await lastLinkTo(member.email);

      // Hold the member's row so both contenders queue on it: the setup first, then a sign-in
      // that has already checked the old password against the old hash.
      const holder = await testApp.knex.transaction();
      let setup: Promise<Response>;
      let signIn: Promise<Response>;
      try {
        await holder.raw('SELECT id FROM staff_users WHERE id = ? FOR NO KEY UPDATE', [member.id]);
        setup = setUp(token).then((response) => response);
        await waitForLockWaiters(testApp.knex, 1);
        signIn = testApp
          .http()
          .post(SIGN_IN)
          .send({ email: member.email, password: member.password })
          .then((response) => response);
        await waitForLockWaiters(testApp.knex, 2);
      } finally {
        await holder.rollback();
      }

      expect((await setup).status).toBe(204);
      expectError(await signIn, 401, 'INVALID_CREDENTIALS');
      const live = await testApp
        .knex('sessions')
        .where({ staff_user_id: member.id })
        .whereNull('revoked_at')
        .count<{ count: string }[]>({ count: 'id' });
      expect(Number(live[0]!.count)).toBe(0);
    });
  });

  it('refuses a message that names a staff member who does not exist (fk_messages_related_staff_user_id)', async () => {
    const now = clock.now();
    await expect(
      testApp.knex('messages').insert({
        channel: 'sms',
        template: 'test.sms_notice',
        recipient: '+201001234567',
        body_text: 'x',
        status: 'queued',
        attempts: 0,
        next_attempt_at: now,
        payload_ciphertext: 'x',
        related_staff_user_id: 99_999,
        created_at: now,
        updated_at: now,
      }),
    ).rejects.toMatchObject({ constraint: 'fk_messages_related_staff_user_id' });
  });
});
