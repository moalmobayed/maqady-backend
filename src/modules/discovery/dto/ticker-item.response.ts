import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/** The movie of a ticker entry. */
export class TickerMovieRef {
  id!: number;
  title!: string;
}

/** The theater of a ticker showtime. */
export class TickerTheaterRef {
  id!: number;
  name!: string;
}

/** The next showtime of a ticker entry. */
export class TickerShowtimeRef {
  id!: number;
  startsAt!: string;
  cinemaDate!: string;
  theater!: TickerTheaterRef;
}

/**
 * One ticker entry of the home page (contract `TickerItem`): a Now showing movie with its next
 * bookable showtime today. The nested objects are inline in the contract, so they are written as
 * schemas here rather than as classes of their own.
 */
@ApiSchema({ name: 'TickerItem' })
export class TickerItemResponse {
  @ApiProperty({
    type: 'object',
    selfRequired: true,
    required: ['id', 'title'],
    properties: {
      id: { type: 'integer', example: 1, description: 'Movie id.' },
      title: { type: 'string', example: 'The Last Lighthouse', description: 'Title.' },
    },
    description: 'The movie.',
  })
  movie!: TickerMovieRef;

  @ApiProperty({
    type: 'object',
    selfRequired: true,
    required: ['id', 'startsAt', 'cinemaDate', 'theater'],
    properties: {
      id: { type: 'integer', example: 501, description: 'Showtime id.' },
      startsAt: {
        type: 'string',
        format: 'date-time',
        example: '2026-10-16T16:15:00+03:00',
        description: 'Start, Cairo time with offset.',
      },
      cinemaDate: {
        type: 'string',
        format: 'date',
        example: '2026-10-16',
        description: 'The cinema day (06:00 to 06:00) it belongs to.',
      },
      theater: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer', example: 1, description: 'Theater id.' },
          name: { type: 'string', example: 'Maqady Zamalek', description: 'Theater name.' },
        },
        description: 'Where it plays.',
      },
    },
    description: 'The next bookable showtime of the movie today, soonest first.',
  })
  nextShowtime!: TickerShowtimeRef;
}
