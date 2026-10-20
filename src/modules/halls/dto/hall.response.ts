import { ApiProperty } from '@nestjs/swagger';
import { HALL_STATUSES } from '../enums';
import { MAX_ROWS, MAX_SEATS_PER_ROW, MIN_ROWS, MIN_SEATS_PER_ROW } from '../halls.constants';
import type { HallStatus } from '../types';
import { ZoneSeatCountsResponse } from './zone-seat-counts.response';

/** A hall as the admin Halls tab shows it (PRD A4): name, seats, layout size, status. */
export class HallResponse {
  @ApiProperty({ type: 'integer', example: 3, description: 'Hall id.' })
  id!: number;

  @ApiProperty({ type: 'integer', example: 1, description: 'The theater the hall belongs to.' })
  theaterId!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'Hall 3',
    description: "Unique among the theater's halls, ignoring letter case.",
  })
  name!: string;

  @ApiProperty({
    enum: HALL_STATUSES,
    enumName: 'HallStatus',
    nullable: false,
    example: 'active',
    description:
      '`draft`: being set up, not schedulable. `active`: schedulable; a theater needs one to be published. `retired`: kept for history, hidden from scheduling; final.',
  })
  status!: HallStatus;

  @ApiProperty({
    type: 'integer',
    minimum: MIN_ROWS,
    maximum: MAX_ROWS,
    example: 12,
    description: 'Rows of the grid (the "12" of "12 × 16").',
  })
  rowCount!: number;

  @ApiProperty({
    type: 'integer',
    minimum: MIN_SEATS_PER_ROW,
    maximum: MAX_SEATS_PER_ROW,
    example: 16,
    description: 'Seats per row (the "16" of "12 × 16").',
  })
  seatsPerRow!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 190,
    description: 'Seats in the layout, wheelchair spaces included and gaps left out.',
  })
  seatCount!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 2,
    description: 'Wheelchair spaces among the seats.',
  })
  wheelchairCount!: number;

  @ApiProperty({ type: () => ZoneSeatCountsResponse, description: 'Seats per zone.' })
  zoneSeatCounts!: ZoneSeatCountsResponse;

  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      'Whether the hall can be deleted: true while it never had a showtime. Otherwise the Halls tab offers Retire instead of Delete.',
  })
  deletable!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-16T14:52:00+03:00',
    description: 'When the hall was added, in Cairo time.',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-16T14:52:00+03:00',
    description: 'When the hall or its layout last changed, in Cairo time.',
  })
  updatedAt!: string;
}
