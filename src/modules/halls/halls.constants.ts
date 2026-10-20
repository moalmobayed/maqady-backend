import type { HallLayoutInput, HallStatus } from './types';

/**
 * Row letters, front to back: A to P without I (PRD "Halls and seat maps" 1). Index 0 is the row
 * nearest the screen. Mirrored by `chk_hall_rows_row_label`.
 */
export const ROW_LABELS = 'ABCDEFGHJKLMNOP';

/** Grid limits (PRD "Halls and seat maps" 1), mirrored by the CHECKs of migration `0060_01`. */
export const MIN_ROWS = 4;
export const MAX_ROWS = ROW_LABELS.length;
export const MIN_SEATS_PER_ROW = 8;
export const MAX_SEATS_PER_ROW = 20;

/** Aisles fall after this many seats from each end of a row (PRD "Halls and seat maps" 3). */
export const AISLE_OFFSET = 4;

/** At most one mark per cell of the largest grid. */
export const MAX_SEAT_MARKS = MAX_ROWS * MAX_SEATS_PER_ROW;

/** Hall names: 1 to 40 characters after trimming (`chk_halls_name`). */
export const HALL_NAME_LIMITS = { min: 1, max: 40 } as const;

/**
 * A new hall's layout (PRD A4 "New halls start as a standard 12 × 16 layout"): rows A–C front,
 * D–H middle, J–M back, no marks, 192 seats.
 */
export const DEFAULT_LAYOUT: HallLayoutInput = {
  rowCount: 12,
  seatsPerRow: 16,
  rowZones: [
    'front',
    'front',
    'front',
    'middle',
    'middle',
    'middle',
    'middle',
    'middle',
    'back',
    'back',
    'back',
    'back',
  ],
  seatMarks: [],
};

/** The status changes `PATCH /admin/halls/{id}` allows (spec "Decisions"); `retired` is final. */
export const HALL_STATUS_TRANSITIONS: Readonly<Record<HallStatus, readonly HallStatus[]>> = {
  draft: ['active', 'retired'],
  active: ['retired'],
  retired: [],
};

/** The audit action of each allowed status change. */
export const HALL_STATUS_ACTIONS: Readonly<Record<string, string>> = {
  'draft>active': 'hall.activated',
  'draft>retired': 'hall.retired',
  'active>retired': 'hall.retired',
};

/** `HALL_IN_USE` lists at most this many blocking showtimes, the soonest first. */
export const MAX_BLOCKING_SHOWTIMES = 20;

/** The publish requirement this unit registers with `TheaterLifecycleRegistry` (design §9). */
export const ACTIVE_HALL_REQUIREMENT = 'active_hall';
