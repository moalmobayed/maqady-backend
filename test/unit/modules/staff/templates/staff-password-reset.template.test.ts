import { deliveryLinks, storageLinks } from '../../../../../src/modules/messaging/links';
import { REDACTED_LINK } from '../../../../../src/modules/messaging/messaging.constants';
import { staffPasswordResetTemplate } from '../../../../../src/modules/staff/templates/staff-password-reset.template';

const BASE = 'https://maqady.example/app';
const TOKEN = 'Zx9_-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL';
const LINK = `${BASE}/admin/set-password?token=${TOKEN}`;

describe('staff.password_reset template', () => {
  const params = { fullName: 'Karim Nabil', token: TOKEN };

  it('is an email named staff.password_reset whose token is secret', () => {
    expect(staffPasswordResetTemplate).toMatchObject({
      name: 'staff.password_reset',
      channel: 'email',
      secretParams: ['token'],
    });
  });

  it('puts the real link to the set-password page in the copy that is sent', () => {
    const sent = staffPasswordResetTemplate.render(params, deliveryLinks(BASE));
    expect(sent.subject).toBe('Reset your Maqady dashboard password');
    expect(sent.text).toContain(LINK);
    expect(sent.text).toContain('Hello Karim Nabil,');
    expect(sent.text).toContain('within 1 hour.');
    expect(sent.html).toContain(`href="${LINK}"`);
    expect(sent.html).toContain('Set a new password');
  });

  it('hides the link, and the token, in the stored copy', () => {
    const stored = staffPasswordResetTemplate.render(params, storageLinks(BASE));
    const all = [stored.subject, stored.text, stored.html].join('\n');
    expect(all).toContain(REDACTED_LINK);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('token=');
  });
});
