import type { BookabilityInput, NotBookableReason } from './types';

/**
 * Why a showtime cannot be held at `now`, or null when it can (design §7.3 steps 2–3; PRD
 * Seats 6). The first reason that applies wins: cancelled, started (a hold never outlives the
 * start), sales paused by the theater, a movie that is no longer Now showing, a hall that is not
 * active.
 */
export function notBookableReason(input: BookabilityInput, now: Date): NotBookableReason | null {
  if (input.showtimeStatus === 'cancelled') return 'cancelled';
  if (input.startsAt.getTime() <= now.getTime()) return 'started';
  if (input.theaterStatus !== 'active') return 'sales_paused';
  if (input.movieStatus !== 'now_showing') return 'movie_unavailable';
  if (input.hallStatus !== 'active') return 'hall_unavailable';
  return null;
}
