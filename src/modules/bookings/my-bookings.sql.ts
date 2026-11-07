import { bookingStatusPredicate } from './booking-status.sql';
import type { MyBookingsTab, SqlPredicate, StatusAliases } from './types';

/**
 * The SQL condition of a My Bookings tab (PRD C10, design §7.4) at `now`, built from the one
 * owner of the status predicates, `booking-status.sql.ts`:
 *
 * - `upcoming`: Confirmed, the showtime's `ends_at` after `now`;
 * - `past`: Completed, Refunded or Failed.
 *
 * A live hold and an Abandoned one match neither. The split is by the showtime's end, an
 * instant, never by the cinema date. Aliases are code constants, never input.
 */
export function tabPredicate(tab: MyBookingsTab, aliases: StatusAliases, now: Date): SqlPredicate {
  if (tab === 'upcoming') return bookingStatusPredicate('confirmed', aliases, now);
  const parts = (['completed', 'refunded', 'failed'] as const).map((status) =>
    bookingStatusPredicate(status, aliases, now),
  );
  return {
    sql: `(${parts.map((part) => part.sql).join(' OR ')})`,
    bindings: parts.flatMap((part) => part.bindings),
  };
}
