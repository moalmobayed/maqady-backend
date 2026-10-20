import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsString, Length } from 'class-validator';
import { TEXT_LIMITS } from '../theaters.constants';
import { IsCalendarDate, IsClosesTime, IsOpensTime, Trim } from './validators';

/** `POST /admin/theaters/{id}/special-dates`: holiday hours for one cinema date. */
export class CreateSpecialDateRequest {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-06',
    description:
      "The cinema date (06:00 to 06:00) whose weekly hours this replaces. Today's cinema date or later; one special date per date (`CONFLICT` otherwise).",
  })
  @IsCalendarDate()
  cinemaDate!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.specialDateLabel.min,
    maxLength: TEXT_LIMITS.specialDateLabel.max,
    example: 'Armed Forces Day',
    description: 'Shown with the hours on the theater page. Trimmed.',
  })
  @Trim()
  @IsString()
  @Length(TEXT_LIMITS.specialDateLabel.min, TEXT_LIMITS.specialDateLabel.max)
  label!: string;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description: 'True when the theater is closed that day; then leave out `opens` and `closes`.',
  })
  @IsBoolean()
  closed!: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    example: '10:00',
    description: 'Opening time, `HH:mm` from 06:00 to 23:59. Required when open.',
  })
  @IsOpensTime()
  opens?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    example: '03:00',
    description:
      'Closing time, `HH:mm`; at or before 06:00 is the next day. After `opens`; required when open.',
  })
  @IsClosesTime()
  closes?: string;
}
