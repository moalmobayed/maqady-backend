import { ApiProperty } from '@nestjs/swagger';

/** Seats per zone; wheelchair spaces count as seats, gaps do not. */
export class ZoneSeatCountsResponse {
  @ApiProperty({ type: 'integer', minimum: 0, example: 48, description: 'Seats in front rows.' })
  front!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 80, description: 'Seats in middle rows.' })
  middle!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 64, description: 'Seats in back rows.' })
  back!: number;
}
