import { customerPasswordResetTemplate } from '../../../../../src/modules/customers/templates/customer-password-reset.template';
import { customerVerifyEmailTemplate } from '../../../../../src/modules/customers/templates/customer-verify-email.template';
import { deliveryLinks, storageLinks } from '../../../../../src/modules/messaging/links';
import { REDACTED_LINK } from '../../../../../src/modules/messaging/messaging.constants';

const BASE = 'https://maqady.example';
const TOKEN = 'Vq3b8kP0xYz1nR5tL9wE2cU7mA4sD6fG8hJ0kL2qW3e';

describe.each([
  [customerVerifyEmailTemplate, 'customer.verify_email', '/verify-email', 'Confirm email'],
  [
    customerPasswordResetTemplate,
    'customer.password_reset',
    '/reset-password',
    'Set a new password',
  ],
] as const)('%s', (template, name, path, action) => {
  const params = { fullName: 'Layla <Hassan>', token: TOKEN };

  it('is an email named after its trigger, with the token as its only secret', () => {
    expect(template.name).toBe(name);
    expect(template.channel).toBe('email');
    expect(template.secretParams).toEqual(['token']);
  });

  it('stores only a redacted link: no token anywhere', () => {
    const stored = template.render(params, storageLinks(BASE));
    for (const part of [stored.subject, stored.text, stored.html]) {
      expect(part).toBeDefined();
      expect(part).not.toContain(TOKEN);
      expect(part).not.toContain('token=');
    }
    expect(stored.text).toContain(REDACTED_LINK);
    expect(stored.html).toContain(REDACTED_LINK);
  });

  it('sends the real link to the frontend page, and escapes the name in HTML', () => {
    const sent = template.render(params, deliveryLinks(BASE));
    const link = `${BASE}${path}?token=${TOKEN}`;
    expect(sent.text).toContain(link);
    expect(sent.text).toContain('Hello Layla <Hassan>,');
    expect(sent.html).toContain(`href="${link}"`);
    expect(sent.html).toContain(action);
    expect(sent.html).toContain('Layla &lt;Hassan&gt;');
    expect(sent.html).not.toContain('<Hassan>');
  });
});
