/** How the seat map shows a taken seat (design §12): on a live hold, or sold. */
export const SEAT_STATES = ['held', 'booked'] as const;

/** The seat events the server pushes after a commit (design §12). `seat.booked` comes with U11. */
export const SEAT_EVENT_TYPES = ['seat.held', 'seat.released', 'seat.booked'] as const;

/** The codes of the seat map's `error` message (design §12). */
export const SEAT_MAP_ERROR_CODES = ['VALIDATION_FAILED', 'RATE_LIMITED', 'FORBIDDEN'] as const;
