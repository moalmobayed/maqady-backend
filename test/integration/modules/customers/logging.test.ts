import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { customerLinkToken } from '../../../support/customer-auth';
import { createLogCapture } from '../../../support/log-capture';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { buildTestConfig } from '../../../support/test-config';
import { createTestApp } from '../../../support/test-app';
import type { LogCapture, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

const EMAIL = 'private.person@example.com';
const NAME = 'Private Person Name';
const PHONE = '+201098765432';
const PASSWORD = 'Secret-Passw0rd';
const NEW_PASSWORD = 'Other-Secret-Passw0rd9';

/** Design 14.4: no email, name, phone, password or token in any log line. */
describe('Customer auth logging (integration)', () => {
  let capture: LogCapture;
  let testApp: TestApp;
  const sender = new RecordingEmailSender();

  beforeAll(async () => {
    capture = createLogCapture();
    testApp = await createTestApp({
      config: buildTestConfig({ logLevel: 'debug' }),
      logDestination: capture.stream,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('logs requests without personal data or credentials', async () => {
    const drain = testApp.app.get(OutboxDrainService);
    const registered = await testApp
      .http()
      .post('/api/v1/auth/registrations')
      .send({ fullName: NAME, email: EMAIL, password: PASSWORD });
    expect(registered.status).toBe(201);
    const { accessToken, refreshToken } = registered.body as Record<string, string>;
    await drain.whenIdle();
    const verifyToken = customerLinkToken(sender.calls[0]!.text, '/verify-email');

    const signedIn = await testApp
      .http()
      .post('/api/v1/auth/sessions')
      .send({ email: EMAIL, password: PASSWORD });
    expect(signedIn.status).toBe(201);
    expect(
      (
        await testApp
          .http()
          .patch('/api/v1/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ phone: PHONE })
      ).status,
    ).toBe(200);
    expect(
      (await testApp.http().post('/api/v1/auth/email-verifications').send({ token: verifyToken }))
        .status,
    ).toBe(204);
    expect(
      (await testApp.http().post('/api/v1/auth/password-reset-requests').send({ email: EMAIL }))
        .status,
    ).toBe(202);
    await drain.whenIdle();
    const resetToken = customerLinkToken(sender.calls[1]!.text, '/reset-password');
    expect(
      (
        await testApp
          .http()
          .post('/api/v1/auth/password-resets')
          .send({ token: resetToken, password: NEW_PASSWORD })
      ).status,
    ).toBe(204);
    // A failing sign-in too: errors must not echo what was sent.
    expect(
      (
        await testApp
          .http()
          .post('/api/v1/auth/sessions')
          .send({ email: EMAIL, password: PASSWORD })
      ).status,
    ).toBe(401);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const text = capture.text();
    expect(capture.entries().some((entry) => entry.msg === 'request completed')).toBe(true);
    for (const secret of [
      EMAIL,
      NAME,
      PHONE,
      PASSWORD,
      NEW_PASSWORD,
      accessToken,
      refreshToken,
      verifyToken,
      resetToken,
    ]) {
      expect(text).not.toContain(secret!);
    }
    expect(text.toLowerCase()).not.toContain(EMAIL.toLowerCase());
  });
});
