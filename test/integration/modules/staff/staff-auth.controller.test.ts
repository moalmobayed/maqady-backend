import type { Response } from 'supertest';
import { AccessTokenService } from '../../../../src/common/auth/access-token.service';
import { TestClock } from '../../../support/clock';
import { createStaffMember, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { CreatedStaffMember, TestApp } from '../../../support/types';

// The project-level `testTimeout` in jest.config.js is not applied (Jest reads it globally), and
// these suites hash real passwords with scrypt, so they set their own.
jest.setTimeout(60_000);

const SIGN_IN = '/api/v1/admin/auth/sessions';
const REFRESH = '/api/v1/admin/auth/tokens';
const SIGN_OUT = '/api/v1/admin/auth/sessions/current';
const ME = '/api/v1/admin/me';
const CAIRO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[23]:00$/;

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

describe('Staff auth routes (integration)', () => {
  let testApp: TestApp;
  const clock = new TestClock();

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    clock.set(new Date());
  });

  const signIn = (email: string, password: string) =>
    testApp.http().post(SIGN_IN).send({ email, password });
  const refresh = (refreshToken: string) => testApp.http().post(REFRESH).send({ refreshToken });
  const me = (accessToken: string) =>
    testApp.http().get(ME).set('Authorization', `Bearer ${accessToken}`);
  const sessionRows = (staffUserId: number) =>
    testApp
      .knex('sessions')
      .select<
        {
          id: number;
          family_id: string;
          rotated_at: Date | null;
          replaced_by_id: number | null;
          revoked_at: Date | null;
          revoked_reason: string | null;
        }[]
      >('id', 'family_id', 'rotated_at', 'replaced_by_id', 'revoked_at', 'revoked_reason')
      .where({ staff_user_id: staffUserId })
      .orderBy('id');

  describe('POST /admin/auth/sessions (sign-in)', () => {
    let member: CreatedStaffMember;

    beforeAll(async () => {
      member = await createStaffMember(testApp, {
        role: 'admin',
        fullName: 'Mona Adel',
        email: 'mona.adel@maqady.example',
      });
    });

    it('signs in: tokens that open GET /admin/me, last sign-in recorded, one audit row', async () => {
      const response = await signIn('mona.adel@maqady.example', member.password);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        accessTokenExpiresAt: expect.stringMatching(CAIRO_INSTANT),
        refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        refreshTokenExpiresAt: expect.stringMatching(CAIRO_INSTANT),
        staff: {
          id: member.id,
          fullName: 'Mona Adel',
          email: 'mona.adel@maqady.example',
          role: 'admin',
        },
      });
      expect(
        Date.parse(response.body.refreshTokenExpiresAt) -
          Date.parse(response.body.accessTokenExpiresAt),
      ).toBe((12 * 60 - 15) * 60 * 1000);

      const profile = await me(response.body.accessToken);
      expect(profile.status).toBe(200);
      expect(profile.body).toEqual(response.body.staff);

      const [row] = await testApp
        .knex('staff_users')
        .select('last_sign_in_at')
        .where({ id: member.id });
      expect(row.last_sign_in_at).toEqual(clock.now());
      const audits = await testApp
        .knex('audit_events')
        .select('actor_staff_user_id', 'entity_type', 'metadata')
        .where({ action: 'session.created', actor_staff_user_id: member.id });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toEqual({
        actor_staff_user_id: member.id,
        entity_type: 'session',
        metadata: { audience: 'staff' },
      });
    });

    it('matches the email case-insensitively and stores only the refresh token hash', async () => {
      const response = await signIn('MONA.ADEL@Maqady.Example', member.password);
      expect(response.status).toBe(201);
      const hashes = await testApp.knex('sessions').pluck('token_hash');
      expect(hashes).not.toContain(response.body.refreshToken);
      expect(hashes.every((hash: string) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    });

    it('answers INVALID_CREDENTIALS for a wrong password and an unknown email, opening no session', async () => {
      const before = await testApp.knex('sessions').count({ n: 'id' });
      expectError(
        await signIn('mona.adel@maqady.example', 'wrong-password-1'),
        401,
        'INVALID_CREDENTIALS',
      );
      expectError(
        await signIn('nobody@maqady.example', member.password),
        401,
        'INVALID_CREDENTIALS',
      );
      expect(await testApp.knex('sessions').count({ n: 'id' })).toEqual(before);
    });

    it('answers ACCOUNT_DEACTIVATED for a deactivated member with the right password, INVALID_CREDENTIALS with a wrong one', async () => {
      const gone = await createStaffMember(testApp, { role: 'box_office' });
      await testApp.knex('staff_users').update({ status: 'deactivated' }).where({ id: gone.id });

      expectError(await signIn(gone.email, gone.password), 403, 'ACCOUNT_DEACTIVATED');
      expectError(await signIn(gone.email, 'wrong-password-1'), 401, 'INVALID_CREDENTIALS');
      expect(await sessionRows(gone.id)).toEqual([]);
    });

    it('answers INVALID_CREDENTIALS for an invited member, who has no password yet', async () => {
      const now = clock.now();
      await testApp.knex('staff_users').insert({
        email: 'invited@maqady.example',
        full_name: 'Invited Member',
        role: 'box_office',
        status: 'invited',
        password_hash: null,
        created_at: now,
        updated_at: now,
      });
      expectError(await signIn('invited@maqady.example', ''), 400, 'VALIDATION_FAILED');
      expectError(await signIn('invited@maqady.example', 'anything-1'), 401, 'INVALID_CREDENTIALS');
    });

    it('validates the body and never stores the response for an Idempotency-Key', async () => {
      const invalid = await testApp
        .http()
        .post(SIGN_IN)
        .send({ email: 'not-an-email', password: 'x', extra: 1 });
      expectError(invalid, 400, 'VALIDATION_FAILED');
      expect(
        (invalid.body.error.details.fields as { field: string }[])
          .map((field) => field.field)
          .sort(),
      ).toEqual(['email', 'extra']);

      const key = 'sign-in-key-1';
      const first = await signIn('mona.adel@maqady.example', member.password).set(
        'Idempotency-Key',
        key,
      );
      const second = await signIn('mona.adel@maqady.example', member.password).set(
        'Idempotency-Key',
        key,
      );
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(second.headers['idempotent-replayed']).toBeUndefined();
      expect(second.body.refreshToken).not.toBe(first.body.refreshToken);
      expect(await testApp.knex('idempotency_keys').count({ n: 'id' })).toEqual([{ n: 0 }]);
    });
  });

  describe('POST /admin/auth/tokens (refresh)', () => {
    it('rotates: a new pair, the old row rotated into the new one, the new access token working', async () => {
      const session = await staffSession(testApp, 'box_office');
      const response = await refresh(session.refreshToken);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        accessToken: expect.any(String),
        accessTokenExpiresAt: expect.stringMatching(CAIRO_INSTANT),
        refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        refreshTokenExpiresAt: expect.stringMatching(CAIRO_INSTANT),
      });
      expect(response.body.refreshToken).not.toBe(session.refreshToken);

      const [old, next, ...rest] = await sessionRows(session.staffUserId);
      expect(rest).toEqual([]);
      expect(old).toMatchObject({
        id: session.sessionId,
        replaced_by_id: next!.id,
        revoked_at: null,
      });
      expect(old!.rotated_at).toEqual(clock.now());
      expect(next).toMatchObject({
        family_id: old!.family_id,
        rotated_at: null,
        revoked_at: null,
      });
      expect((await me(response.body.accessToken)).status).toBe(200);
    });

    it('keeps the session expiry of the sign-in: refreshing never extends it', async () => {
      const signedIn = await signIn(
        (await createStaffMember(testApp, { role: 'admin' })).email,
        'Passw0rd-staff',
      );
      clock.advance({ hours: 3 });
      const refreshed = await refresh(signedIn.body.refreshToken);
      expect(refreshed.status).toBe(201);
      expect(refreshed.body.refreshTokenExpiresAt).toBe(signedIn.body.refreshTokenExpiresAt);
    });

    it('answers REFRESH_CONFLICT within 30 seconds of the rotation and revokes nothing, then SESSION_REVOKED for the whole family after', async () => {
      const session = await staffSession(testApp, 'admin');
      const rotated = await refresh(session.refreshToken);
      expect(rotated.status).toBe(201);

      clock.advance({ seconds: 29 });
      expectError(await refresh(session.refreshToken), 409, 'REFRESH_CONFLICT');
      expect((await sessionRows(session.staffUserId)).every((row) => row.revoked_at === null)).toBe(
        true,
      );
      expect((await me(rotated.body.accessToken)).status).toBe(200);

      clock.advance({ seconds: 2 });
      expectError(await refresh(session.refreshToken), 401, 'SESSION_REVOKED');

      // Committed, not rolled back with the error: every row of the family is revoked for reuse.
      const rows = await sessionRows(session.staffUserId);
      expect(rows.map((row) => row.revoked_reason)).toEqual(['refresh_reuse', 'refresh_reuse']);
      expectError(await me(rotated.body.accessToken), 401, 'SESSION_REVOKED');
      expectError(await refresh(rotated.body.refreshToken), 401, 'SESSION_REVOKED');
      const [audit] = await testApp
        .knex('audit_events')
        .select('actor_kind', 'entity_id')
        .where({ action: 'session.reuse_detected' });
      expect(audit).toEqual({ actor_kind: 'system', entity_id: session.sessionId });
    });

    it('lets two concurrent refreshes of one token produce one rotation and one REFRESH_CONFLICT', async () => {
      const session = await staffSession(testApp, 'admin');
      const responses = await Promise.all([
        refresh(session.refreshToken),
        refresh(session.refreshToken),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.error.code).toBe(
        'REFRESH_CONFLICT',
      );
      expect(await sessionRows(session.staffUserId)).toHaveLength(2);
    });

    it('answers SESSION_EXPIRED 12 hours after sign-in, on refresh and on the next request', async () => {
      const session = await staffSession(testApp, 'admin');
      clock.advance({ hours: 11, minutes: 59 });
      const late = await refresh(session.refreshToken);
      expect(late.status).toBe(201);

      clock.advance({ minutes: 2 });
      expectError(await me(late.body.accessToken), 401, 'SESSION_EXPIRED');
      expectError(await refresh(late.body.refreshToken), 401, 'SESSION_EXPIRED');
    });

    it('answers VALIDATION_FAILED for a malformed token and UNAUTHENTICATED for one nobody issued', async () => {
      expectError(await refresh('not-a-token'), 400, 'VALIDATION_FAILED');
      expectError(await refresh('Z'.repeat(43)), 401, 'UNAUTHENTICATED');
    });

    it('refuses a member an admin deactivated with ACCOUNT_DEACTIVATED, as every route does, and rotates nothing', async () => {
      const admin = await staffSession(testApp, 'admin');
      const session = await staffSession(testApp, 'box_office');
      const deactivated = await testApp
        .http()
        .patch(`/api/v1/admin/staff/${session.staffUserId}`)
        .set('Authorization', admin.authorization)
        .send({ status: 'deactivated' });
      expect(deactivated.status).toBe(200);

      // The deactivation also revoked the session; the account's state is still the answer.
      expectError(await refresh(session.refreshToken), 403, 'ACCOUNT_DEACTIVATED');
      expectError(await me(session.accessToken), 403, 'ACCOUNT_DEACTIVATED');
      expect(await sessionRows(session.staffUserId)).toEqual([
        expect.objectContaining({ rotated_at: null, revoked_reason: 'account_deactivated' }),
      ]);
    });
  });

  describe('DELETE /admin/auth/sessions/current (sign-out)', () => {
    it('revokes the whole family: the access token and every refresh token stop at once', async () => {
      const session = await staffSession(testApp, 'box_office');
      const refreshed = await refresh(session.refreshToken);
      const other = await signIn(session.email, session.password);

      const response = await testApp
        .http()
        .delete(SIGN_OUT)
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
      expect(response.status).toBe(204);
      expect(response.text).toBe('');

      expectError(await me(refreshed.body.accessToken), 401, 'SESSION_REVOKED');
      expectError(await me(session.accessToken), 401, 'SESSION_REVOKED');
      expectError(await refresh(refreshed.body.refreshToken), 401, 'SESSION_REVOKED');
      // Another browser's session stays signed in.
      expect((await me(other.body.accessToken)).status).toBe(200);

      const reasons = (await sessionRows(session.staffUserId)).map((row) => row.revoked_reason);
      expect(reasons).toEqual(['sign_out', 'sign_out', null]);
    });

    it('needs a staff token', async () => {
      expectError(await testApp.http().delete(SIGN_OUT), 401, 'UNAUTHENTICATED');
    });
  });

  describe('GET /admin/me', () => {
    it('refuses a customer-audience token and a token for a session that does not exist', async () => {
      const tokens = testApp.app.get(AccessTokenService);
      const session = await staffSession(testApp, 'admin');
      const customer = tokens.sign({
        audience: 'customer',
        subjectId: session.staffUserId,
        sessionId: session.sessionId,
      });
      expectError(await me(customer), 401, 'UNAUTHENTICATED');

      const forged = tokens.sign({
        audience: 'staff',
        subjectId: session.staffUserId,
        sessionId: 999_999,
      });
      expectError(await me(forged), 401, 'UNAUTHENTICATED');
      const otherMember = tokens.sign({
        audience: 'staff',
        subjectId: session.staffUserId + 1000,
        sessionId: session.sessionId,
      });
      expectError(await me(otherMember), 401, 'UNAUTHENTICATED');
    });
  });
});
