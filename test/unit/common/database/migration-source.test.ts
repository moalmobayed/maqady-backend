import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { MIGRATIONS_DIRECTORY } from '../../../../src/common/database/database.constants';
import { MIGRATIONS } from '../../../../src/common/database/migration-list';
import {
  DirectoryMigrationSource,
  ListedMigrationSource,
} from '../../../../src/common/database/migration-source';
import type { MigrationContext } from '../../../../src/common/database/types';

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

describe('ListedMigrationSource', () => {
  const recorder = (label: string) => ({
    up: async (knex: Knex, context: MigrationContext) => {
      (knex as unknown as { calls: unknown[] }).calls.push([label, 'up', context.schema]);
    },
    down: async (knex: Knex, context: MigrationContext) => {
      (knex as unknown as { calls: unknown[] }).calls.push([label, 'down', context.schema]);
    },
  });

  it('lists the migrations in the order given, and binds each to its context', async () => {
    const source = new ListedMigrationSource(
      [
        { name: '0010_01_create_schema', file: recorder('a') },
        {
          name: '0020_01_create_staff',
          file: { ...recorder('b'), config: { transaction: false } },
        },
      ],
      { schema: 'tenant_x' },
    );
    expect(await source.getMigrations()).toEqual(['0010_01_create_schema', '0020_01_create_staff']);
    expect(source.getMigrationName('0020_01_create_staff')).toBe('0020_01_create_staff');

    const knex = { calls: [] as unknown[] };
    const first = await source.getMigration('0010_01_create_schema');
    const second = await source.getMigration('0020_01_create_staff');
    await first.up(knex as unknown as Knex);
    await second.down(knex as unknown as Knex);
    expect(knex.calls).toEqual([
      ['a', 'up', 'tenant_x'],
      ['b', 'down', 'tenant_x'],
    ]);
    expect(first).not.toHaveProperty('config');
    expect(second.config).toEqual({ transaction: false });
  });

  it('rejects a name that is not listed, or a module without up() and down()', async () => {
    const source = new ListedMigrationSource(
      [{ name: '0010_01_broken', file: { up: recorder('x').up } }],
      { schema: 'maqady' },
    );
    await expect(source.getMigration('0099_01_missing')).rejects.toThrow(
      'Migration 0099_01_missing is not in the migration list',
    );
    await expect(source.getMigration('0010_01_broken')).rejects.toThrow(
      'Migration 0010_01_broken must export up() and down()',
    );
  });

  it("lists exactly this repository's migration files, in file order, each with up() and down()", async () => {
    // A migration file missing from MIGRATIONS would never run on a traced deployment.
    const onDisk = await new DirectoryMigrationSource(MIGRATIONS_DIRECTORY, {
      schema: 'maqady',
    }).getMigrations();
    expect(MIGRATIONS.map((migration) => migration.name)).toEqual(onDisk);
    for (const { name, file } of MIGRATIONS) {
      expect({ name, up: typeof file.up, down: typeof file.down }).toEqual({
        name,
        up: 'function',
        down: 'function',
      });
    }
  });
});
