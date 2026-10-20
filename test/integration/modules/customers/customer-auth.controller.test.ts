import type { Response } from 'supertest';
import { REDACTED_LINK } from '../../../../src/modules/messaging/messaging.constants';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import type { OutgoingEmail } from '../../../../src/modules/messaging/types';
import { TestClock } from '../../../support/clock';
import {
  blockCustomer,
  customerLinkToken,
  DEFAULT_CUSTOMER_PASSWORD,
  registerCustomer,
} from '../../../support/customer-auth';
import { readMessages } from '../../../support/messaging/messages';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

// These suites hash real passwords with scrypt; the project-level testTimeout is not applied.
jest.setTimeout(60_000);

const REGISTER = '/api/v1/auth/registrations';
const SIGN_IN = '/api/v1/auth/sessions';
const REFRESH = '/api/v1/auth/tokens';
const SIGN_OUT = '/api/v1/auth/sessions/current';
const VERIFY = '/api/v1/auth/email-verifications';
const RESEND = '/api/v1/auth/email-verification-requests';
const FORGOT = '/api/v1/auth/password-reset-requests';
const RESET = '/api/v1/auth/password-resets';
const ME = '/api/v1/me';
const STAFF_REFRESH = '/api/v1/admin/auth/tokens';
const CAIRO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[23]:00$/;

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

