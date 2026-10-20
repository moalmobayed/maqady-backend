import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDefined, IsString, Length, ValidateIf } from 'class-validator';
import { TEXT_LIMITS } from '../theaters.constants';
import { IsCalendarDate, IsClosesTime, IsOpensTime, Trim } from './validators';

const FIELDS = ['cinemaDate', 'label', 'closed', 'opens', 'closes'] as const;
const sent = (_: object, value: unknown): boolean => value !== undefined;

/**
 * `PATCH /admin/theaters/{id}/special-dates/{specialDateId}`: any field. Times left out keep
 * their stored value, and the hours that result are checked as a whole: opening a closed day
 * needs both times.
 */
export class UpdateSpecialDateRequest {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-06',
    description: "Moves the special date to another cinema date: today's or later, and free.",
  })
  @ValidateIf((body: UpdateSpecialDateRequest) =>
    FIELDS.every((field) => body[field] === undefined) ? true : body.cinemaDate !== undefined,
  )
  @IsDefined({ message: 'send at least one field to change' })
  @IsCalendarDate()
  cinemaDate?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.specialDateLabel.min,
    maxLength: TEXT_LIMITS.specialDateLabel.max,
    example: 'Armed Forces Day',
    description: 'Trimmed.',
  })
  @ValidateIf(sent)
  @Trim()
  @IsString()
  @Length(TEXT_LIMITS.specialDateLabel.min, TEXT_LIMITS.specialDateLabel.max)
  label?: string;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: false,
    example: true,
    description: 'True closes the theater that day (leave out the times); false opens it.',
  })
  @ValidateIf(sent)
  @IsBoolean()
  closed?: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    example: '11:00',
    description: 'Opening time, `HH:mm` from 06:00 to 23:59.',
  })
  @IsOpensTime({ optional: true })
  opens?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    example: '02:00',
    description: 'Closing time, `HH:mm`; at or before 06:00 is the next day.',
  })
  @IsClosesTime({ optional: true })
  closes?: string;
}
