import { createTestApp } from '../../support/test-app';
import type { TestApp } from '../../support/types';

const NEW_INDEXES = ['idx_theaters_district_trgm', 'idx_theaters_name_trgm'];
const RECOMMENTED = [
  'idx_bookings_contact_email_trgm',
  'idx_bookings_contact_name_trgm',
  'idx_bookings_contact_phone_trgm',
  'idx_customers_email_trgm',
  'idx_customers_full_name_trgm',
  'idx_customers_phone_trgm',
  'idx_movies_title_trgm',
  'idx_people_full_name_trgm',
];

/** U18 migration 0190_01 (design §13.2): the search indexes and their comments. */
describe('search migration (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function indexes(names: string[]) {
    const { rows } = await testApp.knex.raw<{
      rows: { indexname: string; indexdef: string; comment: string | null }[];
    }>(
      `SELECT i.indexname, i.indexdef,
              obj_description(format('%I.%I', i.schemaname, i.indexname)::regclass) AS comment
       FROM pg_indexes i
       WHERE i.schemaname = current_schema() AND i.indexname = ANY(?)
       ORDER BY i.indexname`,
      [names],
    );
    return rows;
  }

  /** The plan of `sql` with sequential scans off, after `setup`; everything is rolled back. */
  async function plan(sql: string, setup: string[] = []): Promise<string> {
    const trx = await testApp.knex.transaction();
    try {
      for (const statement of setup) await trx.raw(statement);
      await trx.raw('SET LOCAL enable_seqscan = off');
      const { rows } = await trx.raw<{ rows: { 'QUERY PLAN': string }[] }>(`EXPLAIN ${sql}`);
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    } finally {
      await trx.rollback();
    }
  }

  it('creates the theater trigram indexes, each with a comment naming its query', async () => {
    const rows = await indexes(NEW_INDEXES);
    expect(rows.map((row) => row.indexname)).toEqual(NEW_INDEXES);
    for (const row of rows) {
      expect(row.indexdef).toContain('USING gin');
      expect(row.indexdef).toContain('gin_trgm_ops');
      expect({ index: row.indexname, comment: row.comment }).toEqual({
        index: row.indexname,
        comment: expect.stringMatching(/GET \/search.*GET \/admin\/search/),
      });
    }
  });

  it('names the search routes in the comments of the existing search indexes', async () => {
    const rows = await indexes(RECOMMENTED);
    expect(rows.map((row) => row.indexname)).toEqual(RECOMMENTED);
    for (const row of rows) {
      expect({ index: row.indexname, comment: row.comment }).toEqual({
        index: row.indexname,
        comment: expect.stringContaining('GET /admin/search'),
      });
    }
  });

  it('serves the substring and the typo-tolerant matches from the trigram indexes', async () => {
    const theaters = await plan(
      `SELECT id FROM theaters
       WHERE name::text ILIKE '%nile%' OR 'nile' <% name::text
          OR district ILIKE '%nile%' OR 'nile' <% district`,
    );
    expect(theaters).toContain('idx_theaters_name_trgm');
    expect(theaters).toContain('idx_theaters_district_trgm');
    const movies = await plan(
      `SELECT id FROM movies WHERE title ILIKE '%incepton%' OR 'incepton' <% title`,
    );
    expect(movies).toContain('idx_movies_title_trgm');
    // people also has a B-tree on full_name, which the planner may scan whole instead; without
    // it (dropped inside the rolled-back transaction) the trigram index serves the search.
    const people = await plan(
      `SELECT id FROM people WHERE full_name ILIKE '%helmy%' OR 'helmy' <% full_name`,
      ['DROP INDEX idx_people_full_name'],
    );
    expect(people).toContain('idx_people_full_name_trgm');
  });
});
