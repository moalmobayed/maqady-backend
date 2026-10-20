import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Knex } from 'knex';
import type { BoundMigration, MigrationContext, MigrationFile } from './types';

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
    const { up, down, config } = file;
    if (typeof up !== 'function' || typeof down !== 'function') {
      return Promise.reject(new TypeError(`Migration ${migration} must export up() and down()`));
    }
    return Promise.resolve({
      up: (knex: Knex) => up(knex, this.context),
      down: (knex: Knex) => down(knex, this.context),
      ...(config ? { config } : {}),
    });
  }
}
