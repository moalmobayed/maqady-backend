import { aisleAfter, seatCounts } from './hall-layout';
import type {
  HallLayout,
  HallRow,
  HallRowRow,
  HallSeatMarkRow,
  HallSummary,
  LayoutGrid,
  LayoutRow,
  SeatMark,
} from './types';

/**
 * Builds halls' summaries and layouts from their rows, read in one batch per table: the rows of
 * `hall_rows` and `hall_seat_marks` for every hall at once, grouped here by hall.
 */
export class HallChildren {
  private readonly rowsByHall = new Map<number, LayoutRow[]>();
  private readonly marksByHall = new Map<number, SeatMark[]>();

  constructor(rows: readonly HallRowRow[], marks: readonly HallSeatMarkRow[]) {
    for (const row of [...rows].sort((a, b) => a.row_index - b.row_index)) {
      const list = this.rowsByHall.get(row.hall_id) ?? [];
      list.push({ index: row.row_index, label: row.row_label, zone: row.zone });
      this.rowsByHall.set(row.hall_id, list);
    }
    const ordered = [...marks].sort(
      (a, b) => a.row_label.localeCompare(b.row_label) || a.seat_number - b.seat_number,
    );
    for (const mark of ordered) {
      const list = this.marksByHall.get(mark.hall_id) ?? [];
      list.push({ rowLabel: mark.row_label, seatNumber: mark.seat_number, kind: mark.kind });
      this.marksByHall.set(mark.hall_id, list);
    }
  }

  grid(hall: HallRow): LayoutGrid {
    return {
      seatsPerRow: hall.seats_per_row,
      rows: this.rowsByHall.get(hall.id) ?? [],
      seatMarks: this.marksByHall.get(hall.id) ?? [],
    };
  }

  summary(hall: HallRow): HallSummary {
    return toHallSummary(hall, this.grid(hall));
  }

  layout(hall: HallRow): HallLayout {
    return toHallLayout(hall, this.grid(hall));
  }
}

export function toHallSummary(hall: HallRow, grid: LayoutGrid): HallSummary {
  return {
    id: hall.id,
    theaterId: hall.theater_id,
    name: hall.name,
    status: hall.status,
    rowCount: hall.row_count,
    seatsPerRow: hall.seats_per_row,
    ...seatCounts(grid),
    createdAt: hall.created_at,
    updatedAt: hall.updated_at,
  };
}

export function toHallLayout(hall: HallRow, grid: LayoutGrid): HallLayout {
  return {
    hallId: hall.id,
    theaterId: hall.theater_id,
    rowCount: hall.row_count,
    seatsPerRow: hall.seats_per_row,
    rows: grid.rows,
    seatMarks: grid.seatMarks,
    aisleAfter: aisleAfter(hall.seats_per_row),
    ...seatCounts(grid),
    updatedAt: hall.updated_at,
  };
}
