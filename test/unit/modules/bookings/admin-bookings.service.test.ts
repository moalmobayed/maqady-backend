import type { AuditReadService } from '../../../../src/common/audit/audit-read.service';
import { money } from '../../../../src/common/money/money';
import { AdminBookingsService } from '../../../../src/modules/bookings/admin-bookings.service';
import type { BookingViews } from '../../../../src/modules/bookings/booking-views.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import type { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import type { StaffRefsService } from '../../../../src/modules/bookings/staff-refs.service';
import type { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { PaymentsService } from '../../../../src/modules/payments/payments.service';
import { confirmedRow, ledgerEntry } from '../../../support/booking-rows-admin';
import { TestClock } from '../../../support/clock';

/** 01:30 Cairo time on Sunday 11 October 2026: still the cinema day of Saturday the 10th. */
const NOW = new Date('2026-10-11T01:30:00+03:00');

describe('AdminBookingsService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn((..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    });
  let bookings: Record<
    | 'pageForAdmin'
    | 'countForAdmin'
    | 'countPaidCreatedBetween'
    | 'refundedIdsBetween'
    | 'findByReference',
    jest.Mock
  >;
  let payments: Record<'moneyMovedBetween' | 'refundTotalOf' | 'ledgerOf', jest.Mock>;
  let views: { ofMany: jest.Mock; of: jest.Mock };
  let settlement: { settleAllDue: jest.Mock };
  let service: AdminBookingsService;

  const booking = (status: string, startsAt: Date) => ({
    id: 100,
    status,
    showtime: { startsAt },
  });

  beforeEach(() => {
    calls.length = 0;
    bookings = {
      pageForAdmin: logged('page', [confirmedRow()]),
      countForAdmin: logged('count', 1),
      countPaidCreatedBetween: logged('today', 4),
      refundedIdsBetween: logged('refunded', [100, 101]),
      findByReference: logged('find', confirmedRow({ created_by_staff_id: 4 })),
    };
    payments = {
      moneyMovedBetween: logged('moved', { collected: money(61000), declinedCount: 1 }),
      refundTotalOf: logged('refund total', money(30000)),
      ledgerOf: logged('ledger', [ledgerEntry({ refundable: money(30000) })]),
    };
    views = {
      ofMany: logged('views', [booking('confirmed', new Date('2026-10-11T19:30:00+03:00'))]),
      of: logged('view', booking('confirmed', new Date('2026-10-11T19:30:00+03:00'))),
    };
    settlement = { settleAllDue: logged('settle', undefined) };
    service = new AdminBookingsService(
      bookings as unknown as BookingsRepository,
      views as unknown as BookingViews,
      payments as unknown as PaymentsService,
      {
        findById: logged('customer', {
          id: 42,
          fullName: 'Nadia',
          email: null,
          phone: null,
          status: 'active',
          deletedAt: null,
        }),
      } as unknown as CustomerService,
      {
        refsOf: logged('staff', new Map([[4, { id: 4, fullName: 'Hany Adel' }]])),
      } as unknown as StaffRefsService,
      { bookingActivity: logged('activity', []) } as unknown as AuditReadService,
      settlement as unknown as SettlementService,
      new TestClock(NOW),
    );
  });

  it('settles due payments first, then reads one page and its total', async () => {
    const page = await service.list({ status: 'confirmed' }, { limit: 20 });
    expect(calls).toEqual(['settle', 'page', 'count', 'views']);
    expect(bookings.pageForAdmin).toHaveBeenCalledWith({ status: 'confirmed' }, NOW, {
      after: null,
      limit: 20,
    });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      contact: { name: 'Nadia Farouk', email: 'nadia@example.com', phone: '+201012345678' },
      checkedInAt: null,
    });
  });

  it('refuses a date range that ends before it starts, before settling anything', async () => {
    await expect(
      service.list({ dateFrom: '2026-10-12', dateTo: '2026-10-11' }, {}),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toEqual([]);
  });

  it('counts today as the cinema day containing now, and the 7 days before now', async () => {
    const summary = await service.summary();
    expect(summary).toEqual({
      cinemaDate: '2026-10-10',
      serverTime: NOW,
      todayBookings: 4,
      collectedToday: money(61000),
      failedPaymentsToday: 1,
      refundedLast7Days: { bookingCount: 2, amount: money(30000) },
    });
    const today = {
      from: new Date('2026-10-10T06:00:00+03:00'),
      to: new Date('2026-10-11T06:00:00+03:00'),
    };
    expect(bookings.countPaidCreatedBetween).toHaveBeenCalledWith(today);
    expect(payments.moneyMovedBetween).toHaveBeenCalledWith(today);
    expect(bookings.refundedIdsBetween).toHaveBeenCalledWith({
      from: new Date('2026-10-04T01:30:00+03:00'),
      to: NOW,
    });
    expect(payments.refundTotalOf).toHaveBeenCalledWith([100, 101], 'cancellation');
    expect(calls[0]).toBe('settle');
  });

  it('decides what can be done with a booking now', async () => {
    const detail = await service.detail('MQ-7K3P9Q');
    expect(detail).toMatchObject({
      soldBy: { id: 4, fullName: 'Hany Adel' },
      refundable: money(30000),
      actions: { refund: true, edit: true, resendTickets: true },
      customer: { id: 42, anonymised: false },
    });

    bookings.findByReference = logged(
      'find',
      confirmedRow({ checked_in_at: NOW, contact_email: null, contact_phone: null }),
    );
    const scanned = await service.detail('MQ-7K3P9Q');
    expect(scanned.actions).toEqual({ refund: true, edit: false, resendTickets: false });

    views.of = logged('view', booking('completed', new Date('2026-10-10T19:30:00+03:00')));
    const completed = await service.detail('MQ-7K3P9Q');
    expect(completed.actions).toEqual({ refund: false, edit: false, resendTickets: false });

    bookings.findByReference = logged('find', undefined);
    await expect(service.detail('MQ-ZZZZZZ')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
