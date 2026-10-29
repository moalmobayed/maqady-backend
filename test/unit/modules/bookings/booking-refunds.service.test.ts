import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionContext } from '../../../../src/common/database/transaction-context';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { money } from '../../../../src/common/money/money';
import type { BookingReadService } from '../../../../src/modules/bookings/booking-read.service';
import { BookingRefundsService } from '../../../../src/modules/bookings/booking-refunds.service';
import type { BookingShowtimeService } from '../../../../src/modules/bookings/booking-showtime.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import type { StaffRefsService } from '../../../../src/modules/bookings/staff-refs.service';
import type { MessagingService } from '../../../../src/modules/messaging/messaging.service';
import type { PaymentsService } from '../../../../src/modules/payments/payments.service';
import type { SeatClaimService } from '../../../../src/modules/seating/seat-claim.service';
import type { SeatEventPublisher } from '../../../../src/modules/seating/seat-event.publisher';
import type { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import { ADMIN_NOW, confirmedRow, ledgerEntry } from '../../../support/booking-rows-admin';
import { TestClock } from '../../../support/clock';

const STAFF = { kind: 'staff', id: 3, sessionId: 30, role: 'admin' } as const;
const ENDS_LATER = new Date('2026-10-11T19:00:00Z');

describe('BookingRefundsService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });

  let bookings: Record<'findByReference' | 'lockForUpdate' | 'seatsOf' | 'markRefunded', jest.Mock>;
  let showtimes: { findByIds: jest.Mock };
  let headers: { headersOf: jest.Mock };
  let payments: Record<'ledgerOf' | 'refund' | 'findLedgerEntry' | 'markPaidOut', jest.Mock>;
  let seatClaims: { lockFor: jest.Mock; deleteOwn: jest.Mock };
  let events: { publishAfterCommit: jest.Mock };
  let messaging: { queueMany: jest.Mock };
  let audit: { record: jest.Mock; recordMany: jest.Mock };
  let staffRefs: { ledgerWithStaff: jest.Mock };
  let active: boolean;
  let service: BookingRefundsService;

  const cashCharge = ledgerEntry({
    id: 8,
    method: 'cash',
    purpose: 'edit_difference',
    providerReference: null,
    card: null,
    amount: money(8000),
    refundable: money(8000),
    collectedByStaffId: 5,
    createdAt: new Date(ADMIN_NOW.getTime() + 60_000),
  });

  beforeEach(() => {
    calls.length = 0;
    active = true;
    bookings = {
      findByReference: logged('find', confirmedRow()),
      lockForUpdate: logged('lock booking', [confirmedRow()]),
      seatsOf: logged('seats', [
        { booking_id: 100, seat_label: 'B2' },
        { booking_id: 100, seat_label: 'B3' },
      ]),
      markRefunded: logged('mark refunded', undefined),
    };
    showtimes = {
      findByIds: logged('showtime', new Map([[81, { id: 81, endsAt: ENDS_LATER }]])),
    };
    headers = {
      headersOf: logged(
        'headers',
        new Map([
          [
            81,
            {
              startsAt: ENDS_LATER,
              movie: { title: 'The Nile Light' },
              theater: { name: 'Maqady Zamalek' },
              hall: { name: 'Hall 3' },
            },
          ],
        ]),
      ),
    };
    payments = {
      ledgerOf: logged('ledger', [ledgerEntry({ refundable: money(30000) }), cashCharge]),
      refund: jest.fn((items: { charge: { id: number; method: string }; amount: unknown }[]) => {
        calls.push('refund');
        return Promise.resolve(
          items.map((item, index) =>
            ledgerEntry({
              id: 50 + index,
              kind: 'refund',
              purpose: 'cancellation',
              method: item.charge.method as 'card',
              status: item.charge.method === 'card' ? 'succeeded' : 'pending',
              amount: item.amount as ReturnType<typeof money>,
              refundOfPaymentId: item.charge.id,
              refundable: null,
            }),
          ),
        );
      }),
      findLedgerEntry: logged('find payment', undefined),
      markPaidOut: logged('pay out', null),
    };
    seatClaims = {
      lockFor: logged('lock claims', []),
      deleteOwn: logged('delete claims', [{ showtimeId: 81, labels: ['B2', 'B3'] }]),
    };
    events = { publishAfterCommit: logged('publish', undefined) };
    messaging = { queueMany: logged('queue', []) };
    audit = { record: logged('audit', undefined), recordMany: logged('audit', undefined) };
    staffRefs = {
      ledgerWithStaff: jest.fn((entries: unknown[]) =>
        Promise.resolve(entries.map((entry) => ({ entry, collectedBy: null, paidOutBy: null }))),
      ),
    };
    service = new BookingRefundsService(
      bookings as unknown as BookingsRepository,
      { getForStaff: logged('read', { reference: 'MQ-7K3P9Q' }) } as unknown as BookingReadService,
      showtimes as unknown as ShowtimeReadService,
      headers as unknown as BookingShowtimeService,
      payments as unknown as PaymentsService,
      seatClaims as unknown as SeatClaimService,
      events as unknown as SeatEventPublisher,
      messaging as unknown as MessagingService,
      staffRefs as unknown as StaffRefsService,
      audit as unknown as AuditService,
      { run: <T>(work: () => Promise<T>) => work() } as unknown as TransactionRepository,
      { isActive: () => active } as unknown as TransactionContext,
      new TestClock(ADMIN_NOW),
    );
  });

  describe('cancelAndRefund', () => {
    it('locks the booking, then its claims, then refunds what is left of every charge', async () => {
      const result = await service.cancelAndRefund(STAFF, 'MQ-7K3P9Q');

      expect(calls).toEqual([
        'find',
        'lock booking',
        'showtime',
        'seats',
        'lock claims',
        'ledger',
        'refund',
        'mark refunded',
        'delete claims',
        'audit',
        'headers',
        'queue',
        'publish',
        'read',
      ]);
      expect(seatClaims.lockFor).toHaveBeenCalledWith([
        { showtimeId: 81, bookingId: 100, labels: ['B2', 'B3'] },
      ]);
      // Newest first: the cash difference, then the card charge's remainder.
      expect(payments.refund).toHaveBeenCalledWith(
        [
          { charge: cashCharge, amount: money(8000), reference: 'MQ-7K3P9Q' },
          {
            charge: expect.objectContaining({ id: 7 }),
            amount: money(30000),
            reference: 'MQ-7K3P9Q',
          },
        ],
        'cancellation',
      );
      expect(bookings.markRefunded).toHaveBeenCalledWith([100], ADMIN_NOW);
      expect(result.refunds).toHaveLength(2);
      const events = audit.recordMany.mock.calls[0]![0] as { action: string; metadata: object }[];
      expect(events.map((event) => event.action)).toEqual([
        'payment.refunded',
        'payment.refunded',
        'booking.refunded',
      ]);
      expect(events[2]!.metadata).toEqual({
        showtimeId: 81,
        reason: 'admin_cancel',
        seatCount: 2,
        amount: 38000,
      });
      const [inputs] = messaging.queueMany.mock.calls[0]! as [
        { recipient: string; params: Record<string, unknown> }[],
      ];
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toMatchObject({
        recipient: 'nadia@example.com',
        params: {
          reference: 'MQ-7K3P9Q',
          amount: 'EGP 380',
          onlineAmount: 'EGP 300',
          counterAmount: 'EGP 80',
          movieTitle: 'The Nile Light',
        },
      });
      expect(events.some((event) => JSON.stringify(event).includes('Nadia'))).toBe(false);
    });

    it.each([
      [
        'held',
        confirmedRow({
          status: 'held',
          confirmed_at: null,
          qr_version: null,
          hold_expires_at: ENDS_LATER,
        }),
      ],
      ['refunded', confirmedRow({ status: 'refunded', refunded_at: ADMIN_NOW })],
    ])('refuses a %s booking under its lock, writing nothing', async (status, row) => {
      bookings.lockForUpdate = logged('lock booking', [row]);
      await expect(service.cancelAndRefund(STAFF, 'MQ-7K3P9Q')).rejects.toMatchObject({
        code: 'BOOKING_NOT_REFUNDABLE',
        details: { status },
      });
      expect(payments.refund).not.toHaveBeenCalled();
      expect(bookings.markRefunded).not.toHaveBeenCalled();
    });

    it('refuses a completed booking: its showtime ended', async () => {
      showtimes.findByIds = logged('showtime', new Map([[81, { id: 81, endsAt: ADMIN_NOW }]]));
      await expect(service.cancelAndRefund(STAFF, 'MQ-7K3P9Q')).rejects.toMatchObject({
        code: 'BOOKING_NOT_REFUNDABLE',
        details: { status: 'completed' },
      });
    });

    it('answers NOT_FOUND for an unknown reference before any lock', async () => {
      bookings.findByReference = logged('find', undefined);
      await expect(service.cancelAndRefund(STAFF, 'MQ-ZZZZZZ')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(calls).toEqual(['find']);
    });
  });

  describe('refundLocked', () => {
    it('needs a transaction and confirmed rows', async () => {
      active = false;
      await expect(service.refundLocked([confirmedRow()], context())).rejects.toMatchObject({
        code: 'INTERNAL',
      });
      active = true;
      await expect(
        service.refundLocked([confirmedRow({ status: 'held' })], context()),
      ).rejects.toMatchObject({ code: 'INTERNAL' });
      expect(await service.refundLocked([], context())).toEqual([]);
    });

    it('sends no refund email when the caller sends its own notice, or without an email', async () => {
      await service.refundLocked([confirmedRow()], { ...context(), notify: false });
      await service.refundLocked([confirmedRow({ contact_email: null })], context());
      expect(messaging.queueMany).not.toHaveBeenCalled();
    });
  });

  describe('payOut', () => {
    const pending = ledgerEntry({
      id: 60,
      kind: 'refund',
      purpose: 'cancellation',
      method: 'cash',
      status: 'pending',
      providerReference: null,
      card: null,
      completedAt: null,
      refundOfPaymentId: 8,
      refundable: null,
    });

    it('locks the booking before the conditional payout, then audits it', async () => {
      payments.findLedgerEntry = logged('find payment', pending);
      payments.markPaidOut = logged('pay out', { ...pending, status: 'succeeded' });
      const entry = await service.payOut(STAFF, 60);
      expect(calls).toEqual(['find payment', 'lock booking', 'pay out', 'audit']);
      expect(bookings.lockForUpdate).toHaveBeenCalledWith([100]);
      expect(payments.markPaidOut).toHaveBeenCalledWith(60, 3);
      expect(entry.entry.status).toBe('succeeded');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payment.paid_out', bookingId: 100 }),
      );
    });

    it('refuses a refund that is no longer pending with its status', async () => {
      payments.findLedgerEntry = jest
        .fn()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce({ ...pending, status: 'succeeded' });
      await expect(service.payOut(STAFF, 60)).rejects.toMatchObject({
        code: 'REFUND_NOT_PENDING',
        details: { status: 'succeeded' },
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers NOT_FOUND for an unknown id or a charge, before any lock', async () => {
      payments.findLedgerEntry = logged('find payment', null);
      await expect(service.payOut(STAFF, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      payments.findLedgerEntry = logged('find payment', ledgerEntry());
      await expect(service.payOut(STAFF, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(bookings.lockForUpdate).not.toHaveBeenCalled();
    });
  });
});

function context() {
  return {
    actor: { kind: 'staff', id: 3 } as const,
    now: ADMIN_NOW,
    reason: 'admin_cancel' as const,
    notify: true,
  };
}
