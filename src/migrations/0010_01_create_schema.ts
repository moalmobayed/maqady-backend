import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U0 (#1): the schema every table lives in, and the extensions later tables need.
 *
 * - `citext` for case-insensitive emails, `pg_trgm` for search, `btree_gist` for the showtime
 *   exclusion constraint.
 * - Supabase installs extensions in its `extensions` schema; plain Postgres (Docker Compose, CI)
 *   keeps them in `public`. Both are on the connection's search_path.
 * - Knex's own tables live in this schema, so they get the same row-level security backstop as
 *   every other table (design §6.1): enabled, with no policies.
 */
export async function up(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS ??', [schema]);
  await knex.raw(
    "COMMENT ON SCHEMA ?? IS 'Maqady backend tables. Never exposed through the Supabase Data API.'",
    [schema],
  );

  await knex.raw(`
    DO $$
    DECLARE
      target text := CASE
        WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN 'extensions'
        ELSE 'public'
      END;
    BEGIN
      EXECUTE format('CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA %I', target);
      EXECUTE format('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA %I', target);
      EXECUTE format('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA %I', target);
    END
    $$;
  `);

  await knex.raw('ALTER TABLE ??.knex_migrations ENABLE ROW LEVEL SECURITY', [schema]);
  await knex.raw('ALTER TABLE ??.knex_migrations_lock ENABLE ROW LEVEL SECURITY', [schema]);
}

/** Rolling back the base migration would drop every table, so it is refused. */
export function down(): Promise<void> {
  return Promise.reject(
    new Error(
      '0010_01_create_schema cannot be rolled back; drop the schema by hand if you mean it',
    ),
  );
}
