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