describe('Customer auth routes (integration)', () => {
  let testApp: TestApp;
  let drain: OutboxDrainService;
  const sender = new RecordingEmailSender();
  const clock = new TestClock();

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    drain = testApp.app.get(OutboxDrainService);
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    // Whole seconds: response times are written without milliseconds.
    clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  });

  afterEach(async () => {
    await drain.whenIdle();
    sender.reset();
  });

  const register = (body: Record<string, unknown>) => testApp.http().post(REGISTER).send(body);
  const signIn = (email: string, password: string) =>
    testApp.http().post(SIGN_IN).send({ email, password });
  const refresh = (refreshToken: string, path = REFRESH) =>
    testApp.http().post(path).send({ refreshToken });
  const me = (accessToken: string) =>
    testApp.http().get(ME).set('Authorization', `Bearer ${accessToken}`);
  const sentTo = (email: string): OutgoingEmail[] =>
    sender.calls.filter((call) => call.to === email);
  const customerRow = (id: number) =>
    testApp
      .knex('customers')
      .select<
        {
          email: string;
          full_name: string;
          email_verified_at: Date | null;
          last_sign_in_at: Date | null;
          password_hash: string;
        }[]
      >('email', 'full_name', 'email_verified_at', 'last_sign_in_at', 'password_hash')
      .where({ id })
      .first();
  const sessionRows = (customerId: number) =>
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
      .where({ customer_id: customerId })
      .orderBy('id');
  const tokenRows = (customerId: number) =>
    testApp
      .knex('one_time_tokens')
      .select<{ purpose: string; used_at: Date | null }[]>('purpose', 'used_at')
      .where({ customer_id: customerId })
      .orderBy('id');

  describe('POST /auth/registrations, then the verification link', () => {
    it('signs up, queues a redacted verification email, sends the real link, and verifies with it once', async () => {
      const response = await register({
        fullName: '  Layla Hassan ',
        email: ' Layla.Hassan@Example.com ',
        password: 'Cinema2026',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        accessTokenExpiresAt: expect.stringMatching(CAIRO_INSTANT),
        refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        refreshTokenExpiresAt: expect.stringMatching(CAIRO_INSTANT),
        customer: {
          id: expect.any(Number),
          fullName: 'Layla Hassan',
          email: 'Layla.Hassan@Example.com',
          phone: null,
          emailVerified: false,
          emailVerifiedAt: null,
          memberSince: expect.stringMatching(CAIRO_INSTANT),
        },
      });
      const customerId = response.body.customer.id as number;
      expect(new Date(response.body.refreshTokenExpiresAt as string).getTime()).toBe(
        clock.now().getTime() + 30 * 24 * 3600 * 1000,
      );

      // The tokens work at once; the customer is signed in, not yet verified.
      const profile = await me(response.body.accessToken as string);
      expect(profile.status).toBe(200);
      expect(profile.body).toEqual(response.body.customer);

      const row = await customerRow(customerId);
      expect(row).toMatchObject({ full_name: 'Layla Hassan', email_verified_at: null });
      expect(row!.last_sign_in_at).toEqual(clock.now());
      expect(row!.password_hash).toMatch(/^scrypt\$/);
      expect(await tokenRows(customerId)).toEqual([{ purpose: 'verify_email', used_at: null }]);
      expect(await sessionRows(customerId)).toHaveLength(1);

      // Stored: one message, the link redacted in every copy.
      const messages = (await readMessages(testApp.knex)).filter(
        (message) => message.related_customer_id === customerId,
      );
      expect(messages).toHaveLength(1);
      const [stored] = messages;
      expect(stored).toMatchObject({
        channel: 'email',
        template: 'customer.verify_email',
        recipient: 'Layla.Hassan@Example.com',
        subject: 'Confirm your email for Maqady',
      });
      for (const part of [stored!.subject, stored!.body_text, stored!.body_html]) {
        expect(part).not.toContain('token=');
      }
      expect(stored!.body_text).toContain(REDACTED_LINK);
      expect(stored!.body_html).toContain(REDACTED_LINK);

      // Sent: the real link, whose token verifies the email once.
      await drain.whenIdle();
      const [email] = sentTo('Layla.Hassan@Example.com');
      expect(email).toBeDefined();
      const token = customerLinkToken(email!.text, '/verify-email');
      expect(email!.html).toContain(`/verify-email?token=${token}`);
      expect(stored!.body_text).not.toContain(token);

      const verified = await testApp.http().post(VERIFY).send({ token });
      expect(verified.status).toBe(204);
      expect(verified.text).toBe('');
      const after = await me(response.body.accessToken as string);
      expect(after.body).toMatchObject({
        emailVerified: true,
        emailVerifiedAt: expect.stringMatching(CAIRO_INSTANT),
      });

      expectError(await testApp.http().post(VERIFY).send({ token }), 400, 'INVALID_TOKEN');
    });

    it('refuses a verification link after its 24 hours and a mangled one', async () => {
      const customer = await registerCustomer(testApp);
      await drain.whenIdle();
      const token = customerLinkToken(sentTo(customer.email)[0]!.text, '/verify-email');

      clock.advance({ hours: 24 });
      expectError(await testApp.http().post(VERIFY).send({ token }), 400, 'INVALID_TOKEN');
      expectError(
        await testApp
          .http()
          .post(VERIFY)
          .send({ token: `${token.slice(0, 20)}x` }),
        400,
        'INVALID_TOKEN',
      );
      expectError(await testApp.http().post(VERIFY).send({}), 400, 'VALIDATION_FAILED');
      expect((await customerRow(customer.customerId))!.email_verified_at).toBeNull();
    });

    it('resends a fresh link that replaces the old one, and sends nothing once verified', async () => {
      const customer = await registerCustomer(testApp);
      await drain.whenIdle();
      const first = customerLinkToken(sentTo(customer.email)[0]!.text, '/verify-email');

      const resent = await testApp.http().post(RESEND).set('Authorization', customer.authorization);
      expect(resent.status).toBe(202);
      expect(resent.text).toBe('');
      await drain.whenIdle();
      const emails = sentTo(customer.email);
      expect(emails).toHaveLength(2);
      const second = customerLinkToken(emails[1]!.text, '/verify-email');
      expect(second).not.toBe(first);

      expectError(await testApp.http().post(VERIFY).send({ token: first }), 400, 'INVALID_TOKEN');
      expect((await testApp.http().post(VERIFY).send({ token: second })).status).toBe(204);

      const again = await testApp.http().post(RESEND).set('Authorization', customer.authorization);
      expect(again.status).toBe(202);
      await drain.whenIdle();
      expect(sentTo(customer.email)).toHaveLength(2);
      expectError(await testApp.http().post(RESEND), 401, 'UNAUTHENTICATED');
    });

    it('answers EMAIL_TAKEN for an email already registered, in any case, writing nothing', async () => {
      const existing = await registerCustomer(testApp, { email: 'omar.fathy@example.com' });
      const before = await Promise.all(
        ['customers', 'one_time_tokens', 'messages', 'sessions'].map(async (table) =>
          Number((await testApp.knex(table).count({ n: '*' }))[0]!.n),
        ),
      );

      const response = await register({
        fullName: 'Someone Else',
        email: 'OMAR.FATHY@example.com',
        password: 'Cinema2026',
      });
      expectError(response, 409, 'EMAIL_TAKEN');

      const after = await Promise.all(
        ['customers', 'one_time_tokens', 'messages', 'sessions'].map(async (table) =>
          Number((await testApp.knex(table).count({ n: '*' }))[0]!.n),
        ),
      );
      expect(after).toEqual(before);
      expect((await customerRow(existing.customerId))!.full_name).not.toBe('Someone Else');
    });

    it('lets one of two concurrent registrations of an email win; the other is EMAIL_TAKEN', async () => {
      const body = { fullName: 'Nour Ali', email: 'nour.ali@example.com', password: 'Cinema2026' };
      const responses = await Promise.all([register(body), register(body)]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(
        await testApp.knex('customers').count({ n: '*' }).where({ email: 'nour.ali@example.com' }),
      ).toEqual([{ n: 1 }]);
    });

    it('refuses a weak password, a bad email and unknown fields', async () => {
      const base = { fullName: 'Layla', email: 'weak@example.com', password: 'Cinema2026' };
      for (const body of [
        { ...base, password: 'nodigits' },
        { ...base, password: 'Sh0rt' },
        { ...base, email: 'not-an-email' },
        { ...base, fullName: '   ' },
        { ...base, phone: '+201012345678' },
      ]) {
        expectError(await register(body), 400, 'VALIDATION_FAILED');
      }
      expect(
        await testApp.knex('customers').count({ n: '*' }).where({ email: 'weak@example.com' }),
      ).toEqual([{ n: 0 }]);
    });
  });

  describe('POST /auth/sessions (sign-in)', () => {
    it('signs in with the email in any case and records the sign-in', async () => {
      const customer = await registerCustomer(testApp, { email: 'sara.adel@example.com' });
      clock.advance({ hours: 1 });

      const response = await signIn('SARA.Adel@example.com', DEFAULT_CUSTOMER_PASSWORD);
      expect(response.status).toBe(201);
      expect(response.body.customer).toMatchObject({
        id: customer.customerId,
        email: 'sara.adel@example.com',
      });
      expect((await me(response.body.accessToken as string)).status).toBe(200);
      expect((await customerRow(customer.customerId))!.last_sign_in_at).toEqual(clock.now());
      expect(await sessionRows(customer.customerId)).toHaveLength(2);
    });

    it('answers INVALID_CREDENTIALS for a wrong password and an unknown email, opening no session', async () => {
      const customer = await registerCustomer(testApp);
      expectError(await signIn(customer.email, 'Wrong-pass1'), 401, 'INVALID_CREDENTIALS');
      expectError(
        await signIn('nobody-here@example.com', DEFAULT_CUSTOMER_PASSWORD),
        401,
        'INVALID_CREDENTIALS',
      );
      expect(await sessionRows(customer.customerId)).toHaveLength(1);
    });

    it('answers ACCOUNT_BLOCKED to a blocked customer only once the password matched', async () => {
      const customer = await registerCustomer(testApp);
      await blockCustomer(testApp, customer.customerId);

      expectError(await signIn(customer.email, 'Wrong-pass1'), 401, 'INVALID_CREDENTIALS');
      expectError(await signIn(customer.email, DEFAULT_CUSTOMER_PASSWORD), 403, 'ACCOUNT_BLOCKED');
      const rows = await sessionRows(customer.customerId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.revoked_reason).toBe('account_blocked');
    });

    it('signs a blocked customer out at once: the access token and the refresh token stop working', async () => {
      const customer = await registerCustomer(testApp);
      expect((await me(customer.accessToken)).status).toBe(200);

      await blockCustomer(testApp, customer.customerId);
      expectError(await me(customer.accessToken), 403, 'ACCOUNT_BLOCKED');
      expectError(await refresh(customer.refreshToken), 401, 'SESSION_REVOKED');
      const audit = await testApp
        .knex('audit_events')
        .select('actor_kind', 'action', 'entity_type', 'entity_id', 'changed_fields', 'metadata')
        .where({ action: 'customer.status_changed', entity_id: customer.customerId });
      expect(audit).toEqual([
        {
          actor_kind: 'system',
          action: 'customer.status_changed',
          entity_type: 'customer',
          entity_id: customer.customerId,
          changed_fields: ['status'],
          metadata: { status: 'blocked' },
        },
      ]);
    });
  });

  describe('POST /auth/tokens (refresh)', () => {
    it('rotates the pair within the family, keeping the session end', async () => {
      const customer = await registerCustomer(testApp);
      const signedIn = await signIn(customer.email, DEFAULT_CUSTOMER_PASSWORD);
      clock.advance({ minutes: 5 });

      const response = await refresh(signedIn.body.refreshToken as string);
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        accessTokenExpiresAt: expect.stringMatching(CAIRO_INSTANT),
        refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        refreshTokenExpiresAt: signedIn.body.refreshTokenExpiresAt,
      });
      expect(response.body.refreshToken).not.toBe(signedIn.body.refreshToken);
      expect((await me(response.body.accessToken as string)).status).toBe(200);

      const rows = (await sessionRows(customer.customerId)).slice(1);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ rotated_at: clock.now(), replaced_by_id: rows[1]!.id });
      expect(rows[1]).toMatchObject({ family_id: rows[0]!.family_id, rotated_at: null });
    });

    it('answers REFRESH_CONFLICT within 30 seconds of a rotation, then revokes the family', async () => {
      const customer = await registerCustomer(testApp);
      const rotated = await refresh(customer.refreshToken);
      expect(rotated.status).toBe(201);

      clock.advance({ seconds: 10 });
      expectError(await refresh(customer.refreshToken), 409, 'REFRESH_CONFLICT');
      expect((await sessionRows(customer.customerId)).every((row) => row.revoked_at === null)).toBe(
        true,
      );
      expect((await me(rotated.body.accessToken as string)).status).toBe(200);

      clock.advance({ seconds: 21 });
      expectError(await refresh(customer.refreshToken), 401, 'SESSION_REVOKED');
      const rows = await sessionRows(customer.customerId);
      expect(rows.map((row) => row.revoked_reason)).toEqual(['refresh_reuse', 'refresh_reuse']);
      expectError(await me(rotated.body.accessToken as string), 401, 'SESSION_REVOKED');
      expectError(await refresh(rotated.body.refreshToken as string), 401, 'SESSION_REVOKED');
    });

    it('never mixes audiences: a staff refresh token here, a customer one at the staff route', async () => {
      const customer = await registerCustomer(testApp);
      const staff = await staffSession(testApp, 'box_office');
      expectError(await refresh(staff.refreshToken), 401, 'UNAUTHENTICATED');
      expectError(await refresh(customer.refreshToken, STAFF_REFRESH), 401, 'UNAUTHENTICATED');
      // Neither attempt spent the token.
      expect((await refresh(customer.refreshToken)).status).toBe(201);
      expect((await refresh(staff.refreshToken, STAFF_REFRESH)).status).toBe(201);
    });

    it('answers SESSION_EXPIRED 30 days after sign-in, on refresh and on a live access token', async () => {
      const customer = await registerCustomer(testApp);
      clock.advance({ days: 30, minutes: -5 });
      const late = await refresh(customer.refreshToken);
      expect(late.status).toBe(201);

      clock.advance({ minutes: 5 });
      expectError(await me(late.body.accessToken as string), 401, 'SESSION_EXPIRED');
      expectError(await refresh(late.body.refreshToken as string), 401, 'SESSION_EXPIRED');
    });

    it('refuses a malformed token and one nobody issued', async () => {
      expectError(await refresh('short'), 400, 'VALIDATION_FAILED');
      expectError(await refresh('A'.repeat(43)), 401, 'UNAUTHENTICATED');
    });
  });

  describe('DELETE /auth/sessions/current (sign-out)', () => {
    it('ends the session family: access and refresh tokens stop, other devices stay', async () => {
      const customer = await registerCustomer(testApp);
      const other = await signIn(customer.email, DEFAULT_CUSTOMER_PASSWORD);

      const response = await testApp
        .http()
        .delete(SIGN_OUT)
        .set('Authorization', customer.authorization);
      expect(response.status).toBe(204);
      expectError(await me(customer.accessToken), 401, 'SESSION_REVOKED');
      expectError(await refresh(customer.refreshToken), 401, 'SESSION_REVOKED');
      expect((await me(other.body.accessToken as string)).status).toBe(200);
      expectError(await testApp.http().delete(SIGN_OUT), 401, 'UNAUTHENTICATED');
    });
  });

  describe('forgot password, then POST /auth/password-resets', () => {
    const forgot = (email: string) => testApp.http().post(FORGOT).send({ email });
    const reset = (token: string, password: string) =>
      testApp.http().post(RESET).send({ token, password });
    const resetLink = async (email: string): Promise<string> => {
      await drain.whenIdle();
      const emails = sentTo(email).filter((call) => call.subject === 'Reset your Maqady password');
      return customerLinkToken(emails[emails.length - 1]!.text, '/reset-password');
    };

    it('answers 202 with no body for unknown, blocked and active emails, and sends only to the active one', async () => {
      const active = await registerCustomer(testApp);
      const blocked = await registerCustomer(testApp);
      await blockCustomer(testApp, blocked.customerId);
      await drain.whenIdle();
      sender.reset();

      for (const email of ['nobody-at-all@example.com', blocked.email, active.email]) {
        const response = await forgot(email);
        expect(response.status).toBe(202);
        expect(response.text).toBe('');
      }
      await drain.whenIdle();
      expect(sender.calls.map((call) => call.to)).toEqual([active.email]);
      expect((await tokenRows(blocked.customerId)).map((row) => row.purpose)).toEqual([
        'verify_email',
      ]);

      const [stored] = (await readMessages(testApp.knex)).filter(
        (message) =>
          message.template === 'customer.password_reset' &&
          message.related_customer_id === active.customerId,
      );
      expect(stored!.body_text).toContain(REDACTED_LINK);
      const token = await resetLink(active.email);
      for (const part of [stored!.subject, stored!.body_text, stored!.body_html]) {
        expect(part).not.toContain(token);
      }
      expect(sender.calls[0]!.html).toContain(`/reset-password?token=${token}`);
    });

    it('sets the password once, verifies the email and signs out everywhere', async () => {
      const customer = await registerCustomer(testApp);
      const second = await signIn(customer.email, DEFAULT_CUSTOMER_PASSWORD);
      expect((await forgot(customer.email.toUpperCase())).status).toBe(202);
      const token = await resetLink(customer.email);

      const response = await reset(token, 'NewCinema2026');
      expect(response.status).toBe(204);
      expect(response.text).toBe('');

      expectError(await me(customer.accessToken), 401, 'SESSION_REVOKED');
      expectError(await me(second.body.accessToken as string), 401, 'SESSION_REVOKED');
      expect((await sessionRows(customer.customerId)).map((row) => row.revoked_reason)).toEqual([
        'password_changed',
        'password_changed',
      ]);
      expectError(
        await signIn(customer.email, DEFAULT_CUSTOMER_PASSWORD),
        401,
        'INVALID_CREDENTIALS',
      );
      const signedIn = await signIn(customer.email, 'NewCinema2026');
      expect(signedIn.status).toBe(201);
      expect(signedIn.body.customer.emailVerified).toBe(true);

      expectError(await reset(token, 'OtherCinema2026'), 400, 'INVALID_TOKEN');
    });

    it('voids the first link when a second is requested, and every link after 1 hour', async () => {
      const customer = await registerCustomer(testApp);
      await forgot(customer.email);
      const first = await resetLink(customer.email);
      await forgot(customer.email);
      const second = await resetLink(customer.email);
      expect(second).not.toBe(first);

      expectError(await reset(first, 'NewCinema2026'), 400, 'INVALID_TOKEN');
      clock.advance({ hours: 1 });
      expectError(await reset(second, 'NewCinema2026'), 400, 'INVALID_TOKEN');
    });

    it('refuses a weak password before using the link, which still works after', async () => {
      const customer = await registerCustomer(testApp);
      await forgot(customer.email);
      const token = await resetLink(customer.email);

      expectError(await reset(token, 'weakpassword'), 400, 'VALIDATION_FAILED');
      expect((await reset(token, 'NewCinema2026')).status).toBe(204);
    });

    it('answers ACCOUNT_BLOCKED to a customer blocked after the request, leaving the link unused', async () => {
      const customer = await registerCustomer(testApp);
      await forgot(customer.email);
      const token = await resetLink(customer.email);
      await blockCustomer(testApp, customer.customerId);

      expectError(await reset(token, 'NewCinema2026'), 403, 'ACCOUNT_BLOCKED');
      const resets = (await tokenRows(customer.customerId)).filter(
        (row) => row.purpose === 'customer_password_reset',
      );
      expect(resets).toEqual([{ purpose: 'customer_password_reset', used_at: null }]);
      expectError(await signIn(customer.email, 'NewCinema2026'), 401, 'INVALID_CREDENTIALS');
    });
  });
});
