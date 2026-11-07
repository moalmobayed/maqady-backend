import type { Knex } from 'knex';
import { paidOnline } from '../../support/admin-bookings';
import { TestClock } from '../../support/clock';
import { bookableShowtime } from '../../support/holds';
import { staffSession } from '../../support/staff-auth';
import { createTestApp } from '../../support/test-app';
import type { StaffSession, TestApp } from '../../support/types';

const NOW = new Date('2026-10-10T10:00:00+03:00');

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

/** U14 migrations 0150_01 and 0150_02 (design §6.2, §13.2): booking notes and the list indexes. */
describe('admin bookings migrations (integration)', () => {
  let testApp: TestApp;
  let staff: StaffSession;
  let bookingId: number;
  const clock = new TestClock(NOW);

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    staff = await staffSession(testApp, 'admin');
    const showtime = await bookableShowtime(testApp, staff);
    bookingId = (await paidOnline(testApp, showtime.showtimeId, ['B2'])).bookingId;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('keeps a note on an existing booking by an existing staff member, never blank', async () => {
    const note = (overrides: Record<string, unknown>) =>
      violation(testApp.knex, (trx) =>
        trx('booking_notes').insert({
          booking_id: bookingId,
          staff_user_id: staff.staffUserId,
          body: 'Will arrive late.',
          created_at: NOW,
          ...overrides,
        }),
      );
    expect(await note({})).toBeNull();
    expect(await note({ body: 'x'.repeat(1000) })).toBeNull();
    expect(await note({ body: '   ' })).toBe('chk_booking_notes_body');
    expect(await note({ booking_id: 999999 })).toBe('fk_booking_notes_booking_id');
    expect(await note({ staff_user_id: 999999 })).toBe('fk_booking_notes_staff_user_id');
    expect(String(await note({ body: 'x'.repeat(1001) }))).toContain('too long');
    expect(String(await note({ created_at: null }))).toContain('null value');
  });

  it('creates every index with a comment naming its query, and row-level security on notes', async () => {
    const { rows } = await testApp.knex.raw<{
      rows: { indexname: string; comment: string | null }[];
    }>(
      `SELECT i.indexname, obj_description(format('%I.%I', i.schemaname, i.indexname)::regclass) AS comment
       FROM pg_indexes i
       WHERE i.schemaname = current_schema() AND i.indexname = ANY(?)
       ORDER BY i.indexname`,
      [
        [
          'idx_booking_notes_booking_id_created_at',
          'idx_booking_notes_staff_user_id',
          'idx_bookings_created_at',
          'idx_bookings_contact_name_trgm',
          'idx_bookings_contact_email_trgm',
          'idx_bookings_contact_phone_trgm',
          'idx_bookings_refunded_at',
          'idx_payments_completed_at',
        ],
      ],
    );
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect({ index: row.indexname, comment: row.comment }).toEqual({
        index: row.indexname,
        comment: expect.stringMatching(/WHERE|ORDER BY/),
      });
    }
    const { rows: security } = await testApp.knex.raw<{ rows: { relrowsecurity: boolean }[] }>(
      `SELECT relrowsecurity FROM pg_class WHERE oid = format('%I.booking_notes', current_schema())::regclass`,
    );
    expect(security[0]?.relrowsecurity).toBe(true);
  });

  it('serves the contact search from the trigram indexes', async () => {
    const plan = await testApp.knex.transaction(async (trx) => {
      await trx.raw('SET LOCAL enable_seqscan = off');
      const { rows } = await trx.raw<{ rows: { 'QUERY PLAN': string }[] }>(
        `EXPLAIN SELECT id FROM bookings
         WHERE contact_name ILIKE '%nadia%' OR contact_email::text ILIKE '%nadia%' OR contact_phone ILIKE '%nadia%'`,
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('idx_bookings_contact_name_trgm');
    expect(plan).toContain('idx_bookings_contact_email_trgm');
    expect(plan).toContain('idx_bookings_contact_phone_trgm');
  });
});
