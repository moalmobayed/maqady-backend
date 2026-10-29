import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCustomerRequest } from '../../../../../src/modules/admin-customers/dto/update-customer.request';

async function check(body: Record<string, unknown>) {
  const instance = plainToInstance(UpdateCustomerRequest, body);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return {
    instance,
    fields: errors.map((error) => error.property),
    messages: errors.flatMap((error) => Object.values(error.constraints ?? {})),
  };
}

describe('UpdateCustomerRequest', () => {
  it('needs at least one field, and says which ones', async () => {
    expect(await check({})).toMatchObject({
      fields: ['fullName'],
      messages: ['send fullName, email, phone or status'],
    });
  });

  it('accepts each field alone, trimmed and normalised', async () => {
    const name = await check({ fullName: '  Layla Hassan ' });
    expect(name.fields).toEqual([]);
    expect(name.instance.fullName).toBe('Layla Hassan');
    const email = await check({ email: ' layla@example.com ' });
    expect(email.fields).toEqual([]);
    expect(email.instance.email).toBe('layla@example.com');
    const phone = await check({ phone: '01012345678' });
    expect(phone.fields).toEqual([]);
    expect(phone.instance.phone).toBe('+201012345678');
    expect((await check({ phone: null })).fields).toEqual([]);
    expect((await check({ status: 'blocked' })).fields).toEqual([]);
    expect((await check({ status: 'active' })).fields).toEqual([]);
  });

  it.each([
    [{ fullName: '   ' }, 'fullName'],
    [{ fullName: null }, 'fullName'],
    [{ fullName: 'x'.repeat(101) }, 'fullName'],
    [{ fullName: 'a\u0000b' }, 'fullName'],
    [{ email: 'not-an-email' }, 'email'],
    [{ email: '"a b"@example.com' }, 'email'],
    [{ email: null }, 'email'],
    [{ email: `${'a'.repeat(315)}@x.com` }, 'email'],
    [{ phone: '12345' }, 'phone'],
    [{ phone: 1012345678 }, 'phone'],
    [{ status: 'deleted' }, 'status'],
    [{ status: null }, 'status'],
  ])('refuses %j on %s', async (body, field) => {
    expect((await check(body)).fields).toEqual([field]);
  });

  it('refuses unknown fields', async () => {
    expect((await check({ status: 'active', role: 'admin' })).fields).toEqual(['role']);
  });
});
