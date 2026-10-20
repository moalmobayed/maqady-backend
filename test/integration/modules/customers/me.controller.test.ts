import type { Response } from 'supertest';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import {
  DEFAULT_CUSTOMER_PASSWORD,
  registerCustomer,
  signInCustomer,
} from '../../../support/customer-auth';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { createTestApp } from '../../../support/test-app';
import type { CustomerSessionFixture, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

const ME = '/api/v1/me';
const PASSWORD = '/api/v1/me/password';
const SIGN_IN = '/api/v1/auth/sessions';
const REFRESH = '/api/v1/auth/tokens';

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

describe('Profile routes (integration)', () => {
  let testApp: TestApp;
  let customer: CustomerSessionFixture;

  beforeAll(async () => {
    testApp = await createTestApp({
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
  });

  afterAll(async () => {
    await testApp.app.get(OutboxDrainService).whenIdle();
    await testApp.close();
  });

  beforeEach(async () => {
    customer = await registerCustomer(testApp, { fullName: 'Layla Hassan' });
  });

  const patch = (body: unknown, authorization = customer.authorization) =>
    testApp
      .http()
      .patch(ME)
      .set('Authorization', authorization)
      .send(body as object);
  const changePassword = (body: unknown, authorization = customer.authorization) =>
    testApp
      .http()
      .put(PASSWORD)
      .set('Authorization', authorization)
      .send(body as object);
  const storedPhone = async () =>
    (
      await testApp
        .knex('customers')
        .select<{ phone: string | null }[]>('phone')
        .where({ id: customer.customerId })
        .first()
    )?.phone;

  describe('GET /me', () => {
    it('answers the signed-in customer, and refuses a request without a token', async () => {
      const response = await testApp.http().get(ME).set('Authorization', customer.authorization);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: customer.customerId,
        fullName: 'Layla Hassan',
        email: customer.email,
        phone: null,
        emailVerified: false,
      });
      expectError(await testApp.http().get(ME), 401, 'UNAUTHENTICATED');
    });
  });

  describe('PATCH /me', () => {
    it('sets the name (trimmed) and the phone, storing a local Egyptian mobile as E.164', async () => {
      const response = await patch({ fullName: '  Layla H.  ', phone: '01012345678' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ fullName: 'Layla H.', phone: '+201012345678' });
      expect(await storedPhone()).toBe('+201012345678');

      const intl = await patch({ phone: '+447911123456' });
      expect(intl.body).toMatchObject({ fullName: 'Layla H.', phone: '+447911123456' });
    });

    it('clears the phone with null', async () => {
      await patch({ phone: '+201012345678' });
      const response = await patch({ phone: null });
      expect(response.status).toBe(200);
      expect(response.body.phone).toBeNull();
      expect(await storedPhone()).toBeNull();
    });

    it('refuses the email, a bad phone, an empty name and an empty body', async () => {
      for (const body of [
        { email: 'other@example.com' },
        { fullName: 'Layla', email: 'other@example.com' },
        { phone: '0101234567' },
        { phone: 201012345678 },
        { fullName: '  ' },
        {},
      ]) {
        expectError(await patch(body), 400, 'VALIDATION_FAILED');
      }
      const empty = await patch({});
      expect(empty.body.error.details.fields).toEqual([
        { field: 'fullName', messages: expect.arrayContaining(['send fullName, phone or both']) },
      ]);
      expect(await storedPhone()).toBeNull();
    });

    it('replays a retry with the same Idempotency-Key instead of running again', async () => {
      const key = '6a3f0c1e-4b2d-4e8f-9a7c-1d2e3f4a5b6c';
      const first = await patch({ fullName: 'Layla One' }).set('Idempotency-Key', key);
      expect(first.status).toBe(200);
      await patch({ fullName: 'Layla Two' });

      const replay = await patch({ fullName: 'Layla One' }).set('Idempotency-Key', key);
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      const current = await testApp.http().get(ME).set('Authorization', customer.authorization);
      expect(current.body.fullName).toBe('Layla Two');
    });
  });

  describe('PUT /me/password', () => {
    const signIn = (password: string) =>
      testApp.http().post(SIGN_IN).send({ email: customer.email, password });

    it('refuses a wrong current password on its field and keeps the old password', async () => {
      const response = await changePassword({
        currentPassword: 'Wrong-pass1',
        newPassword: 'NewCinema2026',
      });
      expectError(response, 400, 'VALIDATION_FAILED');
      expect(response.body.error.details).toEqual({
        fields: [{ field: 'currentPassword', messages: ['currentPassword is not correct'] }],
      });
      expect((await signIn(DEFAULT_CUSTOMER_PASSWORD)).status).toBe(201);
      expectError(await signIn('NewCinema2026'), 401, 'INVALID_CREDENTIALS');
    });

    it('refuses a new password that breaks the rules', async () => {
      const response = await changePassword({
        currentPassword: DEFAULT_CUSTOMER_PASSWORD,
        newPassword: 'no-digits-here',
      });
      expectError(response, 400, 'VALIDATION_FAILED');
      expect(response.body.error.details.fields[0].field).toBe('newPassword');
    });

    it('changes the password, keeps this device signed in and signs out the others', async () => {
      const otherDevice = await signInCustomer(testApp, customer.email, DEFAULT_CUSTOMER_PASSWORD);

      const response = await changePassword({
        currentPassword: DEFAULT_CUSTOMER_PASSWORD,
        newPassword: 'NewCinema2026',
      });
      expect(response.status).toBe(204);

      expect(
        (await testApp.http().get(ME).set('Authorization', customer.authorization)).status,
      ).toBe(200);
      expect(
        (await testApp.http().post(REFRESH).send({ refreshToken: customer.refreshToken })).status,
      ).toBe(201);
      expectError(
        await testApp.http().get(ME).set('Authorization', otherDevice.authorization),
        401,
        'SESSION_REVOKED',
      );
      expectError(
        await testApp.http().post(REFRESH).send({ refreshToken: otherDevice.refreshToken }),
        401,
        'SESSION_REVOKED',
      );

      expectError(await signIn(DEFAULT_CUSTOMER_PASSWORD), 401, 'INVALID_CREDENTIALS');
      expect((await signIn('NewCinema2026')).status).toBe(201);
    });
  });
});
