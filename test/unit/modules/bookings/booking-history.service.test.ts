import type { AuditReadService } from '../../../../src/common/audit/audit-read.service';
import { resolveException } from '../../../../src/common/errors/error-mapping';
import { encodeCursor } from '../../../../src/common/pagination/cursor';
import {
  BookingHistoryService,
  historyFilterOf,
} from '../../../../src/modules/bookings/booking-history.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { bookingRow } from '../../../support/booking-rows';

const HELD = new Date('2026-10-15T11:00:00.000Z');
const PAID = new Date('2026-10-15T11:02:00.000Z');
const REFUNDED = new Date('2026-10-15T12:00:00.000Z');
const BOOKING_ACTIONS = [
  'booking.held',
  'payment.succeeded',
  'booking.refunded',
  'booking.edited',
  'booking.tickets_resent',
];

describe('BookingHistoryService', () => {
  let bookings: { findByReference: jest.Mock };
  let audit: { bookingEvents: jest.Mock };
  let service: BookingHistoryService;

  beforeEach(() => {
    bookings = { findByReference: jest.fn().mockResolvedValue(bookingRow({ confirmed_at: PAID })) };
    audit = { bookingEvents: jest.fn().mockResolvedValue({ rows: [], total: 0 }) };
    service = new BookingHistoryService(
      bookings as unknown as BookingsRepository,
      audit as unknown as AuditReadService,
    );
  });

  it.each([
    ['an unknown reference', undefined],
    ["another customer's booking", bookingRow({ customer_id: 99 })],
    ["a guest's hold", bookingRow({ customer_id: null, status: 'held', confirmed_at: null })],
  ])('answers NOT_FOUND for %s without reading the audit log', async (_, found) => {
    bookings.findByReference.mockResolvedValue(found);
    const caught = await service.list('MQ-7K3P9Q', 12, {}).catch((e: unknown) => e);
    expect(resolveException(caught)).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(audit.bookingEvents).not.toHaveBeenCalled();
  });

  it('reads the moves of the showtime from the confirmation for a confirmed booking', () => {
    expect(historyFilterOf(bookingRow({ confirmed_at: PAID }))).toEqual({
      bookingId: 100,
      bookingActions: BOOKING_ACTIONS,
      showtime: { id: 81, actions: ['showtime.moved'], from: PAID, until: null },
    });
  });

  it('stops reading the moves at the refund of a refunded booking', () => {
    expect(
      historyFilterOf(bookingRow({ status: 'refunded', confirmed_at: PAID, refunded_at: REFUNDED }))
        .showtime,
    ).toEqual({ id: 81, actions: ['showtime.moved'], from: PAID, until: REFUNDED });
  });

  it('reads no moves of the showtime for a booking never confirmed', () => {
    expect(
      historyFilterOf(bookingRow({ status: 'held', confirmed_at: null, qr_version: null }))
        .showtime,
    ).toBeNull();
  });

  it('maps the events oldest first and pages by (occurredAt, id) with milliseconds', async () => {
    audit.bookingEvents.mockResolvedValue({
      rows: [
        { id: 1, occurredAt: HELD, action: 'booking.held' },
        { id: 4, occurredAt: PAID, action: 'payment.succeeded' },
        { id: 9, occurredAt: REFUNDED, action: 'showtime.moved' },
      ],
      total: 3,
    });

    const page = await service.list('MQ-7K3P9Q', 12, { limit: 2 });

    expect(audit.bookingEvents).toHaveBeenCalledWith(
      historyFilterOf(bookingRow({ confirmed_at: PAID })),
      {
        after: null,
        limit: 2,
      },
    );
    expect(page).toEqual({
      items: [
        { kind: 'seats_held', label: 'Seats held', occurredAt: HELD },
        { kind: 'payment_received', label: 'Payment received', occurredAt: PAID },
      ],
      nextCursor: encodeCursor({ sortKey: '2026-10-15T11:02:00.000Z', id: 4 }),
      total: 3,
    });
  });

  it('refuses a cursor that is not an instant before reading the booking', async () => {
    const caught = await service
      .list('MQ-7K3P9Q', 12, { cursor: encodeCursor({ sortKey: null, id: 2 }) })
      .catch((e: unknown) => e);
    expect(resolveException(caught)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(bookings.findByReference).not.toHaveBeenCalled();
  });

  it("reads any booking's History for staff with ofBooking()", async () => {
    await service.ofBooking(bookingRow({ customer_id: null }), {});
    expect(audit.bookingEvents).toHaveBeenCalledTimes(1);
  });
});
