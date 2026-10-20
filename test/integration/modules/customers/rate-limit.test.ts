import type { Response } from 'supertest';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { registerCustomer } from '../../../support/customer-auth';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { buildTestConfig } from '../../../support/test-config';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

jest.setTimeout(120_000);

/** Design 10.6 with the production limits on the customer auth routes. */
describe('Customer auth rate limits (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      config: buildTestConfig(
        {},
        {
          RATE_LIMIT_REGISTRATION_IP: '5/1h',
          RATE_LIMIT_SIGN_IN_EMAIL: '5/1m',
          RATE_LIMIT_EMAIL_REQUEST_EMAIL: '3/1h',
          RATE_LIMIT_VERIFICATION_RESEND_CUSTOMER: '3/1h',
        },
      ),
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
  });

  afterAll(async () => {
    await testApp.app.get(OutboxDrainService).whenIdle();
    await testApp.close();
  });

  const expectLimited = (response: Response) => {
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  };

  it('answers the 6th registration from one address with RATE_LIMITED; another address gets through', async () => {
    const register = (address: string, n: number) =>
      testApp
        .http()
        .post('/api/v1/auth/registrations')
        .set('X-Forwarded-For', address)
        .send({
          fullName: 'Rate Test',
          email: `rate-${address}-${n}@example.com`,
          password: 'Cinema2026',
        });
    for (let n = 1; n <= 5; n += 1) {
      expect((await register('203.0.113.20', n)).status).toBe(201);
    }
    expectLimited(await register('203.0.113.20', 6));
    expect((await register('203.0.113.21', 6)).status).toBe(201);
  });

  it('answers the 6th sign-in for one email from one address with RATE_LIMITED', async () => {
    const signIn = (email: string) =>
      testApp
        .http()
        .post('/api/v1/auth/sessions')
        .set('X-Forwarded-For', '203.0.113.30')
        .send({ email, password: 'Wrong-pass1' });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await signIn('target@example.com')).status).toBe(401);
    }
    expectLimited(await signIn('Target@example.com'));
    expect((await signIn('other@example.com')).status).toBe(401);
  });

  it('answers the 4th resend for one customer with RATE_LIMITED while another customer still gets 202', async () => {
    const first = await registerCustomer(testApp);
    const second = await registerCustomer(testApp);
    const resend = (authorization: string) =>
      testApp
        .http()
        .post('/api/v1/auth/email-verification-requests')
        .set('X-Forwarded-For', '203.0.113.40')
        .set('Authorization', authorization);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await resend(first.authorization)).status).toBe(202);
    }
    expectLimited(await resend(first.authorization));
    expect((await resend(second.authorization)).status).toBe(202);
  });

  it('answers the 4th forgot-password request for one email with RATE_LIMITED', async () => {
    const forgot = (email: string, address: string) =>
      testApp
        .http()
        .post('/api/v1/auth/password-reset-requests')
        .set('X-Forwarded-For', address)
        .send({ email });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await forgot('forgot@example.com', `198.51.100.${attempt}`)).status).toBe(202);
    }
    expectLimited(await forgot('FORGOT@example.com', '198.51.100.9'));
    expect((await forgot('someone-else@example.com', '198.51.100.9')).status).toBe(202);
  });
});
