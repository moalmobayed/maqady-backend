import { createTestApp } from '../../support/test-app';
import type { TestApp } from '../../support/types';

const INDEXES = [
  'idx_customers_created_at',
  'idx_customers_email_trgm',
  'idx_customers_full_name_trgm',
  'idx_customers_phone_trgm',
];

/** U15 migration 0160_01 (design §13.2): the admin customers list and search indexes. */
describe('admin customers migration (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('creates every index with a comment naming its query', async () => {
    const { rows } = await testApp.knex.raw<{
      rows: { indexname: string; indexdef: string; comment: string | null }[];
    }>(
      `SELECT i.indexname, i.indexdef,
              obj_description(format('%I.%I', i.schemaname, i.indexname)::regclass) AS comment
       FROM pg_indexes i
       WHERE i.schemaname = current_schema() AND i.indexname = ANY(?)
       ORDER BY i.indexname`,
      [INDEXES],
    );
    expect(rows.map((row) => row.indexname)).toEqual(INDEXES);
    for (const row of rows) {
      expect({ index: row.indexname, comment: row.comment }).toEqual({
        index: row.indexname,
        comment: expect.stringMatching(/GET \/admin\/customers/),
      });
    }
    const listIndex = rows.find((row) => row.indexname === 'idx_customers_created_at');
    expect(listIndex?.indexdef).toContain('(created_at, id) WHERE (deleted_at IS NULL)');
  });

  it('serves the name, email and phone search from the trigram indexes', async () => {
    const plan = await testApp.knex.transaction(async (trx) => {
      await trx.raw('SET LOCAL enable_seqscan = off');
      const { rows } = await trx.raw<{ rows: { 'QUERY PLAN': string }[] }>(
        `EXPLAIN SELECT id FROM customers
         WHERE full_name ILIKE '%layla%' OR email::text ILIKE '%layla%' OR phone ILIKE '%layla%'`,
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('idx_customers_full_name_trgm');
    expect(plan).toContain('idx_customers_email_trgm');
    expect(plan).toContain('idx_customers_phone_trgm');
  });
});
