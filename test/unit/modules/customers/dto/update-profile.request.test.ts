import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileRequest } from '../../../../../src/modules/customers/dto/update-profile.request';

async function check(body: Record<string, unknown>) {
  const instance = plainToInstance(UpdateProfileRequest, body);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, fields: errors.map((error) => error.property) };
}

describe('UpdateProfileRequest', () => {
  it.each(['+201012345678', '+447911123456', ' +201012345678 '])(
    'accepts the international number %j',
    async (phone) => {
      const { instance, fields } = await check({ phone });
      expect(fields).toEqual([]);
      expect(instance.phone).toBe(phone.trim());
    },
  );

  it.each([
    ['01012345678', '+201012345678'],
    ['01112345678', '+201112345678'],
    ['01212345678', '+201212345678'],
    ['01512345678', '+201512345678'],
  ])('accepts the Egyptian mobile %s and stores it as %s', async (phone, stored) => {
    const { instance, fields } = await check({ phone });
    expect(fields).toEqual([]);
    expect(instance.phone).toBe(stored);
  });

  it.each(['0101234567', '01312345678', '+0101234567', '+2010123456789012', '1012345678', '', 12])(
    'refuses the phone %j',
    async (phone) => {
      expect((await check({ phone })).fields).toEqual(['phone']);
    },
  );

  it('accepts null to clear the phone', async () => {
    const { instance, fields } = await check({ phone: null });
    expect(fields).toEqual([]);
    expect(instance.phone).toBeNull();
  });

  it('trims the name and refuses an empty or over-long one', async () => {
    const trimmed = await check({ fullName: '  Layla Hassan  ' });
    expect(trimmed.fields).toEqual([]);
    expect(trimmed.instance.fullName).toBe('Layla Hassan');
    expect((await check({ fullName: '   ' })).fields).toEqual(['fullName']);
    expect((await check({ fullName: 'x'.repeat(101) })).fields).toEqual(['fullName']);
  });

  it('refuses an empty body, naming a field', async () => {
    expect((await check({})).fields).toEqual(['fullName']);
  });

  it('refuses the email and any other field', async () => {
    expect((await check({ fullName: 'Layla', email: 'x@example.com' })).fields).toEqual(['email']);
  });
});
