import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SEAT_MARK_KINDS, ZONES } from '../enums';
import {
  MAX_ROWS,
  MAX_SEAT_MARKS,
  MAX_SEATS_PER_ROW,
  MIN_ROWS,
  MIN_SEATS_PER_ROW,
} from '../halls.constants';
import type { SeatMarkKind, Zone } from '../types';

/** One cell of the grid that is not a plain seat. */
export class SeatMarkRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^[A-HJ-P]$',
    example: 'F',
    description: 'The row letter, A to P without I; it must be one of the rows of the layout.',
  })
  @Matches(/^[A-HJ-P]$/, { message: 'rowLabel must be a row letter from A to P, without I' })
  rowLabel!: string;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: MAX_SEATS_PER_ROW,
    example: 7,
    description:
      'The seat number, counted from 1 on the left; at most `seatsPerRow`. A gap keeps its number: seats never renumber.',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS_PER_ROW)
  seatNumber!: number;

  @ApiProperty({
    enum: SEAT_MARK_KINDS,
    enumName: 'SeatMarkKind',
    nullable: false,
    example: 'wheelchair',
    description:
      '`wheelchair`: a wheelchair space, sold at the zone price of its row. `no_seat`: a gap, not a seat.',
  })
  @IsIn(SEAT_MARK_KINDS)
  kind!: SeatMarkKind;
}

/**
 * `PUT /admin/halls/{id}/layout`: the whole layout. Cross-field rules (zones per row, zone bands,
 * marks inside the grid, no duplicates, at least one seat) are checked by the service and
 * answered as `VALIDATION_FAILED` with field paths, like the shape checks here.
 */
export class ReplaceHallLayoutRequest {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: MIN_ROWS,
    maximum: MAX_ROWS,
    example: 12,
    description: `Rows, ${MIN_ROWS} to ${MAX_ROWS}, lettered from the screen back: A to P without I.`,
  })
  @IsInt()
  @Min(MIN_ROWS)
  @Max(MAX_ROWS)
  rowCount!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: MIN_SEATS_PER_ROW,
    maximum: MAX_SEATS_PER_ROW,
    example: 16,
    description: `Seats in every row, ${MIN_SEATS_PER_ROW} to ${MAX_SEATS_PER_ROW}. Aisles follow seat 4 and the 4th seat from the end; they are not cells.`,
  })
  @IsInt()
  @Min(MIN_SEATS_PER_ROW)
  @Max(MAX_SEATS_PER_ROW)
  seatsPerRow!: number;

  @ApiProperty({
    enum: ZONES,
    enumName: 'SeatZone',
    isArray: true,
    nullable: false,
    minItems: MIN_ROWS,
    maxItems: MAX_ROWS,
    example: [
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
    description:
      'One zone per row, front to back: item 0 is row A. Exactly `rowCount` items. Zones form bands from the screen back: `front` rows, then `middle`, then `back`; any band may be empty, and a row is never in a zone in front of the row before it.',
  })
  @IsArray()
  @ArrayMinSize(MIN_ROWS)
  @ArrayMaxSize(MAX_ROWS)
  @IsIn(ZONES, { each: true })
  rowZones!: Zone[];

  @ApiProperty({
    type: () => SeatMarkRequest,
    isArray: true,
    nullable: false,
    maxItems: MAX_SEAT_MARKS,
    example: [
      { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
      { rowLabel: 'A', seatNumber: 2, kind: 'wheelchair' },
      { rowLabel: 'M', seatNumber: 16, kind: 'no_seat' },
    ],
    description:
      'Wheelchair spaces and gaps; every other cell is a seat. Each inside the grid (`rowLabel` a row of this layout, `seatNumber` at most `seatsPerRow`), at most one per seat, and at least one seat must remain. Empty for a full grid.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_SEAT_MARKS)
  @ValidateNested({ each: true })
  @Type(() => SeatMarkRequest)
  seatMarks!: SeatMarkRequest[];
}
