import type { Knex } from 'knex';
import * as databaseConstants from '../../../../src/common/database/database.constants';
import {
  MIGRATION_ADVISORY_LOCK,
  MIGRATIONS_DIRECTORY,
} from '../../../../src/common/database/database.constants';
import { createKnex } from '../../../../src/common/database/knex.factory';
import { DirectoryMigrationSource } from '../../../../src/common/database/migration-source';
import { MigrationRepository } from '../../../../src/common/database/migration.repository';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig, TEST_SCHEMA, testDatabaseUrl } from '../../../support/test-config';
import type { TestApp } from '../../../support/types';

const EXTENSIONS = ['btree_gist', 'citext', 'pg_trgm'];

/** Every migration in `src/migrations`, in the order a run from zero applies them. */
function allMigrations(): Promise<string[]> {
  return new DirectoryMigrationSource(MIGRATIONS_DIRECTORY, {
    schema: TEST_SCHEMA,
  }).getMigrations();
}

/**
 * A scratch database named after the test database (`maqady_test` → `maqady_race_test`), so
 * suites pointed at different test databases never drop each other's scratch copies.
 */
function scratchDatabaseName(purpose: string): string {
  const testDatabase = decodeURIComponent(new URL(testDatabaseUrl()).pathname.slice(1));
  return `${testDatabase.replace(/_test$/, '')}_${purpose}_test`;
}

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

  it("enables row-level security on every table in the schema, Knex's included", async () => {
    const { rows } = await testApp.knex.raw<{
      rows: { relname: string; relrowsecurity: boolean }[];
    }>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ? AND c.relkind = 'r' ORDER BY c.relname`,
      [TEST_SCHEMA],
    );
    expect(rows.map(({ relname }) => relname)).toEqual(
      expect.arrayContaining(['knex_migrations', 'knex_migrations_lock']),
    );
    expect(rows.filter(({ relrowsecurity }) => !relrowsecurity)).toEqual([]);
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

  describe('rolling back', () => {
    // Knex rolls back the whole last batch, one migration per transaction, so this runs on a
    // scratch database: on the suite's own database it would drop every later unit's tables.
    const ROLLBACK_DATABASE = scratchDatabaseName('rollback');
    let scratch: Knex | undefined;

    afterAll(async () => {
      await scratch?.destroy();
      await testApp.knex.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [ROLLBACK_DATABASE]);
    });

    it('refuses to roll back the base migration, which stays applied', async () => {
      await testApp.knex.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [ROLLBACK_DATABASE]);
      await testApp.knex.raw('CREATE DATABASE ??', [ROLLBACK_DATABASE]);
      const url = new URL(testDatabaseUrl());
      url.pathname = `/${ROLLBACK_DATABASE}`;
      const config = buildTestConfig({ database: { url: url.toString(), schema: TEST_SCHEMA } });
      scratch = createKnex(config.database);
      await new MigrationRepository(scratch, config).migrateLatest();

      const rollback = scratch.migrate.rollback({
        migrationSource: new DirectoryMigrationSource(MIGRATIONS_DIRECTORY, {
          schema: TEST_SCHEMA,
        }),
        schemaName: TEST_SCHEMA,
        tableName: 'knex_migrations',
      });
      await expect(rollback).rejects.toThrow('0010_01_create_schema cannot be rolled back');
      expect(await extensionSchemas(scratch)).toHaveProperty('citext', 'public');
      const names = await scratch.withSchema(TEST_SCHEMA).from('knex_migrations').pluck('name');
      expect(names).toContain('0010_01_create_schema');
    });
  });

  describe('when a dead process still holds the migration lock', () => {
    let holder: Knex;

    afterAll(async () => {
      await holder.destroy();
    });

    it('gives up waiting with a lock timeout instead of hanging', async () => {
      // A process that died mid-run, while a pooler kept its server session open, still holds
      // the lock in an open transaction. Hold it the same way from another connection, then boot.
      holder = createKnex(testApp.config.database);
      const deadRun = await holder.transaction();
      // The repository reads the limit when it migrates, so a short one keeps this test fast.
      const constants: { MIGRATION_LOCK_TIMEOUT: string } = databaseConstants;
      jest.replaceProperty(constants, 'MIGRATION_LOCK_TIMEOUT', '300ms');
      try {
        await deadRun.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [MIGRATION_ADVISORY_LOCK]);
        const started = Date.now();
        await expect(
          new MigrationRepository(testApp.knex, testApp.config).migrateLatest(),
        ).rejects.toThrow('canceling statement due to lock timeout');
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        jest.restoreAllMocks();
        await deadRun.rollback();
      }
    }, 20_000);
  });

  describe('when several processes boot at once against an empty database', () => {
    const RACE_DATABASE = scratchDatabaseName('race');
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
      expect(applied).toEqual(await allMigrations());
    });
  });

  describe('on a Supabase-style database, where an extensions schema exists', () => {
    const SCRATCH_DATABASE = scratchDatabaseName('scratch');
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

      expect(applied).toEqual(await allMigrations());
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
