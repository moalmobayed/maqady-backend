import { AppError } from '../../common/errors/app-error';
import type { FieldError } from '../../common/errors/types';
import { ZONES } from './enums';
import {
  AISLE_OFFSET,
  MAX_ROWS,
  MAX_SEATS_PER_ROW,
  MIN_ROWS,
  MIN_SEATS_PER_ROW,
  ROW_LABELS,
} from './halls.constants';
import type {
  HallLayoutInput,
  HallSeat,
  LayoutGrid,
  LayoutRow,
  SeatCounts,
  SeatPosition,
  Zone,
} from './types';

/**
 * The rules of a hall's seat grid (design §9; PRD "Halls and seat maps"), as pure functions that
 * U8 (seat maps) and U10 (holds) share with this unit:
 *
 * - rows are lettered front to back from `ROW_LABELS` (A to P without I);
 * - seats are numbered 1 to `seatsPerRow` from the left, and a gap keeps its number, so a seat's
 *   label (`F7`) never changes when a gap is painted beside it;
 * - a wheelchair space is a seat; a `no_seat` cell is not.
 */

const SEAT_LABEL_PATTERN = /^([A-HJ-P])([1-9][0-9]?)$/;

/** The label of the row at `index` (0 is `A`). */
export function rowLabelAt(index: number): string {
  const label = Number.isInteger(index) ? ROW_LABELS[index] : undefined;
  if (label === undefined) throw new AppError('INTERNAL', `There is no row at index ${index}.`);
  return label;
}

/** The index of a row label (`A` is 0); null for a label that is not a row letter. */
export function rowIndexOf(label: string): number | null {
  const index = label.length === 1 ? ROW_LABELS.indexOf(label) : -1;
  return index === -1 ? null : index;
}

/** A seat's label: `seatLabel('F', 7)` is `F7`. */
export function seatLabel(rowLabel: string, seatNumber: number): string {
  return `${rowLabel}${seatNumber}`;
}

/**
 * A seat label taken apart (`F7` → `{ rowLabel: 'F', seatNumber: 7 }`); null when it is not a
 * row letter followed by a number from 1 to 20. Whether the seat exists in a hall is for
 * `layoutSeats()` to say.
 */
export function parseSeatLabel(label: string): SeatPosition | null {
  const match = SEAT_LABEL_PATTERN.exec(label);
  if (!match) return null;
  const seatNumber = Number(match[2]);
  if (seatNumber > MAX_SEATS_PER_ROW) return null;
  return { rowLabel: match[1]!, seatNumber };
}

/**
 * The seat numbers an aisle follows (PRD "Halls and seat maps" 3): after seat 4 and 4 seats
 * before the end, deduplicated and in order. 8 seats → `[4]`, 16 → `[4, 12]`, 20 → `[4, 16]`.
 */
export function aisleAfter(seatsPerRow: number): number[] {
  return [...new Set([AISLE_OFFSET, seatsPerRow - AISLE_OFFSET])].sort((a, b) => a - b);
}

/** The rows of a layout from its zones, front to back. */
export function layoutRows(rowZones: readonly Zone[]): LayoutRow[] {
  return rowZones.map((zone, index) => ({ index, label: rowLabelAt(index), zone }));
}

/**
 * Every problem with a layout, as `VALIDATION_FAILED` field errors (empty when it is valid):
 *
 * - `rowCount` 4–15 and `seatsPerRow` 8–20, whole numbers;
 * - `rowZones`: one zone per row, in bands from the screen back: a row's zone is never in front
 *   of the zone of the row before it (`front`, then `middle`, then `back`; any may be empty);
 * - `seatMarks`: each inside the grid, at most one per seat, and at least one seat left.
 */
