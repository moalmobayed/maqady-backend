import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SHOWTIME_DAYS } from '../discovery.constants';
import { PublicShowtimeResponse, ShowtimeTheaterRefResponse } from './public-showtime.response';

/** One theater's showtimes of the movie on one cinema date. */
@ApiSchema({ name: 'MovieShowtimeTheater' })
export class MovieShowtimeTheaterResponse {
  @ApiProperty({ type: () => ShowtimeTheaterRefResponse, description: 'The theater.' })
  theater!: ShowtimeTheaterRefResponse;

  @ApiProperty({
    type: () => [PublicShowtimeResponse],
    description: 'Its showtimes that day, by start time.',
  })
  showtimes!: PublicShowtimeResponse[];
}

/** One cinema date of a movie's showtimes. */
@ApiSchema({ name: 'MovieShowtimeDay' })
export class MovieShowtimeDayResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-16',
    description: 'The cinema date (06:00 to 06:00).',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 6,
    description: 'How many showtimes the day lists, every theater together.',
  })
  showtimeCount!: number;

  @ApiProperty({
    type: () => [MovieShowtimeTheaterResponse],
    description:
      'The theaters showing it that day, alphabetical. Empty on a day without showtimes.',
  })
  theaters!: MovieShowtimeTheaterResponse[];
}

/** A theater of the theater picker, with how many showtimes of the movie it lists. */
@ApiSchema({ name: 'MovieShowtimeTheaterCount' })
export class MovieShowtimeTheaterCountResponse extends ShowtimeTheaterRefResponse {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 9,
    description: `Its showtimes of the movie over the ${SHOWTIME_DAYS} days.`,
  })
  showtimeCount!: number;
}

/** `GET /movies/{id}/showtimes`: the movie page's showtimes (PRD C3). */
@ApiSchema({ name: 'MovieShowtimes' })
export class MovieShowtimesResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Movie id.' })
  movieId!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-16',
    description: "Today's cinema date (the first day).",
  })
  cinemaDate!: string;

  @ApiProperty({
    type: () => [MovieShowtimeTheaterCountResponse],
    description: `The theater picker: every theater with a listed showtime in the ${SHOWTIME_DAYS} days, alphabetical, with its count.`,
  })
  theaters!: MovieShowtimeTheaterCountResponse[];

  @ApiProperty({
    type: () => [MovieShowtimeDayResponse],
    minItems: SHOWTIME_DAYS,
    maxItems: SHOWTIME_DAYS,
    description: `Exactly ${SHOWTIME_DAYS} cinema days, today first, days without showtimes included.`,
  })
  days!: MovieShowtimeDayResponse[];
}
