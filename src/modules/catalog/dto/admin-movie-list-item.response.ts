import { ApiProperty } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';
import { AGE_RATINGS, MOVIE_STATUSES } from '../enums';
import type { AgeRating, MovieStatus } from '../types';
import { GenreRefResponse } from './genre-ref.response';

/** A row of the admin movie list (PRD A2). */
export class AdminMovieListItemResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 1, description: 'Movie id.' })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'The Last Lighthouse',
    description: 'Title.',
  })
  title!: string;

  @ApiProperty({
    enum: MOVIE_STATUSES,
    enumName: 'CatalogMovieStatus',
    nullable: false,
    example: 'draft',
    description: 'The movie status.',
  })
  status!: MovieStatus;

  @ApiProperty({
    enum: AGE_RATINGS,
    enumName: 'AgeRating',
    nullable: false,
    example: '12+',
    description: 'Age certificate.',
  })
  ageRating!: AgeRating;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 128,
    description: 'Runtime in minutes.',
  })
  runtimeMinutes!: number | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-01',
    description: 'Release date.',
  })
  releaseDate!: string | null;

  @ApiProperty({ type: () => [GenreRefResponse], nullable: false, description: 'Genres in order.' })
  genres!: GenreRefResponse[];

  @ApiProperty({ type: () => ImageResponse, nullable: true, description: 'Poster, or null.' })
  poster!: ImageResponse | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'Home carousel position, or null.',
  })
  featuredPosition!: number | null;

  @ApiProperty({ type: 'integer', nullable: false, example: 6, description: 'How many photos.' })
  photoCount!: number;

  @ApiProperty({ type: 'integer', nullable: false, example: 2, description: 'How many videos.' })
  videoCount!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 14,
    description: 'How many cast and crew credits.',
  })
  creditCount!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T15:10:00+03:00',
    description: 'Last change.',
  })
  updatedAt!: string;
}
