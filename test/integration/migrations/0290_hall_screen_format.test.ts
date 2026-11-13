import type { Knex } from 'knex';
import * as migration from '../../../src/migrations/0290_31_add_halls_format_and_screen';
import { createHall } from '../../support/halls';
import { staffSession } from '../../support/staff-auth';
import { createTestApp } from '../../support/test-app';
import { createTheater } from '../../support/theaters';
import type { StaffSession, TestApp } from '../../support/types';

// Real staff sign-ins hash passwords with scrypt.
jest.setTimeout(60_000);

/** The constraint a statement fails on, or null when it succeeds. Always rolled back. */
async function violation(knex: Knex, statement: (trx: Knex.Transaction) => Promise<unknown>) {
  const trx = await knex.transaction();
  try {
    await statement(trx);
    return null;
  } catch (error) {
    return (error as { constraint?: string }).constraint ?? String(error);
  } finally {
    await trx.rollback();
  }
}

/** #29 P4 migration 0290_31 (docs/gh-29-hall-screen-format): hall format and screen size. */
describe('hall format and screen migration (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let hallId: number;

  beforeAll(async () => {
    testApp = await createTestApp();
    admin = await staffSession(testApp, 'admin');
    const theaterId = await createTheater(testApp, admin.authorization);
    hallId = await createHall(testApp, admin.authorization, theaterId, 'Hall 1');
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('gives a hall that existed before it the standard format and no screen', async () => {
    const schema = testApp.config.database.schema;
    const trx = await testApp.knex.transaction();
    try {
      // Back to the halls of the previous release, a hall written without the new columns...
      await migration.down(trx, { schema });
      const { rows: columns } = await trx.raw<{ rows: { column_name: string }[] }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'halls'`,
      );
      expect(columns.map((row) => row.column_name)).not.toContain('format');
      await trx('halls').where({ id: hallId }).update({ name: 'Hall from before' });
      // ...then this release's migration.
      await migration.up(trx);
      expect(
        await trx('halls')
          .select('name', 'format', 'screen_width_cm', 'screen_height_cm')
          .where({ id: hallId })
          .first(),
      ).toEqual({
        name: 'Hall from before',
        format: 'standard',
        screen_width_cm: null,
        screen_height_cm: null,
      });
      // The previous release inserts halls naming its own columns: still accepted.
      const [inserted] = await trx('halls')
        .insert({
          theater_id: (await trx('halls').select('theater_id').where({ id: hallId }).first())
            .theater_id,
          name: 'Hall from the previous release',
          status: 'draft',
          row_count: 12,
          seats_per_row: 16,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning(['format']);
      expect(inserted).toEqual({ format: 'standard' });
    } finally {
      await trx.rollback();
    }
  });

  it('keeps the format to the list and the screen to both sides of 1 m to 50 m', async () => {
    const write = (changes: Record<string, unknown>) =>
      violation(testApp.knex, (trx) => trx('halls').where({ id: hallId }).update(changes));
    for (const format of ['standard', 'vip', 'imax', 'dolby_atmos', '4dx', 'screenx', 'max']) {
      expect(await write({ format })).toBeNull();
    }
    expect(await write({ format: '3d' })).toBe('chk_halls_format');
    expect(String(await write({ format: null }))).toContain('null value');
    expect(await write({ screen_width_cm: 2210, screen_height_cm: 1230 })).toBeNull();
    expect(await write({ screen_width_cm: 100, screen_height_cm: 5000 })).toBeNull();
    expect(await write({ screen_width_cm: 2210 })).toBe('chk_halls_screen_size');
    expect(await write({ screen_height_cm: 1230 })).toBe('chk_halls_screen_size');
    expect(await write({ screen_width_cm: 99, screen_height_cm: 1230 })).toBe(
      'chk_halls_screen_width_cm',
    );
    expect(await write({ screen_width_cm: 2210, screen_height_cm: 5001 })).toBe(
      'chk_halls_screen_height_cm',
    );
  });

  it('describes each new column', async () => {
    const { rows } = await testApp.knex.raw<{ rows: { column: string; comment: string | null }[] }>(
      `SELECT a.attname AS column, col_description(a.attrelid, a.attnum) AS comment
       FROM pg_attribute a
       WHERE a.attrelid = format('%I.halls', current_schema())::regclass
         AND a.attname IN ('format', 'screen_width_cm', 'screen_height_cm')
       ORDER BY a.attname`,
    );
    expect(rows.map((row) => [row.column, typeof row.comment])).toEqual([
      ['format', 'string'],
      ['screen_height_cm', 'string'],
      ['screen_width_cm', 'string'],
    ]);
  });
});
