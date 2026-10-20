import type { AuditMetadataValue } from '../../common/audit/types';
import type { HALL_STATUSES, SEAT_MARK_KINDS, ZONES } from './enums';

export type HallStatus = (typeof HALL_STATUSES)[number];

export type Zone = (typeof ZONES)[number];

export type SeatMarkKind = (typeof SEAT_MARK_KINDS)[number];

// --- Rows -----------------------------------------------------------------------------------

/** A `halls` row as the repository reads it. */
export interface HallRow {
  readonly id: number;
  readonly theater_id: number;
  readonly name: string;
  readonly status: HallStatus;
  readonly row_count: number;
  readonly seats_per_row: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns of a new hall: always a draft. */
export interface NewHallRow {
  readonly theater_id: number;
  readonly name: string;
  readonly status: 'draft';
  readonly row_count: number;
  readonly seats_per_row: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns a hall write may change; `updated_at` always. */
export interface HallRowUpdate {
  readonly name?: string;
  readonly status?: HallStatus;
  readonly row_count?: number;
  readonly seats_per_row?: number;
  readonly updated_at: Date;
}

/** A `hall_rows` row: one row of a hall's grid. */
export interface HallRowRow {
  readonly hall_id: number;
  readonly row_index: number;
  readonly row_label: string;
  readonly zone: Zone;
}

/** A `hall_seat_marks` row: a wheelchair space or a gap. */
export interface HallSeatMarkRow {
  readonly hall_id: number;
  readonly row_label: string;
  readonly seat_number: number;
  readonly kind: SeatMarkKind;
}

// --- Layouts --------------------------------------------------------------------------------

/** One row of a layout: `index` 0 is row `A`, nearest the screen. */
export interface LayoutRow {
  readonly index: number;
  readonly label: string;
  readonly zone: Zone;
}

/** A cell that is not a plain seat: `F7` is `{ rowLabel: 'F', seatNumber: 7 }`. */
export interface SeatMark {
  readonly rowLabel: string;
  readonly seatNumber: number;
  readonly kind: SeatMarkKind;
}

/** A whole layout as an admin sends it (`PUT /admin/halls/{id}/layout`), before validation. */
export interface HallLayoutInput {
  readonly rowCount: number;
  readonly seatsPerRow: number;
  /** One zone per row, front to back: index 0 is row `A`. */
  readonly rowZones: readonly Zone[];
  readonly seatMarks: readonly SeatMark[];
}

/** The seats of each zone; wheelchair spaces count, gaps do not. */
export interface ZoneSeatCounts {
  readonly front: number;
  readonly middle: number;
  readonly back: number;
}

/** What a layout holds: seats (wheelchair spaces included), wheelchair spaces, seats per zone. */
export interface SeatCounts {
  readonly seatCount: number;
  readonly wheelchairCount: number;
  readonly zoneSeatCounts: ZoneSeatCounts;
}

/** The grid part of a layout, which seat counts and seat lists are computed from. */
export interface LayoutGrid {
  readonly seatsPerRow: number;
  /** Front to back. */
  readonly rows: readonly LayoutRow[];
  readonly seatMarks: readonly SeatMark[];
}

/** A hall's layout as other units read it (U8 seat maps, U10 holds). */
export interface HallLayout extends LayoutGrid, SeatCounts {
  readonly hallId: number;
  readonly theaterId: number;
  readonly rowCount: number;
  /** Seat numbers after which an aisle falls: `[4, seatsPerRow − 4]`, deduplicated (design §9). */
  readonly aisleAfter: readonly number[];
  readonly updatedAt: Date;
}

/** One sellable seat of a layout (gaps are not seats). */
export interface HallSeat {
  /** `<row><number>`, for example `F7`: what `seat_claims` and `booking_seats` key on. */
  readonly label: string;
  readonly rowLabel: string;
  readonly seatNumber: number;
  readonly zone: Zone;
  readonly isWheelchair: boolean;
}

/** A seat label taken apart. */
export interface SeatPosition {
  readonly rowLabel: string;
  readonly seatNumber: number;
}

// --- Halls ----------------------------------------------------------------------------------

/** A hall as other units read it, in any status, with its seat counts. */
export interface HallSummary extends SeatCounts {
  readonly id: number;
  readonly theaterId: number;
  readonly name: string;
  readonly status: HallStatus;
  readonly rowCount: number;
  readonly seatsPerRow: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A hall as the admin Halls tab shows it: whether it can be deleted, or only retired. */
export interface HallAdminView extends HallSummary {
  readonly deletable: boolean;
}

/** `GET /admin/theaters/{id}/halls` filters. */
export interface HallListFilter {
  readonly status?: HallStatus;
}

/** `PATCH /admin/halls/{id}`, as validated: only the fields sent. */
export interface HallChanges {
  readonly name?: string;
  readonly status?: HallStatus;
}

/** Extra details of one audit event of a hall write. */
export interface HallAuditDetails {
  readonly changedFields?: readonly string[];
  readonly metadata?: Readonly<Record<string, AuditMetadataValue>>;
}

// --- Lifecycle seams (U7, U10) ----------------------------------------------------------------

/**
 * A reason another unit has for refusing to delete or retire halls, such as U7's
 * `has_showtimes`. It answers for many halls at once, so a page of halls costs one query per
 * blocker.
 */
export interface HallBlocker {
  readonly key: string;
  /** The ids among `hallIds` this blocker refuses. */
  blockedIds(hallIds: readonly number[]): Promise<ReadonlySet<number>>;
}

/** A showtime that keeps a hall's layout from changing (`HALL_IN_USE`). */
export interface HallBlockingShowtime {
  readonly showtimeId: number;
  readonly startsAt: Date;
  readonly movieTitle: string;
}

/** One entry of `HALL_IN_USE` `details.showtimes`. */
export interface HallInUseShowtime {
  readonly id: number;
  /** Cairo time with its offset. */
  readonly startsAt: string;
  readonly movieTitle: string;
}

/**
 * Another unit's part in a layout replace (design §8 "Capacity", §9), run inside its
 * transaction in this order:
 *
 * 1. `beforeLock`, after the theater is locked `FOR SHARE` and before the hall is locked
 *    `FOR UPDATE` (U7 locks the hall's future showtimes here, keeping "showtime before hall");
 * 2. `blockingShowtimes`, with the hall locked: any answer refuses the save with `HALL_IN_USE`
 *    (U10: unended showtimes with a live seat claim);
 * 3. `afterSave`, once the new layout is written (U7 refreshes future showtimes' capacity).
 *
 * A throw from any of them rolls the whole replace back.
 */
export interface HallLayoutParticipant {
  readonly key: string;
  beforeLock?(hallId: number): Promise<void>;
  blockingShowtimes?(hallId: number): Promise<readonly HallBlockingShowtime[]>;
  afterSave?(hallId: number, layout: HallLayout): Promise<void>;
}
