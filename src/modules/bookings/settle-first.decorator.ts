import { SetMetadata } from '@nestjs/common';
import { SETTLE_FIRST_METADATA } from './bookings.constants';
import type { SettleFirstKind } from './types';

/**
 * Settles due payments before the route runs (design §7.1 step 1, §7.5), in their own short
 * transaction committed before the request's: those of the booking `{ref}` (`'booking'`) or of
 * bookings on the showtime `{id}` (`'showtime'`), and those of the calling customer's bookings;
 * `'customer'` settles only the calling customer's (My Bookings, U12).
 * `SettleFirstInterceptor` reads it. Exported for the box office and admin routes (U13, U14).
 */
export const SettleFirst = (kind: SettleFirstKind): MethodDecorator =>
  SetMetadata(SETTLE_FIRST_METADATA, kind);
