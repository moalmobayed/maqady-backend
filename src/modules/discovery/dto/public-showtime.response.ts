import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { ShowtimeHallRefResponse } from '../../showtimes/dto/admin-showtime.response';
import { ShowtimePricesResponse } from '../../showtimes/dto/showtime-prices.response';

/** A theater as a showtime list names it. */
@ApiSchema({ name: 'ShowtimeTheaterRef' })
export class ShowtimeTheaterRefResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Theater id.' })
  id!: number;

  @ApiProperty({ type: String, example: 'Maqady Zamalek', description: 'Name.' })
  name!: string;

  @ApiProperty({ type: String, example: 'Zamalek', description: 'District or area.' })
  district!: string;

  @ApiProperty({ type: String, example: 'Cairo', description: 'City.' })
  city!: string;
}

/**
 * A showtime as a customer's time chip shows it (PRD C3, C5): start and end, hall, the zone
 * prices and the "from" price, and whether it has started.
 */
@ApiSchema({ name: 'PublicShowtime' })
export class PublicShowtimeResponse {
  @ApiProperty({
    type: 'integer',
    example: 501,
    description: 'Showtime id, for the seat map (`/showtimes/{id}`).',
  })
  id!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-17T00:30:00+03:00',
    description:
      'Start, Cairo time with offset. Its calendar day can be the day after `cinemaDate`: name it on the chip ("00:30 Sat" under Friday).',
  })
  startsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-17T02:22:00+03:00',
    description: 'End (start plus the runtime), Cairo time with offset.',
  })
  endsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-16',
    description: 'The cinema day (06:00 to 06:00) it belongs to: a 00:30 show is the day before.',
  })
  cinemaDate!: string;

  @ApiProperty({ type: () => ShowtimeHallRefResponse, description: 'The hall.' })
  hall!: ShowtimeHallRefResponse;

  @ApiProperty({
    type: () => ShowtimePricesResponse,
    description: 'The price of a seat in each zone ("Prices vary by seat zone").',
  })
  prices!: ShowtimePricesResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    description: 'The cheapest zone price among the zones the hall has seats in ("From EGP x").',
  })
  fromPrice!: MoneyResponse;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      'True once it has started: show the Started state; it can no longer be booked. A showtime that has ended is not listed.',
  })
  hasStarted!: boolean;
}
