import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { MIGRATIONS_DIRECTORY } from '../../../../src/common/database/database.constants';
import { DirectoryMigrationSource } from '../../../../src/common/database/migration-source';

const MIGRATION_JS = `
exports.up = async (knex, context) => { knex.calls.push(['up', context.schema]); };
exports.down = async (knex, context) => { knex.calls.push(['down', context.schema]); };
`;

describe('DirectoryMigrationSource', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'maqady-migrations-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function write(file: string, content = MIGRATION_JS): void {
    writeFileSync(join(directory, file), content);
  }

  it('lists files with its extension, sorted, named without the extension', async () => {
    write('0020_01_create_staff.js');
    write('0010_02_create_audit.js');
    write('0010_01_create_schema.js');
    write('0010_01_create_schema.js.map', '{}');
    write('0010_03_types.d.js', '');
    write('README.md', '# notes');
    mkdirSync(join(directory, 'nested'));

    const source = new DirectoryMigrationSource(directory, { schema: 'maqady' }, '.js');
    const names = await source.getMigrations();
    expect(names).toEqual([
      '0010_01_create_schema',
      '0010_02_create_audit',
      '0020_01_create_staff',
    ]);
    expect(names.map((name) => source.getMigrationName(name))).toEqual(names);
  });

  it('hands Knex migrations bound to their context', async () => {
    write('0010_01_create_schema.js');
    const source = new DirectoryMigrationSource(directory, { schema: 'tenant_x' }, '.js');
    const migration = await source.getMigration('0010_01_create_schema');

    const knex = { calls: [] as unknown[] };
    await migration.up(knex as unknown as Knex);
    await migration.down(knex as unknown as Knex);
    expect(knex.calls).toEqual([
      ['up', 'tenant_x'],
      ['down', 'tenant_x'],
    ]);
    expect(migration).not.toHaveProperty('config');
  });

  it("passes a migration's config through, for statements that can't run in a transaction", async () => {
    write(
      '0030_01_concurrent_index.js',
      `${MIGRATION_JS}\nexports.config = { transaction: false };`,
    );
    const source = new DirectoryMigrationSource(directory, { schema: 'maqady' }, '.js');
    const migration = await source.getMigration('0030_01_concurrent_index');
    expect(migration.config).toEqual({ transaction: false });
  });

  it('rejects a file that lacks up() or down()', async () => {
    write('0010_01_broken.js', 'exports.up = async () => {};');
    const source = new DirectoryMigrationSource(directory, { schema: 'maqady' }, '.js');
    await expect(source.getMigration('0010_01_broken')).rejects.toThrow(
      'Migration 0010_01_broken must export up() and down()',
    );
  });

  it("finds this repository's migrations, starting with the scaffold's", async () => {
    // This test file runs as TypeScript, so the default extension is .ts.
    const names = await new DirectoryMigrationSource(MIGRATIONS_DIRECTORY, {
      schema: 'maqady',
    }).getMigrations();
    expect(names[0]).toBe('0010_01_create_schema');
    expect(names.every((name) => /^\d{4}_\d{2}_[a-z0-9_]+$/.test(name))).toBe(true);
  });
});
