import { join } from 'node:path';

/** Injection token for the one shared Knex instance. Only repositories inject it (CLAUDE.md). */
export const KNEX = Symbol('KNEX');

/** Design §14.2: at most 5 connections through Supabase's session pooler. */
export const POOL_MAX_CONNECTIONS = 5;
/** How long opening a new connection may take before the request fails as unavailable. */
export const CONNECT_TIMEOUT_MS = 5_000;
/** How long a query may wait for a free pooled connection. */
export const ACQUIRE_TIMEOUT_MS = 10_000;
/** Design §14.2: per-statement and idle-in-transaction limits, set on every new connection. */
export const STATEMENT_TIMEOUT = '10s';
export const IDLE_IN_TRANSACTION_SESSION_TIMEOUT = '15s';

/** Shown in `pg_stat_activity`, so the service's connections are easy to tell apart. */
export const APPLICATION_NAME = 'maqady-backend';

/**
 * Schemas searched after the service's own: Supabase installs extensions in `extensions`,
 * plain Postgres in `public`. Postgres skips a schema that doesn't exist.
 */
export const EXTENSION_SCHEMAS = ['extensions', 'public'] as const;

/**
 * Advisory-lock name that serializes migration runs in one database. Knex's own lock can't:
 * creating the schema and Knex's tables happens before it, and concurrent first runs collide.
 */
export const MIGRATION_ADVISORY_LOCK = 'maqady-backend:migrations';

/**
 * How long a booting process waits for another's migration run before it gives up with a lock
 * timeout. Without a limit, a holder that never finishes (its process died, but a pooler kept
 * its server session) would hang every later boot until the host's request timeout.
 */
export const MIGRATION_LOCK_TIMEOUT = '45s';

/**
 * How long the lock holder may sit idle in its transaction while the migrations run on other
 * connections. Far above any real run; it ends a holder whose process died, so the lock frees.
 */
export const MIGRATION_LOCK_HOLDER_IDLE_TIMEOUT = '5min';

/** Knex's bookkeeping table; it lives in the service's schema (with `<name>_lock`). */
export const MIGRATIONS_TABLE = 'knex_migrations';

/** `src/migrations` when running the TypeScript sources, `dist/migrations` when compiled. */
export const MIGRATIONS_DIRECTORY = join(__dirname, '..', '..', 'migrations');
