import { AppError } from '../../../../src/common/errors/app-error';
import { MessageTemplateRegistry } from '../../../../src/modules/messaging/message-template.registry';
import type { MessageTemplate } from '../../../../src/modules/messaging/types';
import type { OneTimeLinkParams } from '../../../support/types';

function template(
  name: string,
  channel: 'email' | 'sms' = 'email',
): MessageTemplate<OneTimeLinkParams> {
  return {
    name,
    channel,
    secretParams: ['token'],
    render: ({ name: who }) => ({ subject: 'Hi', text: `Hi ${who}`, html: '<p>Hi</p>' }),
  };
}

describe('MessageTemplateRegistry', () => {
  it('finds a registered template by name, and knows the exact object', () => {
    const registry = new MessageTemplateRegistry();
    const invite = template('staff.invite');
    registry.register(invite);
    expect(registry.get('staff.invite')).toBe(invite);
    expect(registry.isRegistered(invite)).toBe(true);
    expect(registry.isRegistered(template('staff.invite'))).toBe(false);
    expect(registry.get('staff.reset')).toBeUndefined();
    expect(registry.names()).toEqual(['staff.invite']);
  });

  it('refuses a second template with the same name', () => {
    const registry = new MessageTemplateRegistry();
    registry.register(template('customer.verify_email'));
    expect(() => registry.register(template('customer.verify_email'))).toThrow(AppError);
  });

  it.each([
    'invite',
    'Staff.invite',
    'staff.',
    'staff..invite',
    'staff.invite-email',
    `a.${'b'.repeat(64)}`,
  ])('refuses the malformed name %p', (name) => {
    expect(() => new MessageTemplateRegistry().register(template(name))).toThrow(AppError);
  });

  it('refuses an unknown channel', () => {
    const bad = {
      ...template('staff.invite'),
      channel: 'fax',
    } as unknown as MessageTemplate<OneTimeLinkParams>;
    expect(() => new MessageTemplateRegistry().register(bad)).toThrow(AppError);
  });
});
