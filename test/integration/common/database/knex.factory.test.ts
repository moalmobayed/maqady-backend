import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

describe('The shared Knex instance (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('applies the session settings on its pooled connections', async () => {
    const { rows } = await testApp.knex.raw<{ rows: Record<string, string>[] }>(
      `SELECT current_setting('statement_timeout') AS statement_timeout,
              current_setting('idle_in_transaction_session_timeout') AS idle_timeout,
              current_setting('TimeZone') AS time_zone,
              current_setting('search_path') AS search_path,
              current_setting('application_name') AS application_name`,
    );
    expect(rows[0]).toEqual({
      statement_timeout: '10s',
      idle_timeout: '15s',
      time_zone: 'UTC',
      search_path: 'maqady, extensions, public',
      application_name: 'maqady-backend',
    });
  });

  it('applies them on every connection in the pool, not only the first', async () => {
    const settings = await Promise.all(
      Array.from({ length: 5 }, () =>
        testApp.knex.transaction(async (trx) => {
          const { rows } = await trx.raw<{ rows: { timeout: string; pid: number }[] }>(
            "SELECT current_setting('statement_timeout') AS timeout, pg_backend_pid() AS pid",
          );
          await trx.raw('SELECT pg_sleep(0.05)');
          return rows[0];
        }),
      ),
    );
    expect(new Set(settings.map((row) => row?.pid)).size).toBe(5);
    expect(settings.every((row) => row?.timeout === '10s')).toBe(true);
  });

  it('caps the pool at 5 connections', () => {
    const pool = testApp.knex.client.pool as { max: number; min: number };
    expect(pool.max).toBe(5);
    expect(pool.min).toBe(0);
  });

  it('returns BIGINT and COUNT as numbers, NUMERIC as floats and DATE as text', async () => {
    const { rows } = await testApp.knex.raw<{ rows: Record<string, unknown>[] }>(
      `SELECT 9007199254740991::bigint AS big,
              (SELECT count(*) FROM generate_series(1, 3)) AS counted,
              30.044420::numeric(9, 6) AS latitude,
              DATE '2026-10-16' AS cinema_date,
              ARRAY[1, 2, NULL]::bigint[] AS ids,
              ARRAY[1.5, 2.25]::numeric[] AS prices,
              ARRAY[DATE '2026-03-27', NULL] AS dates`,
    );
    expect(rows[0]).toEqual({
      big: Number.MAX_SAFE_INTEGER,
      counted: 3,
      latitude: 30.04442,
      cinema_date: '2026-10-16',
      ids: [1, 2, null],
      prices: [1.5, 2.25],
      dates: ['2026-03-27', null],
    });
  });

  it('fails a query whose BIGINT would lose precision, instead of returning a wrong number', async () => {
    await expect(testApp.knex.raw('SELECT 9007199254740993::bigint AS too_big')).rejects.toThrow(
      'outside the safe integer range',
    );
  });

  it('quotes the SQL with placeholders, not the bound values, in a query error', async () => {
    const error: unknown = await testApp.knex.raw('SELECT ?::int AS n', ['mona@example.com']).then(
      () => undefined,
      (rejection: unknown) => rejection,
    );
    const { message, code } = error as { message: string; code: string };
    expect(code).toBe('22P02');
    expect(message.startsWith('SELECT $1::int AS n - ')).toBe(true);
    expect(message).not.toContain("SELECT 'mona@example.com'");
    // Postgres's own text can still echo the value, which is why logs keep only the SQLSTATE.
    expect(message).toContain('invalid input syntax for type integer');
  });
});
