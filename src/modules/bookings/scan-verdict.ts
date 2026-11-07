import { subtractFromInstant } from '../../common/time/time';
import { SCAN_OPENS_MINUTES_BEFORE_START } from './bookings.constants';
import type { ScanReason, ScanResult, ScanVerdict, ScanVerdictInput } from './types';

/**
 * What a ticket scan answers (design §7.9; PRD "Scan tickets", "Tickets and QR codes"), decided
 * from stored facts at `now`. The first rule that applies wins:
 *
 * 1. the showtime is in another theater → `WRONG_SHOWTIME other_theater`;
 * 2. the showtime was cancelled → `WRONG_SHOWTIME cancelled`;
 * 3. the booking was never paid (a hold) → `NOT_VALID not_paid`;
 * 4. it was refunded → `NOT_VALID refunded`, even outside the window, so nobody is told to come
 *    back later with a refunded ticket;
 * 5. the QR code is of an older (or other) version than the booking's → `NOT_VALID replaced`;
 * 6. before the window opens, 60 minutes before the start → `WRONG_SHOWTIME not_open_yet`;
 * 7. from the showtime's end → `WRONG_SHOWTIME ended`;
 * 8. admitted before → `ALREADY_USED`;
 * 9. a typed reference without `confirm` → `CONFIRM_REQUIRED` (the reference alone admits nobody);
 * 10. otherwise the booking is admitted.
 *
 * The window opens at exactly `startsAt − 60 min` and closes at `endsAt` (exclusive).
 */
export function scanVerdict(input: ScanVerdictInput, now: Date): ScanVerdict {
  const { showtime, booking } = input;
  if (showtime.theaterId !== input.theaterId) return refuse('WRONG_SHOWTIME', 'other_theater');
  if (showtime.status === 'cancelled') return refuse('WRONG_SHOWTIME', 'cancelled');
  if (booking.status === 'held') return refuse('NOT_VALID', 'not_paid');
  if (booking.status === 'refunded') return refuse('NOT_VALID', 'refunded');
  if (input.presentedVersion !== null && input.presentedVersion !== booking.qrVersion) {
    return refuse('NOT_VALID', 'replaced');
  }
  const opensAt = subtractFromInstant(showtime.startsAt, {
    minutes: SCAN_OPENS_MINUTES_BEFORE_START,
  });
  if (now.getTime() < opensAt.getTime()) return refuse('WRONG_SHOWTIME', 'not_open_yet');
  if (now.getTime() >= showtime.endsAt.getTime()) return refuse('WRONG_SHOWTIME', 'ended');
  if (booking.checkedInAt !== null) return refuse('ALREADY_USED', null);
  if (input.via === 'reference' && !input.confirm) return refuse('CONFIRM_REQUIRED', null);
  return { admit: true };
}

function refuse(result: ScanResult, reason: ScanReason | null): ScanVerdict {
  return { admit: false, result, reason };
}
