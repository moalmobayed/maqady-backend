/**
 * A hall's status (design §9, PRD "Halls and seat maps" 5, A4). Mirrored by `chk_halls_status`.
 *
 * - `draft`: being set up; not schedulable, does not count for publishing its theater.
 * - `active`: schedulable (U7); a theater needs one to be published.
 * - `retired`: kept for history, hidden from scheduling; final.
 */
export const HALL_STATUSES = ['draft', 'active', 'retired'] as const;

/**
 * The seat zone of a row (PRD "Prices" 1), front to back. Every seat of a row costs its zone's
 * price. Mirrored by `chk_hall_rows_zone`.
 */
export const ZONES = ['front', 'middle', 'back'] as const;

/**
 * An exception to the full grid (PRD "Halls and seat maps" 2). Mirrored by
 * `chk_hall_seat_marks_kind`.
 *
 * - `wheelchair`: a wheelchair space; it is a seat, sold at its row's zone price.
 * - `no_seat`: a gap in the grid; not a seat.
 */
export const SEAT_MARK_KINDS = ['wheelchair', 'no_seat'] as const;
