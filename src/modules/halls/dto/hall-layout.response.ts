import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SEAT_MARK_KINDS, ZONES } from '../enums';
import {
  MAX_ROWS,
  MAX_SEATS_PER_ROW,
  MIN_ROWS,
  MIN_SEATS_PER_ROW,
  ROW_LABELS,
} from '../halls.constants';
import type { SeatMarkKind, Zone } from '../types';
import { ZoneSeatCountsResponse } from './zone-seat-counts.response';

/** One row of a layout. */
@ApiSchema({ name: 'HallLayoutRow' })
export class HallLayoutRowResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    enum: [...ROW_LABELS],
    example: 'A',
    description: 'The row letter, A nearest the screen; I is skipped.',
  })
  label!: string;

  @ApiProperty({
    enum: ZONES,
    enumName: 'SeatZone',
    nullable: false,
    example: 'front',
    description: "The row's zone: every seat in the row costs this zone's price.",
  })
  zone!: Zone;
}

/** A cell that is not a plain seat. */
@ApiSchema({ name: 'SeatMark' })
export class SeatMarkResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^[A-HJ-P]$',
    example: 'A',
    description: 'The row letter, A to P without I: one of the rows of the layout.',
  })
  rowLabel!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_SEATS_PER_ROW,
    example: 1,
    description: 'Seat number from the left; the seat label is the row letter and this (`A1`).',
  })
  seatNumber!: number;

  @ApiProperty({
    enum: SEAT_MARK_KINDS,
    enumName: 'SeatMarkKind',
    nullable: false,
    example: 'wheelchair',
    description: '`wheelchair`: a wheelchair space (a seat). `no_seat`: a gap, not a seat.',
  })
  kind!: SeatMarkKind;
}

/**
 * A hall's seat map (design §9): the grid, the zone of each row, the marked cells and the
 * aisles. Every cell not in `seatMarks` is a plain seat. Reused by the public seat map (U8, U10).
 */
@ApiSchema({ name: 'HallLayout' })
export class HallLayoutResponse {
  @ApiProperty({ type: 'integer', example: 3, description: 'Hall id.' })
  hallId!: number;

  @ApiProperty({
    type: 'integer',
    minimum: MIN_ROWS,
    maximum: MAX_ROWS,
    example: 12,
    description: 'Rows of the grid.',
  })
  rowCount!: number;

  @ApiProperty({
    type: 'integer',
    minimum: MIN_SEATS_PER_ROW,
    maximum: MAX_SEATS_PER_ROW,
    example: 16,
    description: 'Seats per row, numbered 1 to `seatsPerRow` from the left.',
  })
  seatsPerRow!: number;

  @ApiProperty({
    type: 'integer',
    isArray: true,
    example: [4, 12],
    description:
      'Seat numbers an aisle follows: `[4, seatsPerRow − 4]`, deduplicated and in order (8 seats: `[4]`; 16: `[4, 12]`; 20: `[4, 16]`). Computed, never stored.',
  })
  aisleAfter!: number[];

  @ApiProperty({
    type: () => HallLayoutRowResponse,
    isArray: true,
    description: 'Every row, front to back (`rowCount` items).',
  })
  rows!: HallLayoutRowResponse[];

  @ApiProperty({
    type: () => SeatMarkResponse,
    isArray: true,
    description: 'Wheelchair spaces and gaps, by row then seat; empty for a full grid.',
  })
  seatMarks!: SeatMarkResponse[];

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 190,
    description: 'Seats, wheelchair spaces included and gaps left out.',
  })
  seatCount!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 2, description: 'Wheelchair spaces.' })
  wheelchairCount!: number;

  @ApiProperty({ type: () => ZoneSeatCountsResponse, description: 'Seats per zone.' })
  zoneSeatCounts!: ZoneSeatCountsResponse;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-16T14:52:00+03:00',
    description: 'When the hall or its layout last changed, in Cairo time.',
  })
  updatedAt!: string;
}
