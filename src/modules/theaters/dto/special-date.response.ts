import { ApiProperty } from '@nestjs/swagger';

/** Holiday hours of one cinema date. */
export class SpecialDateResponse {
  @ApiProperty({ type: 'integer', example: 4, description: 'Special date id.' })
  id!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-06',
    description: 'The cinema date (06:00 to 06:00) whose weekly hours this replaces.',
  })
  cinemaDate!: string;

  @ApiProperty({ type: String, example: 'Armed Forces Day', description: 'Shown with the hours.' })
  label!: string;

  @ApiProperty({ type: Boolean, example: false, description: 'True when closed that day.' })
  closed!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '10:00',
    description: 'Opening time, `HH:mm`; null when closed.',
  })
  opens!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '03:00',
    description: 'Closing time, `HH:mm`; null when closed.',
  })
  closes!: string | null;

  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'True when `closes` is on the next calendar day.',
  })
  closesNextDay!: boolean;
}