export function layoutErrors(input: HallLayoutInput): FieldError[] {
  const errors: FieldError[] = [];
  const add = (field: string, message: string): void => {
    errors.push({ field, messages: [message] });
  };
  const { rowCount, seatsPerRow, rowZones, seatMarks } = input;
  const rowCountValid = Number.isInteger(rowCount) && rowCount >= MIN_ROWS && rowCount <= MAX_ROWS;
  const seatsValid =
    Number.isInteger(seatsPerRow) &&
    seatsPerRow >= MIN_SEATS_PER_ROW &&
    seatsPerRow <= MAX_SEATS_PER_ROW;
  if (!rowCountValid) {
    add('rowCount', `rowCount must be a whole number from ${MIN_ROWS} to ${MAX_ROWS}`);
  }
  if (!seatsValid) {
    add(
      'seatsPerRow',
      `seatsPerRow must be a whole number from ${MIN_SEATS_PER_ROW} to ${MAX_SEATS_PER_ROW}`,
    );
  }

  if (rowCountValid && rowZones.length !== rowCount) {
    add('rowZones', `rowZones must hold one zone per row: ${rowCount}, front to back`);
  }
  rowZones.forEach((zone, index) => {
    const rank = ZONES.indexOf(zone);
    if (rank === -1) {
      add(`rowZones.${index}`, `each zone must be one of: ${ZONES.join(', ')}`);
      return;
    }
    const previous = index > 0 ? ZONES.indexOf(rowZones[index - 1]!) : -1;
    if (previous > rank) {
      add(
        `rowZones.${index}`,
        `zones run front to back: row ${ROW_LABELS[index] ?? index} cannot be ${zone} behind a ${rowZones[index - 1]} row`,
      );
    }
  });

  const seen = new Set<string>();
  let gaps = 0;
  seatMarks.forEach((mark, index) => {
    const rowIndex = rowIndexOf(mark.rowLabel);
    const rowValid = rowIndex !== null && (!rowCountValid || rowIndex < rowCount);
    const seatValid =
      Number.isInteger(mark.seatNumber) &&
      mark.seatNumber >= 1 &&
      mark.seatNumber <= (seatsValid ? seatsPerRow : MAX_SEATS_PER_ROW);
    if (!rowValid) {
      add(
        `seatMarks.${index}.rowLabel`,
        rowCountValid
          ? `rowLabel must be a row of this layout: ${ROW_LABELS[0]} to ${ROW_LABELS[rowCount - 1]}`
          : `rowLabel must be one of ${ROW_LABELS}`,
      );
    }
    if (!seatValid) {
      add(
        `seatMarks.${index}.seatNumber`,
        `seatNumber must be a seat of the row: 1 to ${seatsValid ? seatsPerRow : MAX_SEATS_PER_ROW}`,
      );
    }
    if (!rowValid || !seatValid) return;
    const label = seatLabel(mark.rowLabel, mark.seatNumber);
    if (seen.has(label)) {
      add(`seatMarks.${index}`, `seat ${label} is marked more than once`);
      return;
    }
    seen.add(label);
    if (mark.kind === 'no_seat') gaps += 1;
  });

  if (errors.length === 0 && gaps >= rowCount * seatsPerRow) {
    add('seatMarks', 'a layout needs at least one seat; every cell is marked no_seat');
  }
  return errors;
}

/** Refuses an invalid layout with `VALIDATION_FAILED` and every problem in `details.fields`. */
export function validateLayout(input: HallLayoutInput): void {
  const fields = layoutErrors(input);
  if (fields.length > 0) throw new AppError('VALIDATION_FAILED', undefined, { fields });
}

/**
 * Every seat of a layout, front row first and left to right, gaps left out: the list U10
 * validates holds against and snapshots into `booking_seats`.
 */
export function layoutSeats(grid: LayoutGrid): HallSeat[] {
  const marks = new Map(
    grid.seatMarks.map((mark) => [seatLabel(mark.rowLabel, mark.seatNumber), mark.kind]),
  );
  const seats: HallSeat[] = [];
  for (const row of grid.rows) {
    for (let seatNumber = 1; seatNumber <= grid.seatsPerRow; seatNumber += 1) {
      const label = seatLabel(row.label, seatNumber);
      const kind = marks.get(label);
      if (kind === 'no_seat') continue;
      seats.push({
        label,
        rowLabel: row.label,
        seatNumber,
        zone: row.zone,
        isWheelchair: kind === 'wheelchair',
      });
    }
  }
  return seats;
}

/** How many seats a layout has, how many are wheelchair spaces, and how many each zone has. */
export function seatCounts(grid: LayoutGrid): SeatCounts {
  const zoneSeatCounts = { front: 0, middle: 0, back: 0 };
  let wheelchairCount = 0;
  const seats = layoutSeats(grid);
  for (const seat of seats) {
    zoneSeatCounts[seat.zone] += 1;
    if (seat.isWheelchair) wheelchairCount += 1;
  }
  return { seatCount: seats.length, wheelchairCount, zoneSeatCounts };
}
