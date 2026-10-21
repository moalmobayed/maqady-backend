import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { SHOWTIME_STATUSES } from '../enums';
import type { ShowtimeStatus } from '../types';
import { IsCinemaDate } from './showtime.validators';

/** `GET /admin/showtimes?theaterId=&date=&hallId=&status=&cursor=&limit=`. */
export class TimelineQuery extends PageQuery {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 1,
    description: 'The theater whose timeline to show.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  theaterId!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'The cinema date, `YYYY-MM-DD`. A cinema day runs from 06:00 to 06:00, so a showtime at 00:30 on 17 Oct is on the 16 Oct timeline.',
  })
  @IsCinemaDate()
  date!: string;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 3,
    description: 'Only showtimes in this hall.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  hallId?: number;

  @ApiPropertyOptional({
    enum: SHOWTIME_STATUSES,
    enumName: 'ShowtimeStatus',
    nullable: false,
    example: 'scheduled',
    description: 'Only showtimes in this status. Both are listed by default.',
  })
  @IsOptional()
  @IsIn(SHOWTIME_STATUSES)
  status?: ShowtimeStatus;
}
