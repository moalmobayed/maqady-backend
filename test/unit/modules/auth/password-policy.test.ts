import { validate } from 'class-validator';
import { IsAllowedPassword, isAllowedPassword } from '../../../../src/modules/auth/password-policy';

class PasswordBody {
  @IsAllowedPassword()
  password!: unknown;
}

describe('password policy (design 10.1)', () => {
  it.each([
    ['abcdefg1', true],
    ['12345678', true],
    [`${'a'.repeat(127)}1`, true],
    ['abcdef1', false], // 7 characters
    ['abcdefgh', false], // no digit
    ['ABCDEFGH٣', false], // an Arabic-Indic digit is not 0-9
    [`${'a'.repeat(128)}1`, false], // 129 characters
    ['', false],
  ])('%j is allowed: %s', (value, allowed) => {
    expect(isAllowedPassword(value)).toBe(allowed);
  });

  it('refuses anything but a string', () => {
    for (const value of [12345678, null, undefined, ['abcdefg1'], { length: 9 }]) {
      expect(isAllowedPassword(value)).toBe(false);
    }
  });

  it('is a class-validator decorator with a message that states the rule', async () => {
    const body = Object.assign(new PasswordBody(), { password: 'short' });
    const [error] = await validate(body);
    expect(error?.constraints).toEqual({
      isAllowedPassword: 'password must be 8 to 128 characters and include a digit',
    });

    const valid = Object.assign(new PasswordBody(), { password: 'long-enough-1' });
    await expect(validate(valid)).resolves.toEqual([]);
  });
});
