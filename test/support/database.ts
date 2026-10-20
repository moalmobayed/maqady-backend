import type { Knex } from 'knex';

/**
 * Tables `resetDatabase()` leaves alone: Knex's bookkeeping, and reference data that migrations
 * seed. A unit that seeds a table in a migration adds it here.
 */
export const PRESERVED_TABLES = ['knex_migrations', 'knex_migrations_lock'];

/** Empties every other table in the schema, so each suite starts and ends with no data. */
export async function resetDatabase(knex: Knex, schema: string): Promise<void> {
  const { rows } = await knex.raw<{ rows: { tablename: string }[] }>(
    'SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = ? AND NOT (tablename = ANY(?))',
    [schema, PRESERVED_TABLES],
  );
  if (rows.length === 0) return;
  const tables = rows.map(() => '??.??').join(', ');
  await knex.raw(
    `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`,
    rows.flatMap(({ tablename }) => [schema, tablename]),
  );
}
