import { parseBootstrapAdminEnv } from '../../../../src/modules/staff/admin-create.command';

const VALID = {
  BOOTSTRAP_ADMIN_EMAIL: ' owner@maqady.example ',
  BOOTSTRAP_ADMIN_NAME: ' Mohamed Tarek ',
  BOOTSTRAP_ADMIN_PASSWORD: 'Secret-pass-42',
};

describe('parseBootstrapAdminEnv', () => {
  it('reads the three variables, trimming the email and the name but never the password', () => {
    expect(
      parseBootstrapAdminEnv({ ...VALID, BOOTSTRAP_ADMIN_PASSWORD: ' Secret-pass-42 ' }),
    ).toEqual({
      ok: true,
      input: {
        email: 'owner@maqady.example',
        fullName: 'Mohamed Tarek',
        password: ' Secret-pass-42 ',
      },
    });
  });

  it('names every broken variable and its rule, and never echoes a value', () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: 'not-an-email',
      BOOTSTRAP_ADMIN_NAME: '   ',
      BOOTSTRAP_ADMIN_PASSWORD: 'nodigits',
    };
    const parsed = parseBootstrapAdminEnv(env);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems).toEqual([
      'BOOTSTRAP_ADMIN_EMAIL must be an email address of at most 320 characters',
      'BOOTSTRAP_ADMIN_NAME must be 1 to 100 characters',
      'BOOTSTRAP_ADMIN_PASSWORD: password must be 8 to 128 characters and include a digit',
    ]);
    const text = parsed.problems.join('\n');
    expect(text).not.toContain('not-an-email');
    expect(text).not.toContain('nodigits');
  });

  it('refuses missing variables', () => {
    const parsed = parseBootstrapAdminEnv({});
    expect(parsed).toEqual({ ok: false, problems: expect.arrayContaining([expect.any(String)]) });
    expect(parsed.ok || parsed.problems).toHaveLength(3);
  });

  it('refuses a name over 100 characters and an email over 320', () => {
    const parsed = parseBootstrapAdminEnv({
      ...VALID,
      BOOTSTRAP_ADMIN_NAME: 'n'.repeat(101),
      BOOTSTRAP_ADMIN_EMAIL: `${'a'.repeat(316)}@x.eg`,
    });
    expect(parsed.ok || parsed.problems.map((problem) => problem.split(' ')[0])).toEqual([
      'BOOTSTRAP_ADMIN_EMAIL',
      'BOOTSTRAP_ADMIN_NAME',
    ]);
  });
});
