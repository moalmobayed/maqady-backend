import type { Knex } from 'knex';
import { MIGRATIONS_DIRECTORY } from '../../../../src/common/database/database.constants';
import { createKnex } from '../../../../src/common/database/knex.factory';
import { DirectoryMigrationSource } from '../../../../src/common/database/migration-source';
import { MigrationRepository } from '../../../../src/common/database/migration.repository';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig, TEST_SCHEMA, testDatabaseUrl } from '../../../support/test-config';
import type { TestApp } from '../../../support/types';

const EXTENSIONS = ['btree_gist', 'citext', 'pg_trgm'];

async function extensionSchemas(knex: Knex): Promise<Record<string, string>> {
  const { rows } = await knex.raw<{ rows: { extname: string; nspname: string }[] }>(
    `SELECT e.extname, n.nspname
       FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = ANY(?) ORDER BY e.extname`,
    [EXTENSIONS],
  );
  return Object.fromEntries(rows.map(({ extname, nspname }) => [extname, nspname]));
}

describe('Migrations (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    // The global setup already migrated this database from zero.
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('created the schema, with its comment', async () => {
    const { rows } = await testApp.knex.raw<{ rows: { comment: string | null }[] }>(
      "SELECT obj_description(oid, 'pg_namespace') AS comment FROM pg_namespace WHERE nspname = ?",
      [TEST_SCHEMA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.comment).toContain('Never exposed through the Supabase Data API');
  });

  it('created citext, pg_trgm and btree_gist in public on plain Postgres', async () => {
    expect(await extensionSchemas(testApp.knex)).toEqual({
      btree_gist: 'public',
      citext: 'public',
      pg_trgm: 'public',
    });
  });

  it("keeps Knex's bookkeeping in the schema, with migrations recorded without extensions", async () => {
    const rows = await testApp.knex
      .withSchema(TEST_SCHEMA)
      .from('knex_migrations')
      .select('name', 'batch')
      .orderBy('id');
    expect(rows[0]).toEqual({ name: '0010_01_create_schema', batch: 1 });
    expect(
      rows.every(({ name }: { name: string }) => !name.endsWith('.ts') && !name.endsWith('.js')),
    ).toBe(true);
  });

  it("enables row-level security on Knex's tables, as on every table in the schema", async () => {
    const { rows } = await testApp.knex.raw<{
      rows: { relname: string; relrowsecurity: boolean }[];
    }>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ? AND c.relkind = 'r' ORDER BY c.relname`,
      [TEST_SCHEMA],
    );
    expect(rows).toEqual([
      { relname: 'knex_migrations', relrowsecurity: true },
      { relname: 'knex_migrations_lock', relrowsecurity: true },
    ]);
  });

  it('does nothing when run again', async () => {
    const before = await testApp.knex
      .withSchema(TEST_SCHEMA)
      .from('knex_migrations')
      .count({ n: '*' });
    const result = await testApp.app.get(MigrationRepository).migrateLatest();
    const after = await testApp.knex
      .withSchema(TEST_SCHEMA)
      .from('knex_migrations')
      .count({ n: '*' });
    expect(result.applied).toEqual([]);
    expect(after).toEqual(before);
  });

  it('refuses to roll back the base migration, leaving the database as it was', async () => {
    const rollback = testApp.knex.migrate.rollback({
      migrationSource: new DirectoryMigrationSource(MIGRATIONS_DIRECTORY, { schema: TEST_SCHEMA }),
      schemaName: TEST_SCHEMA,
      tableName: 'knex_migrations',
    });
    await expect(rollback).rejects.toThrow('0010_01_create_schema cannot be rolled back');
    expect(await extensionSchemas(testApp.knex)).toHaveProperty('citext', 'public');
    const names = await testApp.knex.withSchema(TEST_SCHEMA).from('knex_migrations').pluck('name');
    expect(names).toContain('0010_01_create_schema');
  });

  describe('when several processes boot at once against an empty database', () => {
    const RACE_DATABASE = 'maqady_race_test';
    const INSTANCES = 4;
    const racers: Knex[] = [];

    afterAll(async () => {
      await Promise.all(racers.map((knex) => knex.destroy()));
      await testApp.knex.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [RACE_DATABASE]);
    });

    it('migrates once, and every process starts', async () => {
      await testApp.knex.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [RACE_DATABASE]);
      await testApp.knex.raw('CREATE DATABASE ??', [RACE_DATABASE]);
      const url = new URL(testDatabaseUrl());
      url.pathname = `/${RACE_DATABASE}`;
      const config = buildTestConfig({ database: { url: url.toString(), schema: TEST_SCHEMA } });

      // One Knex per process, as in a deploy that starts several instances side by side.
      for (let i = 0; i < INSTANCES; i += 1) racers.push(createKnex(config.database));
      const results = await Promise.allSettled(
        racers.map((knex) => new MigrationRepository(knex, config).migrateLatest()),
      );

      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [String((result.reason as Error).message)] : [],
      );
      expect(failures).toEqual([]);
      const applied = results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value.applied : [],
      );
      expect(applied).toEqual(['0010_01_create_schema']);
    });
  });

  describe('on a Supabase-style database, where an extensions schema exists', () => {
    const SCRATCH_DATABASE = 'maqady_scratch_test';
    let scratch: Knex | undefined;

    afterAll(async () => {
      await scratch?.destroy();
      await testApp.knex.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [SCRATCH_DATABASE]);
    });

    it('installs the extensions in extensions, where the search_path finds them', async () => {
      await testApp.knex.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [SCRATCH_DATABASE]);
      await testApp.knex.raw('CREATE DATABASE ??', [SCRATCH_DATABASE]);
      const url = new URL(testDatabaseUrl());
      url.pathname = `/${SCRATCH_DATABASE}`;
      const config = buildTestConfig({ database: { url: url.toString(), schema: TEST_SCHEMA } });
      scratch = createKnex(config.database);

      await scratch.raw('CREATE SCHEMA extensions');
      const { applied } = await new MigrationRepository(scratch, config).migrateLatest();

      expect(applied).toEqual(['0010_01_create_schema']);
      expect(await extensionSchemas(scratch)).toEqual({
        btree_gist: 'extensions',
        citext: 'extensions',
        pg_trgm: 'extensions',
      });
      const { rows } = await scratch.raw<{ rows: { equal: boolean }[] }>(
        "SELECT 'Mona@Example.com'::citext = 'mona@example.com'::citext AS equal",
      );
      expect(rows[0]?.equal).toBe(true);
    });
  });
});
