import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { FEATURED_POSITION_MAX } from '../../catalog/catalog.constants';
import { FeaturedMovieResponse } from './featured-movie.response';
import { GENRE_WITH_COUNT_REF, type GenreWithCountResponse } from './genre-with-count.response';
import { MovieCardListResponse } from './movie-card.response';
import { TheaterCardResponse } from './theater-card.response';
import { TickerItemResponse } from './ticker-item.response';

/** Everything the customer home page shows, in one call (contract `HomeResponse`). */
@ApiSchema({ name: 'HomeResponse' })
export class HomeResponse {
  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-16T15:10:00+03:00',
    description: "The server's current time, for correcting the client clock",
  })
  serverTime!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-16',
    description: "Today's cinema day (06:00 to 06:00)",
  })
  cinemaDate!: string;

  @ApiProperty({
    type: () => [FeaturedMovieResponse],
    maxItems: FEATURED_POSITION_MAX,
    description: 'Up to 5 movies for the hero carousel, ordered by `position`.',
  })
  featured!: FeaturedMovieResponse[];

  @ApiProperty({
    type: () => [TickerItemResponse],
    description:
      'Now showing movies that still have a bookable showtime today, with that next showtime, soonest first.',
  })
  ticker!: TickerItemResponse[];

  @ApiProperty({
    type: 'array',
    items: { $ref: GENRE_WITH_COUNT_REF },
    description:
      'Every genre, alphabetical, with how many Now showing and Coming soon movies it has.',
  })
  genres!: GenreWithCountResponse[];

  @ApiProperty({
    type: () => MovieCardListResponse,
    description: 'Up to 12 Now showing movies, newest release first, plus the total.',
  })
  nowShowing!: MovieCardListResponse;

  @ApiProperty({
    type: () => MovieCardListResponse,
    description: 'Up to 12 Coming soon movies, soonest release first, plus the total.',
  })
  comingSoon!: MovieCardListResponse;

  @ApiProperty({
    type: () => [TheaterCardResponse],
    description: 'Every theater open for sales, alphabetical.',
  })
  cinemas!: TheaterCardResponse[];
}
