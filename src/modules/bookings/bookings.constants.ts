import type { BookingHistoryKind } from './types';

/** A hold lasts 5 minutes, and never beyond the showtime's start (design §7.3, PRD Seats 2). */
export const HOLD_MINUTES = 5;

/** 1 to 8 seats per hold (PRD Seats 2). */
export const MAX_SEATS_PER_HOLD = 8;

/** Booking references: `MQ-` and 6 characters without 0, O, 1, I or L (design §7.9). */
export const REFERENCE_PREFIX = 'MQ-';
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERENCE_LENGTH = 6;
export const REFERENCE_PATTERN = /^MQ-[2-9A-HJKMNP-Z]{6}$/;
/** A colliding reference is drawn again, at most this many times in all (design §7.9). */
export const REFERENCE_DRAWS = 5;

/** A guest's hold code: 32 random bytes as base64url (design §7.3 step 7). */
export const HOLD_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The request header that carries a hold code (design §10.4, §10.7), lower-cased as Node reads it. */
export const HOLD_TOKEN_HEADER_NAME = 'x-hold-token';

/** The public seat map's caching: it is live, so nothing keeps a copy. */
export const SEAT_MAP_CACHE_CONTROL = 'no-store';

/** Audit entity type of booking events. */
export const BOOKING_ENTITY = 'booking';

/**
 * A processing payment keeps its hold and seats this long past the provider's `settlesAt`
 * (design §7.5 "Processing"), so the seats stay the customer's until the result is in.
 */
export const PROCESSING_GRACE_SECONDS = 30;

/** Ticket QR payloads (design §7.9): `MQ1.<reference>.<qr_version>.<signature>`. */
export const QR_PREFIX = 'MQ1';
/** The HMAC-SHA256 is truncated to this many bytes: 22 base64url characters. */
export const QR_SIGNATURE_BYTES = 16;
export const QR_PAYLOAD_PATTERN =
  /^MQ1\.(MQ-[2-9A-HJKMNP-Z]{6})\.([1-9][0-9]{0,4})\.([A-Za-z0-9_-]{22})$/;

/** Frontend pages the tickets messages link to (design §7.9, §13.1). */
export const TICKET_LINK_PATH = '/ticket';
export const MY_BOOKINGS_PATH = '/my-bookings';

/** Metadata key `@SettleFirst()` writes. */
export const SETTLE_FIRST_METADATA = 'maqady:settle-first';

/** Audit entity type of payment events. */
export const PAYMENT_ENTITY = 'payment';

/** Ticket downloads are personal: no shared cache keeps them, and no browser cache either. */
export const TICKET_CACHE_CONTROL = 'private, no-store';

/** The calendar event's organizer-free UID domain: `UID:<reference>@maqady`. */
export const CALENDAR_UID_DOMAIN = 'maqady';

/** Personal reads (My Bookings, a booking's History): no shared or browser cache keeps them. */
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

/** The audit action of "Email again" (U12) and of the staff resend (U14). */
export const TICKETS_RESENT_ACTION = 'booking.tickets_resent';

/**
 * A booking's own audit actions its History shows (PRD C11), and as what. Every other action
 * (`booking.claimed`, `booking.released`, `booking.confirmed`, `payment.declined`,
 * `payment.cancelled`, `payment.processing`, `payment.refunded`) stays internal.
 */
export const HISTORY_BOOKING_ACTIONS: Readonly<Record<string, BookingHistoryKind>> = {
  'booking.held': 'seats_held',
  'payment.succeeded': 'payment_received',
  'booking.refunded': 'refunded',
  'booking.edited': 'changed_by_cinema',
  [TICKETS_RESENT_ACTION]: 'tickets_resent',
};

/** The showtime's audit actions a booking's History shows while the booking holds a ticket. */
export const HISTORY_SHOWTIME_ACTIONS: Readonly<Record<string, BookingHistoryKind>> = {
  'showtime.moved': 'changed_by_cinema',
};

/** The English label of each History kind, as the booking page shows it. */
export const HISTORY_LABELS: Readonly<Record<BookingHistoryKind, string>> = {
  seats_held: 'Seats held',
  payment_received: 'Payment received',
  refunded: 'Refunded',
  changed_by_cinema: 'Changed by the cinema',
  tickets_resent: 'Tickets resent',
};

// --- Box office (U13) -----------------------------------------------------------------------

/** Scanning opens this many minutes before a showtime starts and closes at its end (PRD call 14). */
export const SCAN_OPENS_MINUTES_BEFORE_START = 60;

/**
 * A card terminal's receipt reference as staff type it (PRD Payments 2): up to 64 letters, digits,
 * spaces and `. / _ -`, starting with a letter or digit. `chk_payments_receipt_reference` repeats it.
 */
export const RECEIPT_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$/;
export const RECEIPT_REFERENCE_MAX_LENGTH = 64;

/** The longest scanned code accepted: a camera reads any QR code, and anything else is NOT_FOUND. */
export const SCAN_CODE_MAX_LENGTH = 512;

/** Audit actions of the box office that U10 and U11 do not already name. */
export const BOOKING_CHECKED_IN_ACTION = 'booking.checked_in';
export const TICKET_DOWNLOADED_ACTION = 'booking.ticket_downloaded';
