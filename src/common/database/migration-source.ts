import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Knex } from 'knex';
import type { BoundMigration, ListedMigration, MigrationContext, MigrationFile } from './types';

/**
 * Lists and loads the migrations in one directory, for `knex.migrate`.
 *
 * - Names are recorded without their extension, so running the TypeScript sources (tests) and
 *   the compiled JavaScript (production) record the same `knex_migrations` rows.
 * - Files sort by name, which is why names start with the unit prefix: `0010_01_create_schema`.
 * - Each migration receives a `MigrationContext` (the schema) as its second argument.
 */
export class DirectoryMigrationSource implements Knex.MigrationSource<string> {
  constructor(
    private readonly directory: string,
    private readonly context: MigrationContext,
    /** `.ts` when this file runs as TypeScript (tests), `.js` when compiled. */
    private readonly extension: string = extname(__filename),
  ) {}

  getMigrations(): Promise<string[]> {
    const names = readdirSync(this.directory)
      .filter((file) => file.endsWith(this.extension) && !file.endsWith(`.d${this.extension}`))
      .map((file) => file.slice(0, -this.extension.length))
      .sort();
    return Promise.resolve(names);
  }

  getMigrationName(migration: string): string {
    return migration;
  }

  getMigration(migration: string): Promise<BoundMigration> {
    const path = join(this.directory, `${migration}${this.extension}`);
    // Loaded by path at run time, like Knex's own source; Jest's require compiles the .ts files.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const file = require(path) as Partial<MigrationFile>;
    return bindMigration(migration, file, this.context);
  }
}

/**
 * Hands Knex the migrations of a static list (`MIGRATIONS`), in its order, for the app at run
 * time: nothing is read from disk, so a bundled or traced deployment has every migration. Names
 * match `DirectoryMigrationSource`'s, so both record the same `knex_migrations` rows.
 */
export class ListedMigrationSource implements Knex.MigrationSource<string> {
  private readonly byName: ReadonlyMap<string, Partial<MigrationFile>>;

  constructor(
    private readonly migrations: readonly ListedMigration[],
    private readonly context: MigrationContext,
  ) {
    this.byName = new Map(migrations.map((migration) => [migration.name, migration.file]));
  }

  getMigrations(): Promise<string[]> {
    return Promise.resolve(this.migrations.map((migration) => migration.name));
  }

  getMigrationName(migration: string): string {
    return migration;
  }

  getMigration(migration: string): Promise<BoundMigration> {
    const file = this.byName.get(migration);
    if (file === undefined) {
      return Promise.reject(new TypeError(`Migration ${migration} is not in the migration list`));
    }
    return bindMigration(migration, file, this.context);
  }
}

function bindMigration(
  name: string,
  file: Partial<MigrationFile>,
  context: MigrationContext,
): Promise<BoundMigration> {
  const { up, down, config } = file;
  if (typeof up !== 'function' || typeof down !== 'function') {
    return Promise.reject(new TypeError(`Migration ${name} must export up() and down()`));
  }
  return Promise.resolve({
    up: (knex: Knex) => up(knex, context),
    down: (knex: Knex) => down(knex, context),
    ...(config ? { config } : {}),
  });
}
