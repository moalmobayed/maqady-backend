import { type Knex, knex } from 'knex';
import type { Client } from 'pg';
import type { DatabaseConfig } from '../config/types';
import {
  ACQUIRE_TIMEOUT_MS,
  APPLICATION_NAME,
  CONNECT_TIMEOUT_MS,
  EXTENSION_SCHEMAS,
  IDLE_IN_TRANSACTION_SESSION_TIMEOUT,
  POOL_MAX_CONNECTIONS,
  STATEMENT_TIMEOUT,
} from './database.constants';
import { installPgTypeParsers } from './pg-type-parsers';

/**
 * Session settings for every new pooled connection. Supabase's session pooler keeps a client
 * connection on one server connection, so `SET` lasts as long as the connection. UTC keeps
 * `now()` and date casts identical on a laptop and on Supabase.
 */
export const SESSION_SETTINGS_SQL = [
  `SET statement_timeout = '${STATEMENT_TIMEOUT}'`,
  `SET idle_in_transaction_session_timeout = '${IDLE_IN_TRANSACTION_SESSION_TIMEOUT}'`,
  `SET TIME ZONE 'UTC'`,
].join('; ');

/** The one Knex instance's configuration (design §14.2). The `DatabaseModule` provides it. */
export function buildKnexConfig(config: DatabaseConfig): Knex.Config {
  return {
    client: 'pg',
    connection: {
      connectionString: config.url,
      application_name: APPLICATION_NAME,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    },
    searchPath: [config.schema, ...EXTENSION_SCHEMAS],
    pool: {
      min: 0,
      max: POOL_MAX_CONNECTIONS,
      afterCreate: (
        connection: Client,
        done: (error: Error | null, connection: Client) => void,
      ) => {
        connection.query(SESSION_SETTINGS_SQL, (error: Error | null) => done(error, connection));
      },
    },
    acquireConnectionTimeout: ACQUIRE_TIMEOUT_MS,
    // Query errors then quote the SQL with its placeholders, never the bound values.
    compileSqlOnError: false,
  };
}

export function createKnex(config: DatabaseConfig): Knex {
  installPgTypeParsers();
  return knex(buildKnexConfig(config));
}
