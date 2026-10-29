import { MIGRATIONS } from '../../../src/common/database/migration-list';
import { createTestApp } from '../../support/test-app';
import type { TestApp } from '../../support/types';

/** U16 migration 0170_01 (design §13.3): the Payments screen's indexes. */
describe('payments screen migration (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ resetData: false });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('is in the static migration list the deployment runs', () => {
    expect(MIGRATIONS.map((migration) => migration.name)).toContain(
      '0170_01_add_payments_screen_indexes',
    );
  });

  it('creates both indexes with a comment naming the query each serves', async () => {
    const { rows } = await testApp.knex.raw<{
      rows: { indexname: string; indexdef: string; comment: string | null }[];
    }>(
      `SELECT i.indexname, i.indexdef,
              obj_description(format('%I.%I', i.schemaname, i.indexname)::regclass) AS comment
       FROM pg_indexes i
       WHERE i.schemaname = current_schema() AND i.indexname = ANY(?)
       ORDER BY i.indexname`,
      [['idx_bookings_confirmed_at', 'idx_payments_occurred_at']],
    );
    expect(rows.map((row) => row.indexname)).toEqual([
      'idx_bookings_confirmed_at',
      'idx_payments_occurred_at',
    ]);
    expect(rows[0]!.indexdef).toContain('WHERE (confirmed_at IS NOT NULL)');
    expect(rows[1]!.indexdef).toContain('COALESCE(completed_at, created_at)');
    for (const row of rows) {
      expect({ index: row.indexname, comment: row.comment }).toEqual({
        index: row.indexname,
        comment: expect.stringMatching(/GET \/admin\/payments/),
      });
    }
  });

  it('serves the transactions order and the confirmed period from them', async () => {
    const plans = await testApp.knex.transaction(async (trx) => {
      await trx.raw('SET LOCAL enable_seqscan = off');
      const explain = async (sql: string) => {
        const { rows } = await trx.raw<{ rows: { 'QUERY PLAN': string }[] }>(`EXPLAIN ${sql}`);
        return rows.map((row) => row['QUERY PLAN']).join('\n');
      };
      return {
        list: await explain(
          `SELECT p.id FROM payments AS p
           WHERE COALESCE(p.completed_at, p.created_at) >= now() - interval '7 days'
           ORDER BY COALESCE(p.completed_at, p.created_at) DESC, p.id DESC LIMIT 21`,
        ),
        confirmed: await explain(
          `SELECT id FROM bookings WHERE confirmed_at >= now() - interval '7 days' AND confirmed_at < now()`,
        ),
      };
    });
    expect(plans.list).toContain('idx_payments_occurred_at');
    expect(plans.confirmed).toContain('idx_bookings_confirmed_at');
  });
});
