import { ApiProperty } from '@nestjs/swagger';

/** A theater's hours on today's cinema date, for the admin list's "today" column. */
export class TodayHoursResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-16',
    description: "Today's cinema date (06:00 to 06:00).",
  })
  cinemaDate!: string;

  @ApiProperty({
    type: Boolean,
    example: false,
    description: 'True when closed today, or when no hours are set yet.',
  })
  closed!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '12:00',
    description: 'Opening time, `HH:mm`; null when closed.',
  })
  opens!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '01:00',
    description: 'Closing time, `HH:mm`; null when closed.',
  })
  closes!: string | null;

  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'True when `closes` is on the next calendar day.',
  })
  closesNextDay!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: "The special date's label when one sets today's hours, else null.",
  })
  specialDateLabel!: string | null;
}
