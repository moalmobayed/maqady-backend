import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { HallLayoutResponse } from '../../halls/dto/hall-layout.response';
import { ShowtimePricesResponse } from '../../showtimes/dto/showtime-prices.response';
import { HOLD_MINUTES, MAX_SEATS_PER_HOLD } from '../bookings.constants';
import { NOT_BOOKABLE_REASONS } from '../enums';
import type { NotBookableReason } from '../types';
import { BookingShowtimeResponse } from './booking-showtime.response';

/** The seat page (PRD C6): the showtime header, the hall's own layout, the zone prices. */
@ApiSchema({ name: 'ShowtimeSeatPage' })
export class PublicShowtimeResponse extends BookingShowtimeResponse {
  @ApiProperty({
    type: () => ShowtimePricesResponse,
    nullable: false,
    description: "The price of a seat in each zone; a hold prices each seat by its row's zone.",
  })
  prices!: ShowtimePricesResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'The lowest zone price among the zones this hall has seats in ("from EGP 150").',
  })
  fromPrice!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 192,
    description: 'Seats on sale: the seats of the layout (wheelchair spaces included, gaps not).',
  })
  seatCapacity!: number;

  @ApiProperty({
    type: () => HallLayoutResponse,
    nullable: false,
    description: "The hall's seat map: rows and their zones, wheelchair spaces, gaps and aisles.",
  })
  layout!: HallLayoutResponse;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description:
      'True when seats can be held now. False with `notBookableReason` otherwise; the map is still shown.',
  })
  bookable!: boolean;

  @ApiProperty({
    enum: NOT_BOOKABLE_REASONS,
    enumName: 'NotBookableReason',
    nullable: true,
    example: null,
    description:
      'Why seats cannot be held now, or null: `cancelled`; `started` ("Showtimes that have started can\'t be booked"); `sales_paused` by the theater; `movie_unavailable` (no longer Now showing); `hall_unavailable`.',
  })
  notBookableReason!: NotBookableReason | null;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: MAX_SEATS_PER_HOLD,
    description: 'The most seats one hold may have.',
  })
  maxSeatsPerHold!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: HOLD_MINUTES,
    description: 'How long a hold lasts, in minutes (never past the start).',
  })
  holdMinutes!: number;
}
