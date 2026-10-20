import { runAdminCreate } from '../../../../src/modules/staff/admin-create.command';
import { createLogCapture } from '../../../support/log-capture';
import { buildTestConfig } from '../../../support/test-config';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

const ENV = {
  BOOTSTRAP_ADMIN_EMAIL: 'owner@maqady.example',
  BOOTSTRAP_ADMIN_NAME: 'Mohamed Tarek',
  BOOTSTRAP_ADMIN_PASSWORD: 'Bootstrap-secret-42',
};

describe('npm run admin:create (integration)', () => {
  let testApp: TestApp;
  const capture = createLogCapture();

  beforeAll(async () => {
    testApp = await createTestApp({
      config: buildTestConfig({ logLevel: 'info' }),
      logDestination: capture.stream,
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(async () => {
    await testApp.knex.raw(
      'TRUNCATE TABLE one_time_tokens, sessions, audit_events, staff_users RESTART IDENTITY CASCADE',
    );
  });

  const admins = () =>
    testApp
      .knex('staff_users')
      .select<{ id: number; email: string; full_name: string; role: string; status: string }[]>(
        'id',
        'email',
        'full_name',
        'role',
        'status',
      );

  it('creates one active admin that can sign in, and a second run changes nothing', async () => {
    const lines: string[] = [];
    await expect(runAdminCreate(testApp.app, ENV, (line) => lines.push(line))).resolves.toEqual({
      created: true,
      id: 1,
    });
    await expect(runAdminCreate(testApp.app, ENV, (line) => lines.push(line))).resolves.toEqual({
      created: false,
    });

    expect(await admins()).toEqual([
      {
        id: 1,
        email: 'owner@maqady.example',
        full_name: 'Mohamed Tarek',
        role: 'admin',
        status: 'active',
      },
    ]);
    expect(lines).toEqual([
      expect.stringMatching(/^Created admin #1\./),
      'An active admin already exists. Nothing changed.',
    ]);
    const signIn = await testApp
      .http()
      .post('/api/v1/admin/auth/sessions')
      .send({ email: ENV.BOOTSTRAP_ADMIN_EMAIL, password: ENV.BOOTSTRAP_ADMIN_PASSWORD });
    expect(signIn.status).toBe(201);
    expect(signIn.body.staff.role).toBe('admin');

    const [audit] = await testApp
      .knex('audit_events')
      .select('actor_kind', 'entity_id', 'metadata')
      .where({ action: 'staff_user.created' });
    expect(audit).toEqual({
      actor_kind: 'system',
      entity_id: 1,
      metadata: { role: 'admin', status: 'active' },
    });
  });

  it('creates exactly one admin when two runs race', async () => {
    const results = await Promise.all([
      runAdminCreate(testApp.app, ENV, () => undefined),
      runAdminCreate(
        testApp.app,
        { ...ENV, BOOTSTRAP_ADMIN_EMAIL: 'second@maqady.example' },
        () => undefined,
      ),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await admins()).toHaveLength(1);
  });

  it('never writes the email or the password to its output or the logs', async () => {
    const lines: string[] = [];
    await runAdminCreate(testApp.app, ENV, (line) => lines.push(line));
    await runAdminCreate(testApp.app, ENV, (line) => lines.push(line));
    const everything = `${lines.join('\n')}\n${capture.text()}`;
    expect(everything).not.toContain(ENV.BOOTSTRAP_ADMIN_PASSWORD);
    expect(everything).not.toContain(ENV.BOOTSTRAP_ADMIN_EMAIL);
    expect(everything).not.toContain(ENV.BOOTSTRAP_ADMIN_NAME);
  });

  it('refuses bad variables before touching the database, naming the variable and not the value', async () => {
    const run = runAdminCreate(
      testApp.app,
      { ...ENV, BOOTSTRAP_ADMIN_PASSWORD: 'short' },
      () => undefined,
    );
    await expect(run).rejects.toThrow(/BOOTSTRAP_ADMIN_PASSWORD: password must be 8 to 128/);
    await expect(run).rejects.not.toThrow(/short/);
    expect(await admins()).toEqual([]);
  });

  it('refuses an email that already belongs to a box-office member, creating nothing', async () => {
    const now = new Date();
    await testApp.knex('staff_users').insert({
      email: ENV.BOOTSTRAP_ADMIN_EMAIL,
      full_name: 'Counter',
      role: 'box_office',
      status: 'invited',
      password_hash: null,
      created_at: now,
      updated_at: now,
    });
    await expect(runAdminCreate(testApp.app, ENV, () => undefined)).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
    expect((await admins()).map((row) => row.role)).toEqual(['box_office']);
  });
});
