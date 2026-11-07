import type { AuditReadService } from '../../../../src/common/audit/audit-read.service';
import { AdminBookingsService } from '../../../../src/modules/bookings/admin-bookings.service';
import type { BookingViews } from '../../../../src/modules/bookings/booking-views.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import type { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import type { StaffRefsService } from '../../../../src/modules/bookings/staff-refs.service';
import type { BookingRow } from '../../../../src/modules/bookings/types';
import type { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { PaymentsService } from '../../../../src/modules/payments/payments.service';
import { confirmedRow } from '../../../support/booking-rows-admin';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-11T01:30:00+03:00');

/** U18: `itemsByIds()`, the admin list rows of chosen bookings (search hits). */
describe('AdminBookingsService.itemsByIds', () => {
  let findByIds: jest.Mock;
  let ofMany: jest.Mock;
  let settleAllDue: jest.Mock;
  let service: AdminBookingsService;

  beforeEach(() => {
    // The repository answers in id order, as findByIds() does.
    findByIds = jest.fn((ids: number[]) =>
      Promise.resolve(
        [...ids]
          .filter((id) => id !== 404)
          .sort((a, b) => a - b)
          .map((id) => confirmedRow({ id, contact_name: `Contact ${id}`, checked_in_at: null })),
      ),
    );
    ofMany = jest.fn((rows: BookingRow[]) =>
      Promise.resolve(rows.map((row) => ({ id: row.id, reference: `ref-${row.id}` }))),
    );
    settleAllDue = jest.fn();
    service = new AdminBookingsService(
      { findByIds } as unknown as BookingsRepository,
      { ofMany } as unknown as BookingViews,
      {} as PaymentsService,
      {} as CustomerService,
      {} as StaffRefsService,
      {} as AuditReadService,
      { settleAllDue } as unknown as SettlementService,
      new TestClock(NOW),
    );
  });

  it('answers the rows in the order asked, leaves unknown ids out, and judges them at now', async () => {
    const items = await service.itemsByIds([9, 404, 3, 9, 5]);
    expect(items.map((item) => item.booking.id)).toEqual([9, 3, 5]);
    expect(items[0]).toEqual({
      booking: { id: 9, reference: 'ref-9' },
      contact: { name: 'Contact 9', email: 'nadia@example.com', phone: '+201012345678' },
      checkedInAt: null,
    });
    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(ofMany).toHaveBeenCalledTimes(1);
    expect(ofMany).toHaveBeenCalledWith(expect.any(Array), NOW);
    expect(settleAllDue).not.toHaveBeenCalled();
  });

  it('queries nothing for no ids', async () => {
    expect(await service.itemsByIds([])).toEqual([]);
    expect(findByIds).not.toHaveBeenCalled();
    expect(ofMany).not.toHaveBeenCalled();
  });
});
