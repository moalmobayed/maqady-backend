import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import {
  FEATURED_POSITION_MAX,
  FEATURED_POSITION_MIN,
  TEXT_LIMITS,
} from '../../catalog/catalog.constants';
import { GenreRefResponse } from '../../catalog/dto/genre-ref.response';
import { VideoResponse } from '../../catalog/dto/video.response';
import type { AgeRating, PublicMovieStatus } from '../../catalog/types';
import { ImageResponse } from '../../media/dto/image.response';
import { AGE_RATING_ENUM, MOVIE_STATUS_ENUM } from './movie-card.response';

/** The movie of a carousel slide (contract `FeaturedMovieDetails`). */
@ApiSchema({ name: 'FeaturedMovieDetails' })
export class FeaturedMovieDetailsResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Movie id.' })
  id!: number;

  @ApiProperty({ type: String, example: 'The Last Lighthouse', description: 'Title.' })
  title!: string;

  @ApiProperty({
    type: String,
    maxLength: TEXT_LIMITS.synopsis,
    example:
      'A lighthouse keeper on the Red Sea coast finds a logbook that predicts the storms before they arrive.',
    description: 'The full synopsis; clamp it to a few lines on the carousel',
  })
  synopsis!: string;

  @ApiProperty({ type: () => [GenreRefResponse], description: 'Genres in display order.' })
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

  @ApiProperty({ ...MOVIE_STATUS_ENUM, example: 'now_showing', description: 'Public status.' })
  status!: PublicMovieStatus;
}

/** One slide of the home carousel (contract `FeaturedMovie`). */
@ApiSchema({ name: 'FeaturedMovie' })
export class FeaturedMovieResponse {
  @ApiProperty({
    type: 'integer',
    minimum: FEATURED_POSITION_MIN,
    maximum: FEATURED_POSITION_MAX,
    example: 1,
    description: 'Carousel position the admin set, 1 first.',
  })
  position!: number;

  @ApiProperty({ type: () => FeaturedMovieDetailsResponse, description: 'The movie.' })
  movie!: FeaturedMovieDetailsResponse;

  @ApiProperty({
    type: () => VideoResponse,
    description: 'The hero video the slide plays muted and looping.',
  })
  heroVideo!: VideoResponse;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Backdrop image (16:9), or null when none is set',
  })
  backdrop!: ImageResponse | null;
}
