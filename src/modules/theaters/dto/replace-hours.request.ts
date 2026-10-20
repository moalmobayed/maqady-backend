import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  Max,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import type { IsoWeekday } from '../../../common/time/types';
import { IsClosesTime, IsOpensTime } from './validators';

/** The hours of one weekday of the cinema date. */
export class DayHoursRequest {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: 7,
    example: 5,
    description:
      'ISO weekday of the cinema date: 1 = Monday … 7 = Sunday. A cinema day runs from 06:00 to 06:00, so Friday night until 02:00 is Friday (5).',
  })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: IsoWeekday;

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
    example: '12:00',
    description: 'Opening time, `HH:mm` from 06:00 to 23:59, Cairo time. Required when open.',
  })
  @IsOpensTime()
  opens?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    example: '01:00',
    description:
      'Closing time, `HH:mm`, Cairo time. A time at or before 06:00 is on the next day ("next day" in the editor), so `01:00` after `12:00` closes at 01:00 the next morning. Must be after `opens`; required when open.',
  })
  @IsClosesTime()
  closes?: string;
}

/** `PUT /admin/theaters/{id}/hours`: the weekly hours, every weekday once. */
export class ReplaceHoursRequest {
  @ApiProperty({
    type: () => [DayHoursRequest],
    minItems: 7,
    maxItems: 7,
    description: 'Exactly 7 entries, one per weekday 1–7, in any order.',
  })
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DayHoursRequest)
  @ValidateBy({
    name: 'everyWeekdayOnce',
    validator: {
      validate: (days: unknown) =>
        Array.isArray(days) &&
        new Set(days.map((day) => (day as Partial<DayHoursRequest> | null)?.weekday)).size ===
          days.length,
      defaultMessage: () => 'days must name each weekday from 1 to 7 once',
    },
  })
  days!: DayHoursRequest[];
}
