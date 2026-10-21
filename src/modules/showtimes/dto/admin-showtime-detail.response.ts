import { ApiProperty } from '@nestjs/swagger';
import { THEATER_STATUSES } from '../../theaters/enums';
import type { TheaterStatus } from '../../theaters/types';
import { AdminShowtimeResponse } from './admin-showtime.response';

/** The theater of a showtime. */
export class ShowtimeTheaterRefResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Theater id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Zamalek Cinema', description: 'Name.' })
  name!: string;

  @ApiProperty({
    enum: THEATER_STATUSES,
    enumName: 'TheaterStatus',
    nullable: false,
    example: 'active',
    description: 'Customers see showtimes of `active` theaters only.',
  })
  status!: TheaterStatus;
}

/** `GET /admin/showtimes/{id}`: the manage panel. */
export class AdminShowtimeDetailResponse extends AdminShowtimeResponse {
  @ApiProperty({ type: () => ShowtimeTheaterRefResponse, description: 'The theater.' })
  theater!: ShowtimeTheaterRefResponse;
}
