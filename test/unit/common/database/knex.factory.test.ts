import { Logger } from '@nestjs/common';
import type { Knex } from 'knex';
import {
  ACQUIRE_TIMEOUT_MS,
  APPLICATION_NAME,
  CONNECT_TIMEOUT_MS,
  POOL_MAX_CONNECTIONS,
} from '../../../../src/common/database/database.constants';
import {
  buildKnexConfig,
  createKnex,
  KNEX_LOG,
  SESSION_SETTINGS_SQL,
} from '../../../../src/common/database/knex.factory';

const DATABASE = { url: 'postgres://u:p@db.example.com:5432/maqady', schema: 'maqady' };

describe('buildKnexConfig', () => {
  const config = buildKnexConfig(DATABASE);

  it('uses pg through the configured URL, named for pg_stat_activity, with a connect timeout', () => {
    expect(config.client).toBe('pg');
    expect(config.connection).toEqual({
      connectionString: DATABASE.url,
      application_name: APPLICATION_NAME,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    });
  });

  it('searches the service schema first, then the extension schemas', () => {
    expect(config.searchPath).toEqual(['maqady', 'extensions', 'public']);
  });

  it('holds at most 5 connections and keeps none open when idle', () => {
    expect(config.pool).toMatchObject({ min: 0, max: POOL_MAX_CONNECTIONS });
    expect(POOL_MAX_CONNECTIONS).toBe(5);
    expect(config.acquireConnectionTimeout).toBe(ACQUIRE_TIMEOUT_MS);
  });

  it('never quotes bound values in query errors', () => {
    expect(config.compileSqlOnError).toBe(false);
  });

  it("sends Knex's own warnings to the JSON logs instead of the console", () => {
    expect(config.log).toBe(KNEX_LOG);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    KNEX_LOG.warn?.('Acquire connection error: Error: connect ECONNREFUSED 127.0.0.1:1');
    KNEX_LOG.deprecate?.('knex.raw(…).asCallback', 'promises');
    expect(warn).toHaveBeenNthCalledWith(
      1,
      'Acquire connection error: Error: connect ECONNREFUSED 127.0.0.1:1',
    );
    expect(warn).toHaveBeenNthCalledWith(2, 'knex.raw(…).asCallback is deprecated; use promises');
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('sets the timeouts and UTC on every new connection, then hands the connection back', () => {
    const connection = {
      query: jest.fn((_sql: string, callback: (error: Error | null) => void) => callback(null)),
    };
    const done = jest.fn();
    const afterCreate = config.pool?.afterCreate as (c: unknown, d: unknown) => void;
    afterCreate(connection, done);

    expect(connection.query).toHaveBeenCalledWith(SESSION_SETTINGS_SQL, expect.any(Function));
    expect(SESSION_SETTINGS_SQL).toBe(
      "SET statement_timeout = '10s'; SET idle_in_transaction_session_timeout = '15s'; SET TIME ZONE 'UTC'",
    );
    expect(done).toHaveBeenCalledWith(null, connection);
  });

  it('fails the new connection when the settings cannot be applied', () => {
    const failure = new Error('permission denied');
    const connection = {
      query: jest.fn((_sql: string, callback: (error: Error) => void) => callback(failure)),
    };
    const done = jest.fn();
    (config.pool?.afterCreate as (c: unknown, d: unknown) => void)(connection, done);
    expect(done).toHaveBeenCalledWith(failure, connection);
  });
});

describe('createKnex', () => {
  it('creates an instance without connecting', async () => {
    const knex: Knex = createKnex({ url: 'postgres://u:p@127.0.0.1:1/never', schema: 'maqady' });
    expect(knex.client.config.client).toBe('pg');
    await knex.destroy();
  });
});
