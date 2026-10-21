import { deliveryLinks, storageLinks } from '../../../../../src/modules/messaging/links';
import { REDACTED_LINK } from '../../../../../src/modules/messaging/messaging.constants';
import { staffInviteTemplate } from '../../../../../src/modules/staff/templates/staff-invite.template';

const BASE = 'https://maqady.example';
const TOKEN = 'q3VbI2vT0xSx5n2b7i1d9mJ8kQe4zW6yR0tP5uL3aGc';
const LINK = `${BASE}/admin/set-password?token=${TOKEN}`;

describe('staff.invite template', () => {
  const params = { fullName: 'Mona Adel', role: 'box_office' as const, token: TOKEN };

  it('is an email named staff.invite whose token is secret', () => {
    expect(staffInviteTemplate).toMatchObject({
      name: 'staff.invite',
      channel: 'email',
      secretParams: ['token'],
    });
  });

  it('puts the real set-password link in the copy that is sent', () => {
    const sent = staffInviteTemplate.render(params, deliveryLinks(BASE));
    expect(sent.subject).toBe("You're invited to the Maqady dashboard");
    expect(sent.text).toContain(LINK);
    expect(sent.text).toContain('Hello Mona Adel,');
    expect(sent.text).toContain('as Box office.');
    expect(sent.text).toContain('within 72 hours');
    expect(sent.html).toContain(`href="${LINK}"`);
    expect(sent.html).toContain('Set your password');
  });

  it('hides the link, and the token, in the stored copy', () => {
    const stored = staffInviteTemplate.render(params, storageLinks(BASE));
    const all = [stored.subject, stored.text, stored.html].join('\n');
    expect(all).toContain(REDACTED_LINK);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('token=');
    expect(stored.html).not.toContain('href=');
  });

  it('names the admin role, and escapes the name in the HTML', () => {
    const sent = staffInviteTemplate.render(
      { fullName: '<b>Omar</b> & co', role: 'admin', token: TOKEN },
      deliveryLinks(BASE),
    );
    expect(sent.text).toContain('as Admin.');
    expect(sent.html).toContain('&lt;b&gt;Omar&lt;/b&gt; &amp; co');
    expect(sent.html).not.toContain('<b>Omar</b>');
  });
});
