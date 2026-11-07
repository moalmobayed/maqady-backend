import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { MY_BOOKINGS_TABS } from '../enums';
import type { MyBookingsTab } from '../types';

/** `GET /me/bookings?tab=&cursor=&limit=` (PRD C10). */
export class MyBookingsQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: MY_BOOKINGS_TABS,
    enumName: 'MyBookingsTab',
    default: 'upcoming',
    example: 'upcoming',
    description:
      '`upcoming`: confirmed bookings whose showtime has not ended, soonest first. `past`: completed, refunded and failed bookings, most recent show first. Default `upcoming`.',
  })
  @IsOptional()
  @IsIn(MY_BOOKINGS_TABS)
  tab?: MyBookingsTab;
}
