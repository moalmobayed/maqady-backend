import { cinemaDayBounds } from '../../common/time/time';
import { bookingStatusPredicate } from './booking-status.sql';
import { LOCAL_MOBILE_PATTERN, REFERENCE_PATTERN } from './bookings.constants';
import type {
  AdminBookingFilter,
  AdminBookingSearch,
  AdminSqlCondition,
  StatusAliases,
} from './types';

/** The admin list joins each booking (`b`) to its showtime (`s`) (design §5: bookings' own joins). */
export const ADMIN_LIST_ALIASES: StatusAliases = { booking: 'b', showtime: 's' };

/**
 * What a search string looks for (PRD A6 "Search by reference, name, email or phone"): a booking
 * reference in any case and with spaces around it is matched exactly; anything else is a
 * case-insensitive substring of the booking's contact name, email or phone. An Egyptian mobile
 * typed locally (`01012345678`) also matches its stored E.164 form (`+201012345678`).
 */
export function adminSearchOf(q: string): AdminBookingSearch {
  const trimmed = q.trim();
  const reference = trimmed.toUpperCase();
  if (REFERENCE_PATTERN.test(reference)) return { kind: 'reference', reference };
  const local = LOCAL_MOBILE_PATTERN.exec(trimmed);
  return {
    kind: 'contact',
    pattern: containsPattern(trimmed),
    phonePattern: local ? containsPattern(`+20${local[1]}`) : null,
  };
}

/**
 * A `LIKE` pattern matching `text` anywhere: `%`, `_` and the escape character `\` in the text
 * are escaped, so a search for `50%` finds "50%", never everything.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * The conditions of `GET /admin/bookings` at `now`, ANDed by the repository, on `bookings b`
 * joined to `showtimes s`. Every value is bound; aliases and column names are code constants.
 * The status is decided by `bookingStatusPredicate()`, the one owner of the clock-derived
 * statuses (design §7.4). The date range is cinema days of the booking's creation (06:00 to
 * 06:00 Cairo time, design §8).
 */
export function adminBookingConditions(filter: AdminBookingFilter, now: Date): AdminSqlCondition[] {
  const conditions: AdminSqlCondition[] = [];
  if (filter.q !== undefined) {
    const search = adminSearchOf(filter.q);
    if (search.kind === 'reference') {
      conditions.push({ sql: 'b.reference = ?', bindings: [search.reference] });
    } else {
      const phone = search.phonePattern === null ? '' : ' OR b.contact_phone ILIKE ?';
      conditions.push({
        sql: `(b.contact_name ILIKE ? OR b.contact_email::text ILIKE ? OR b.contact_phone ILIKE ?${phone})`,
        bindings: [
          search.pattern,
          search.pattern,
          search.pattern,
          ...(search.phonePattern === null ? [] : [search.phonePattern]),
        ],
      });
    }
  }
  if (filter.theaterId !== undefined) {
    conditions.push({ sql: 's.theater_id = ?', bindings: [filter.theaterId] });
  }
  if (filter.movieId !== undefined) {
    conditions.push({ sql: 's.movie_id = ?', bindings: [filter.movieId] });
  }
  if (filter.status !== undefined) {
    const predicate = bookingStatusPredicate(filter.status, ADMIN_LIST_ALIASES, now);
    conditions.push({ sql: predicate.sql, bindings: predicate.bindings });
  }
  if (filter.channel !== undefined) {
    conditions.push({ sql: 'b.channel = ?', bindings: [filter.channel] });
  }
  if (filter.method !== undefined) {
    // A sale charge of the method, any result (idx_payments_booking_id_created_at).
    conditions.push({
      sql: `EXISTS (SELECT 1 FROM payments AS p WHERE p.booking_id = b.id AND p.kind = 'charge' AND p.purpose = 'sale' AND p.method = ?)`,
      bindings: [filter.method],
    });
  }
  if (filter.dateFrom !== undefined) {
    conditions.push({
      sql: 'b.created_at >= ?',
      bindings: [cinemaDayBounds(filter.dateFrom).startsAt],
    });
  }
  if (filter.dateTo !== undefined) {
    conditions.push({ sql: 'b.created_at < ?', bindings: [cinemaDayBounds(filter.dateTo).endsAt] });
  }
  if (filter.customerId !== undefined) {
    // idx_bookings_customer_id_status_hold_expires_at (U15: a customer's bookings).
    conditions.push({ sql: 'b.customer_id = ?', bindings: [filter.customerId] });
  }
  return conditions;
}
