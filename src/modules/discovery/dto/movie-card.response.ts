import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { GenreRefResponse } from '../../catalog/dto/genre-ref.response';
import { AGE_RATINGS, PUBLIC_MOVIE_STATUSES } from '../../catalog/enums';
import type { AgeRating, PublicMovieStatus } from '../../catalog/types';
import { ImageResponse } from '../../media/dto/image.response';
import { HOME_LIST_LIMIT } from '../discovery.constants';

/** The enum options of a public movie status (contract `MovieStatus`). */
export const MOVIE_STATUS_ENUM = {
  enum: PUBLIC_MOVIE_STATUSES,
  enumName: 'MovieStatus',
} as const;

/** The enum options of an age certificate (contract `AgeRating`, published by U6). */
export const AGE_RATING_ENUM = { enum: AGE_RATINGS, enumName: 'AgeRating' } as const;

/**
 * A movie card (contract `MovieCard`): the home page's Now showing and Coming soon rows, the
 * Movies page and "More like this". Public movies only.
 */
@ApiSchema({
  name: 'MovieCard',
  description: 'A public movie as its card shows it: poster, title, genres, runtime, rating.',
})
export class MovieCardResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Movie id.' })
  id!: number;

  @ApiProperty({ type: String, example: 'The Last Lighthouse', description: 'Title.' })
  title!: string;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Poster image (2:3), or null when none is set',
  })
  poster!: ImageResponse | null;

  @ApiProperty({
    type: () => [GenreRefResponse],
    description: 'In display order; the first one is the "first genre" shown on Now showing cards',
  })
  genres!: GenreRefResponse[];

  @ApiProperty({ type: 'integer', minimum: 1, example: 128, description: 'Runtime in minutes.' })
  runtimeMinutes!: number;

  @ApiProperty({ ...AGE_RATING_ENUM, example: '12+', description: 'Age certificate.' })
  ageRating!: AgeRating;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-01',
    description: 'Release date, `YYYY-MM-DD`.',
  })
  releaseDate!: string;

  @ApiProperty({
    ...MOVIE_STATUS_ENUM,
    example: 'now_showing',
    description: 'Now showing (bookable) or Coming soon (listed, no sales; show a "Soon" badge).',
  })
  status!: PublicMovieStatus;
}

/** The first movies of a home page row and the size of the whole list (contract `MovieCardList`). */
@ApiSchema({ name: 'MovieCardList' })
export class MovieCardListResponse {
  @ApiProperty({
    type: () => [MovieCardResponse],
    maxItems: HOME_LIST_LIMIT,
    description: `Up to ${HOME_LIST_LIMIT} movies, in the row's order.`,
  })
  items!: MovieCardResponse[];

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 9,
    description: 'How many movies the full list (Movies page) has',
  })
  total!: number;
}
