import { SetMetadata } from '@nestjs/common';
import { SETTLE_FIRST_METADATA } from './settle-first.constants';
import type { SettleFirstKind, SettleFirstOptions, SettleFirstSource } from './types';

/**
 * Settles due payments before the route runs (design §7.1 step 1, §7.5), in their own short
 * transaction committed before the request's: those of the booking `{ref}` (`'booking'`) or of
 * bookings on the showtime `{id}` (`'showtime'`), and those of the calling customer's bookings;
 * `'customer'` settles only the calling customer's (My Bookings, U12).
 * With `source: 'body'` the showtime is the JSON body's `showtimeId` instead of the path's
 * (`POST /admin/counter-holds`, U13), and the booking the body's typed `reference`
 * (`POST /admin/scans`, U13). Bookings' `SettleFirstInterceptor`, registered globally, reads it.
 *
 * It lives in `common` so a module that bookings imports can mark its routes too: showtimes'
 * `PATCH /admin/showtimes/{id}` settles the showtime's due payments before it cancels or moves
 * the showtime (U14), and showtimes cannot import bookings.
 */
export const SettleFirst = (
  kind: SettleFirstKind,
  source: SettleFirstSource = 'params',
): MethodDecorator =>
  SetMetadata(SETTLE_FIRST_METADATA, { kind, source } satisfies SettleFirstOptions);
