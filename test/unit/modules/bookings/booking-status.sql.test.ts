import {
  paymentStatusOf,
  bookingStatusOf,
  bookingStatusPredicate,
  isLiveHold,
} from '../../../../src/modules/bookings/booking-status.sql';
import type { BookingStatusInput } from '../../../../src/modules/bookings/types';

const NOW = new Date('2026-10-16T19:00:00+03:00');
const at = (ms: number): Date => new Date(NOW.getTime() + ms);

function input(overrides: Partial<BookingStatusInput>): BookingStatusInput {
  return {
    status: 'held',
    holdExpiresAt: at(60_000),
    hasDeclinedPayment: false,
    showtimeEndsAt: at(3_600_000),
    ...overrides,
  };
}

describe('booking statuses decided by the clock (design 7.4)', () => {
  it.each([
    [1, false, 'held'],
    [0, false, 'abandoned'],
    [-1, false, 'abandoned'],
    [1, true, 'held'],
    [0, true, 'failed'],
    [-1, true, 'failed'],
  ] as const)(
    'a hold ending at now %+d ms (declined: %s) reads %s',
    (offset, declined, expected) => {
      expect(
        bookingStatusOf(input({ holdExpiresAt: at(offset), hasDeclinedPayment: declined }), NOW),
      ).toBe(expected);
      expect(isLiveHold({ status: 'held', holdExpiresAt: at(offset) }, NOW)).toBe(
        expected === 'held',
      );
    },
  );

  it.each([
    [1, 'confirmed'],
    [0, 'completed'],
    [-1, 'completed'],
  ] as const)(
    'a confirmed booking whose showtime ends at now %+d ms reads %s',
    (offset, expected) => {
      expect(
        bookingStatusOf(
          input({ status: 'confirmed', showtimeEndsAt: at(offset), holdExpiresAt: at(-9) }),
          NOW,
        ),
      ).toBe(expected);
    },
  );

  it('a refunded booking reads refunded, whatever the times; only a held row is ever live', () => {
    expect(bookingStatusOf(input({ status: 'refunded', showtimeEndsAt: at(1) }), NOW)).toBe(
      'refunded',
    );
    expect(isLiveHold({ status: 'confirmed', holdExpiresAt: at(60_000) }, NOW)).toBe(false);
  });

  it('gives the same conditions as SQL with now bound', () => {
    const aliases = { booking: 'b', showtime: 's' };
    expect(bookingStatusPredicate('held', aliases, NOW)).toEqual({
      sql: "(b.status = 'held' AND b.hold_expires_at > ?)",
      bindings: [NOW],
    });
    expect(bookingStatusPredicate('failed', aliases, NOW).sql).toBe(
      "(b.status = 'held' AND b.hold_expires_at <= ? AND b.has_declined_payment)",
    );
    expect(bookingStatusPredicate('abandoned', aliases, NOW).sql).toBe(
      "(b.status = 'held' AND b.hold_expires_at <= ? AND NOT b.has_declined_payment)",
    );
    expect(bookingStatusPredicate('confirmed', aliases, NOW)).toEqual({
      sql: "(b.status = 'confirmed' AND s.ends_at > ?)",
      bindings: [NOW],
    });
    expect(bookingStatusPredicate('completed', aliases, NOW).sql).toBe(
      "(b.status = 'confirmed' AND s.ends_at <= ?)",
    );
    expect(bookingStatusPredicate('refunded', aliases, NOW)).toEqual({
      sql: "(b.status = 'refunded')",
      bindings: [],
    });
  });
});

describe('the booking payment status (design 7.4; PRD "Statuses")', () => {
  it.each([
    ['refunded', false, 'succeeded', 'refunded'],
    ['confirmed', false, 'succeeded', 'paid'],
    ['confirmed', true, 'succeeded', 'paid'],
    ['held', false, null, 'unpaid'],
    ['held', false, 'cancelled', 'unpaid'],
    ['held', false, 'processing', 'processing'],
    ['held', true, 'processing', 'processing'],
    ['held', true, 'declined', 'declined'],
    ['held', true, 'cancelled', 'declined'],
  ] as const)(
    'a %s booking (declined before: %s, latest charge %s) is %s',
    (status, hasDeclinedPayment, latestSaleStatus, expected) => {
      expect(paymentStatusOf({ status, hasDeclinedPayment, latestSaleStatus })).toBe(expected);
    },
  );
});
