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

/**
 * Resolves once at least `count` connections to this database wait on a lock (a row lock taken by
 * the test, for example), so a race test can release the lock only when every contender is queued.
 */
export async function waitForLockWaiters(knex: Knex, count: number): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const { rows } = await knex.raw<{ rows: { waiting: number }[] }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.waiting ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Fewer than ${count} connections started waiting on a lock`);
}
