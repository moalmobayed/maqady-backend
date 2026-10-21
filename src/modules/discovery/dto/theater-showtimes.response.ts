import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SHOWTIME_DAYS } from '../discovery.constants';
import { MovieCardResponse } from './movie-card.response';
import { PublicShowtimeResponse } from './public-showtime.response';

/** One movie's showtimes at the theater on one cinema date. */
@ApiSchema({ name: 'TheaterShowtimeMovie' })
export class TheaterShowtimeMovieResponse {
  @ApiProperty({ type: () => MovieCardResponse, description: 'The movie, as its card shows it.' })
  movie!: MovieCardResponse;

  @ApiProperty({
    type: () => [PublicShowtimeResponse],
    description: 'Its showtimes that day, by start time.',
  })
  showtimes!: PublicShowtimeResponse[];
}

/** One cinema date of a theater's showtimes. */
@ApiSchema({ name: 'TheaterShowtimeDay' })
export class TheaterShowtimeDayResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-16',
    description: 'The cinema date (06:00 to 06:00).',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: () => [TheaterShowtimeMovieResponse],
    description:
      'The movies showing that day, by their first showtime. Empty on a day without showtimes.',
  })
  movies!: TheaterShowtimeMovieResponse[];
}

/** `GET /theaters/{id}/showtimes`: the theater page's showtimes (PRD C5). */
@ApiSchema({ name: 'TheaterShowtimes' })
export class TheaterShowtimesResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Theater id.' })
  theaterId!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-16',
    description: "Today's cinema date.",
  })
  cinemaDate!: string;

  @ApiProperty({
    type: () => [TheaterShowtimeDayResponse],
    minItems: 1,
    maxItems: SHOWTIME_DAYS,
    description: `The ${SHOWTIME_DAYS} cinema days from today, or only the \`date\` asked for; days without showtimes included.`,
  })
  days!: TheaterShowtimeDayResponse[];
}
