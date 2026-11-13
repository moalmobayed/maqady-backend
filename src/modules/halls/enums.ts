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

/**
 * A hall's projection format (#29 P4, docs/gh-29-hall-screen-format), in display order: the
 * movie page lists a theater's formats of a day in this order ("Standard, VIP"). A label shown
 * on the hall and on its showtime chips; it never changes a price. Mirrored by
 * `chk_halls_format`.
 *
 * - `standard`: a standard digital hall (the design's "2D"); every hall before #29.
 * - `vip`: VIP recliners.
 * - `imax`, `dolby_atmos` (the chip may say "Atmos"), `4dx`, `screenx`: those branded formats.
 * - `max`: a premium large-format screen sold under the MAX name.
 */
export const HALL_FORMATS = [
  'standard',
  'vip',
  'imax',
  'dolby_atmos',
  '4dx',
  'screenx',
  'max',
] as const;
