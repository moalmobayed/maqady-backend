import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionContext } from '../../../../src/common/database/transaction-context';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { money } from '../../../../src/common/money/money';
import type { BookingConfirmationService } from '../../../../src/modules/bookings/booking-confirmation.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import type { BookingRow } from '../../../../src/modules/bookings/types';
import type { PaymentProvider } from '../../../../src/modules/payments/payment-provider';
import type { PaymentsService } from '../../../../src/modules/payments/payments.service';
import type { Payment } from '../../../../src/modules/payments/types';
import type { SeatClaimService } from '../../../../src/modules/seating/seat-claim.service';
import type { SeatEventPublisher } from '../../../../src/modules/seating/seat-event.publisher';
import type { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T19:00:10+03:00');

function row(id: number, overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id,
    reference: `MQ-AAAAA${id}`,
    showtime_id: 81,
    status: 'held',
    channel: 'online',
    customer_id: id + 10,
    created_by_staff_id: null,
    hold_token_hash: null,
    hold_expires_at: new Date(NOW.getTime() + 30_000),
    has_declined_payment: false,
    seat_count: 1,
    total_amount: 19000,
    currency: 'EGP',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    confirmed_at: null,
    refunded_at: null,
    qr_version: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function finished(id: number, bookingId: number, status: Payment['status']): Payment {
  return {
    id,
    bookingId,
    kind: 'charge',
    purpose: 'sale',
    method: 'card',
    status,
    amount: money(19000),
    refundOfPaymentId: null,
    providerReference: `sim.sim_card_slow.1.${id}`,
    card: { brand: 'visa', last4: '3184' },
    walletType: null,
    settlesAt: NOW,
    completedAt: NOW,
    createdAt: NOW,
  };
}

const result = (status: string) => ({
  status,
  providerReference: 'x',
  settlesAt: NOW,
  card: null,
  walletType: null,
});

describe('SettlementService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });

  let active: boolean;
  let bookings: Record<
    'findByIds' | 'lockForUpdate' | 'seatsOf' | 'markDeclined' | 'markRefunded',
    jest.Mock
  >;
  let payments: Record<'due' | 'finishProcessing' | 'refundOnline', jest.Mock>;
  let provider: { retrieve: jest.Mock };
  let showtimes: { lockForShareMany: jest.Mock };
  let seatClaims: { lockFor: jest.Mock; deleteOwn: jest.Mock };
  let confirmation: { confirm: jest.Mock };
  let events: { publishAfterCommit: jest.Mock };
  let audit: { recordMany: jest.Mock };
  let transactions: { run: jest.Mock };
  let service: SettlementService;

  const rows = [row(1), row(2, { customer_id: 99, showtime_id: 82 })];

  beforeEach(() => {
    calls.length = 0;
    active = false;
    bookings = {
      findByIds: logged('find bookings', rows),
      lockForUpdate: logged('lock bookings', rows),
      seatsOf: logged('seats', [
        { booking_id: 1, seat_label: 'F7' },
        { booking_id: 2, seat_label: 'A1' },
      ]),
      markDeclined: logged('mark declined', undefined),
      markRefunded: logged('mark refunded', undefined),
    };
    payments = {
      due: logged('due', [
        { paymentId: 11, bookingId: 1, providerReference: 'sim.a' },
        { paymentId: 12, bookingId: 2, providerReference: 'sim.b' },
      ]),
      finishProcessing: logged('finish', [
        finished(11, 1, 'succeeded'),
        finished(12, 2, 'declined'),
      ]),
      refundOnline: logged('refund', []),
    };
    provider = {
      retrieve: jest.fn(() => {
        calls.push('retrieve');
        return Promise.resolve(result('succeeded'));
      }),
    };
    showtimes = {
      lockForShareMany: logged(
        'lock showtimes',
        new Map([
          [81, { id: 81, status: 'scheduled' }],
          [82, { id: 82, status: 'scheduled' }],
        ]),
      ),
    };
    seatClaims = {
      lockFor: logged('lock claims', [
        { showtime_id: 81, seat_label: 'F7', booking_id: 1, claimed_until: NOW },
        { showtime_id: 82, seat_label: 'A1', booking_id: 2, claimed_until: NOW },
      ]),
      deleteOwn: logged('delete claims', [{ showtimeId: 81, labels: ['F7'] }]),
    };
    confirmation = { confirm: logged('confirm', undefined) };
    events = { publishAfterCommit: logged('publish', undefined) };
    audit = { recordMany: logged('audit', undefined) };
    transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => {
        calls.push('begin');
        return fn();
      }),
    };
    service = new SettlementService(
      bookings as unknown as BookingsRepository,
      payments as unknown as PaymentsService,
      provider as unknown as PaymentProvider,
      showtimes as unknown as ShowtimeReadService,
      seatClaims as unknown as SeatClaimService,
      confirmation as unknown as BookingConfirmationService,
      events as unknown as SeatEventPublisher,
      audit as unknown as AuditService,
      transactions as unknown as TransactionRepository,
      { isActive: () => active } as unknown as TransactionContext,
      new TestClock(NOW),
    );
  });

  it('opens no transaction when nothing is due', async () => {
    payments.due.mockResolvedValue([]);
    expect(await service.settleDue({ bookingReference: 'MQ-AAAAA1' })).toEqual({
      confirmed: 0,
      declined: 0,
      refunded: 0,
    });
    expect(payments.due).toHaveBeenCalledWith(100);
    expect(bookings.findByIds).not.toHaveBeenCalled();
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it('opens no transaction when nothing due is in scope', async () => {
    expect(await service.settleDue({ bookingReference: 'MQ-ZZZZZZ' })).toEqual({
      confirmed: 0,
      declined: 0,
      refunded: 0,
    });
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it('refuses to run inside a transaction, or without a scope (INTERNAL)', async () => {
    active = true;
    await expect(service.settleDue({ showtimeId: 81 })).rejects.toMatchObject({ code: 'INTERNAL' });
    active = false;
    await expect(service.settleDue({})).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(payments.due).not.toHaveBeenCalled();
  });

  it('locks showtimes, bookings and claims in order, then finishes, confirms, declines and audits', async () => {
    const outcome = await service.settleAllDue();
    expect(calls).toEqual([
      'due',
      'find bookings',
      'begin',
      'lock showtimes',
      'lock bookings',
      'seats',
      'lock claims',
      'retrieve',
      'retrieve',
      'finish',
      'confirm',
      'mark declined',
      'audit',
    ]);
    expect(showtimes.lockForShareMany).toHaveBeenCalledWith([81, 82]);
    expect(bookings.lockForUpdate).toHaveBeenCalledWith([1, 2]);
    expect(confirmation.confirm).toHaveBeenCalledWith(
      [{ bookingId: 1, showtimeId: 81, channel: 'online', labels: ['F7'] }],
      { kind: 'system' },
    );
    expect(bookings.markDeclined).toHaveBeenCalledWith([2], NOW);
    expect(audit.recordMany).toHaveBeenCalledWith([
      expect.objectContaining({
        action: 'payment.succeeded',
        bookingId: 1,
        actor: { kind: 'system' },
      }),
      expect.objectContaining({ action: 'payment.declined', bookingId: 2 }),
    ]);
    expect(outcome).toEqual({ confirmed: 1, declined: 1, refunded: 0 });
  });

  it('settles only what is in scope: the booking, the showtime or the customer', async () => {
    await service.settleDue({ customerId: 99 });
    expect(bookings.lockForUpdate).toHaveBeenCalledWith([2]);
    expect(showtimes.lockForShareMany).toHaveBeenCalledWith([82]);
    bookings.lockForUpdate.mockClear();
    await service.settleDue({ showtimeId: 81 });
    expect(bookings.lockForUpdate).toHaveBeenCalledWith([1]);
  });

  it('applies only the charges the conditional update won', async () => {
    payments.finishProcessing.mockResolvedValue([]);
    expect(await service.settleAllDue()).toEqual({ confirmed: 0, declined: 0, refunded: 0 });
    expect(confirmation.confirm).not.toHaveBeenCalled();
    expect(bookings.markDeclined).not.toHaveBeenCalled();
    expect(audit.recordMany).not.toHaveBeenCalled();
  });

  it('passes on results that are still processing, which then stay processing', async () => {
    provider.retrieve.mockResolvedValue(result('processing'));
    await service.settleAllDue();
    expect(payments.finishProcessing).toHaveBeenCalledWith([
      { paymentId: 11, result: result('processing') },
      { paymentId: 12, result: result('processing') },
    ]);
  });

  it('refunds a success at once when a claim was lost, or when the showtime was cancelled', async () => {
    seatClaims.lockFor.mockResolvedValue([
      { showtime_id: 81, seat_label: 'F7', booking_id: 5, claimed_until: NOW },
    ]);
    showtimes.lockForShareMany.mockResolvedValue(
      new Map([
        [81, { id: 81, status: 'scheduled' }],
        [82, { id: 82, status: 'cancelled' }],
      ]),
    );
    payments.finishProcessing.mockResolvedValue([
      finished(11, 1, 'succeeded'),
      finished(12, 2, 'succeeded'),
    ]);
    payments.refundOnline.mockResolvedValue([
      { ...finished(21, 1, 'succeeded'), kind: 'refund', purpose: 'cancellation' },
      { ...finished(22, 2, 'succeeded'), kind: 'refund', purpose: 'cancellation' },
    ]);

    const outcome = await service.settleAllDue();

    expect(confirmation.confirm).toHaveBeenCalledWith([], { kind: 'system' });
    expect(payments.refundOnline).toHaveBeenCalledWith([
      { charge: expect.objectContaining({ id: 11 }), reference: 'MQ-AAAAA1' },
      { charge: expect.objectContaining({ id: 12 }), reference: 'MQ-AAAAA2' },
    ]);
    expect(bookings.markRefunded).toHaveBeenCalledWith([1, 2], NOW);
    expect(seatClaims.deleteOwn).toHaveBeenCalledWith([
      { showtimeId: 81, bookingId: 1, labels: ['F7'] },
      { showtimeId: 82, bookingId: 2, labels: ['A1'] },
    ]);
    expect(events.publishAfterCommit).toHaveBeenCalledWith({
      type: 'seat.released',
      showtimeId: 81,
      labels: ['F7'],
    });
    const refundAudit = audit.recordMany.mock.calls[0]![0] as {
      action: string;
      metadata: object;
    }[];
    expect(refundAudit.map((event) => [event.action, event.metadata])).toEqual([
      ['payment.refunded', { method: 'card', purpose: 'cancellation' }],
      ['payment.refunded', { method: 'card', purpose: 'cancellation' }],
      ['booking.refunded', { showtimeId: 81, reason: 'claims_lost', seatCount: 1 }],
      ['booking.refunded', { showtimeId: 82, reason: 'showtime_cancelled', seatCount: 1 }],
    ]);
    expect(outcome).toEqual({ confirmed: 0, declined: 0, refunded: 2 });
  });
});
