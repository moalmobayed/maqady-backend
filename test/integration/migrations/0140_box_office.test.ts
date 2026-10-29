import type { Knex } from 'knex';
import { CASH_WALK_IN, counterHold, counterPay } from '../../support/box-office';
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

/** U13 migrations 0140_01 and 0140_02 (design §6.2, §7.6, §7.9): what the database refuses. */
describe('box office migrations (integration)', () => {
  let testApp: TestApp;
  let staff: StaffSession;
  let heldId: number;
  let confirmedId: number;
  const clock = new TestClock(NOW);

  const charge = (overrides: Record<string, unknown>) => ({
    booking_id: heldId,
    kind: 'charge',
    purpose: 'sale',
    status: 'succeeded',
    amount: 15000,
    currency: 'EGP',
    collected_by_staff_id: staff.staffUserId,
    completed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    const admin = await staffSession(testApp, 'admin');
    staff = await staffSession(testApp, 'box_office');
    const showtime = await bookableShowtime(testApp, admin);
    const held = await counterHold(testApp, staff.authorization, showtime.showtimeId, ['B1']);
    const other = await counterHold(testApp, admin.authorization, showtime.showtimeId, ['B2']);
    expect(
      (await counterPay(testApp, admin.authorization, other.body.reference, CASH_WALK_IN)).status,
    ).toBe(201);
    const ids = await testApp
      .knex('bookings')
      .select<{ id: number; reference: string }[]>('id', 'reference')
      .whereIn('reference', [held.body.reference, other.body.reference]);
    heldId = ids.find((row) => row.reference === held.body.reference)!.id;
    confirmedId = ids.find((row) => row.reference === other.body.reference)!.id;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('requires a card terminal receipt reference in the API form, and none for cash', async () => {
    const { knex } = testApp;
    const cases: [string | null, Record<string, unknown>][] = [
      [null, { method: 'cash', provider_reference: null }],
      [null, { method: 'card_terminal', provider_reference: 'TRX-0042817' }],
      [null, { method: 'card_terminal', provider_reference: 'A 1./_-' }],
      ['chk_payments_receipt_reference', { method: 'cash', provider_reference: 'TRX-1' }],
      ['chk_payments_receipt_reference', { method: 'card_terminal', provider_reference: null }],
      ['chk_payments_receipt_reference', { method: 'card_terminal', provider_reference: ' TRX' }],
      ['chk_payments_receipt_reference', { method: 'card_terminal', provider_reference: '#1' }],
      [
        'chk_payments_receipt_reference',
        { method: 'card_terminal', provider_reference: `A${'b'.repeat(64)}` },
      ],
    ];
    for (const [expected, overrides] of cases) {
      const result = await violation(knex, (trx) => trx('payments').insert(charge(overrides)));
      expect({ overrides, result }).toEqual({ overrides, result: expected });
    }
  });

  it('admits only a confirmed or refunded booking', async () => {
    const { knex } = testApp;
    const admit = { checked_in_at: NOW, checked_in_by_staff_id: staff.staffUserId };
    expect(
      await violation(knex, (trx) => trx('bookings').where({ id: heldId }).update(admit)),
    ).toBe('chk_bookings_checked_in_paid');
    expect(
      await violation(knex, (trx) => trx('bookings').where({ id: confirmedId }).update(admit)),
    ).toBeNull();
    expect(
      await violation(knex, (trx) =>
        trx('bookings')
          .where({ id: confirmedId })
          .update({ ...admit, status: 'refunded', refunded_at: NOW }),
      ),
    ).toBeNull();
  });
});
