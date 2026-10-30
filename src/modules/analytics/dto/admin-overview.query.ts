import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsCinemaDate } from '../../showtimes/dto/showtime.validators';
import { OVERVIEW_PERIODS } from '../enums';
import type { OverviewPeriodPreset } from '../types';

/**
 * `GET /admin/overview?period=&dateFrom=&dateTo=&theaterId=` (PRD A1 "Period: Today, 7 days, 30
 * days, in cinema days. Scope: all theaters or one."). Either a preset or dates, not both.
 */
export class AdminOverviewQuery {
  @ApiPropertyOptional({
    enum: OVERVIEW_PERIODS,
    enumName: 'OverviewPeriodPreset',
    nullable: false,
    example: '7d',
    description:
      'The period picker: `today` (today\'s cinema day), `7d` or `30d` (that many cinema days ending today). The server decides "today" (06:00 to 06:00 Cairo time), so a 01:00 visit still reads yesterday\'s cinema day. Not with `dateFrom` / `dateTo`. With neither, the last 7 cinema days.',
  })
  @IsOptional()
  @IsIn(OVERVIEW_PERIODS)
  period?: OverviewPeriodPreset;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-10',
    description:
      'Instead of `period`: the first cinema date (`YYYY-MM-DD`). Omitted with `dateTo`: 6 days before it. Showtimes on this cinema date and later count.',
  })
  @IsOptional()
  @IsCinemaDate()
  dateFrom?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'Instead of `period`: the last cinema date, inclusive. Omitted: today. Not before `dateFrom`; at most 366 days in all.',
  })
  @IsOptional()
  @IsCinemaDate()
  dateTo?: string;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 1,
    description:
      'The scope: one theater (its showtimes only, and `byHall`). Omitted: all theaters. An unknown id is `NOT_FOUND`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  theaterId?: number;
}
