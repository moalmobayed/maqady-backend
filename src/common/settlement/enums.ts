/**
 * What a route settles before it runs (`@SettleFirst()`): the booking `{ref}`, the showtime `{id}`,
 * or only the calling customer's bookings (`'customer'`, My Bookings, U12).
 */
export const SETTLE_FIRST_KINDS = ['booking', 'showtime', 'customer'] as const;

/**
 * Where `@SettleFirst()` reads the booking reference or showtime id: the path (`{ref}`, `{id}`),
 * or the JSON body's `showtimeId` (`POST /admin/counter-holds`, U13).
 */
export const SETTLE_FIRST_SOURCES = ['params', 'body'] as const;
