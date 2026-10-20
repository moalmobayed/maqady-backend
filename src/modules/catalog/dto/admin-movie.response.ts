import { ApiProperty } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';
import { AGE_RATINGS, MOVIE_STATUSES, PUBLISH_REQUIREMENTS } from '../enums';
import type { AgeRating, MovieStatus, PublishRequirement } from '../types';
import { AdminMoviePhotoResponse } from './admin-movie-photo.response';
import { AdminMovieVideoResponse } from './admin-movie-video.response';
import { GenreRefResponse } from './genre-ref.response';
import { MovieCreditResponse } from './movie-credit.response';
import { StaffRefResponse } from './staff-ref.response';

/** A movie as the admin editor shows it (PRD A2): every tab in one object. */
export class AdminMovieResponse {
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
    example: 'now_showing',
    description:
      '`draft` (admins only), `coming_soon` (listed, no sales), `now_showing` (bookable) or `archived` (hidden, history kept).',
  })
  status!: MovieStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'A lighthouse keeper on the Red Sea coast finds a logbook that predicts the storms.',
    description: 'Up to 600 characters.',
  })
  synopsis!: string | null;

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

  @ApiProperty({
    enum: AGE_RATINGS,
    enumName: 'AgeRating',
    nullable: false,
    example: '12+',
    description: 'Age certificate.',
  })
  ageRating!: AgeRating;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Arabic, English subtitles',
    description: 'Language.',
  })
  language!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Egypt', description: 'Country.' })
  country!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Nile Frame Studios',
    description: 'Production company.',
  })
  productionCompany!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'EGP 48M',
    description: 'Free-text budget label, shown as typed.',
  })
  budgetLabel!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Hurghada, Alexandria',
    description: 'Free-text filming locations.',
  })
  filmingLocations!: string | null;

  @ApiProperty({
    type: () => [GenreRefResponse],
    nullable: false,
    description: 'Genres in display order.',
  })
  genres!: GenreRefResponse[];

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Poster (2:3), or null when none is set.',
  })
  poster!: ImageResponse | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 21,
    description: 'The id of the photo used as backdrop, or null.',
  })
  backdropPhotoId!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 11,
    description: 'The id of the home hero video, or null.',
  })
  heroVideoId!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 5,
    example: 1,
    description: 'Home carousel position 1 to 5, or null when not featured.',
  })
  featuredPosition!: number | null;

  @ApiProperty({
    type: () => [AdminMoviePhotoResponse],
    nullable: false,
    description: 'Photos in display order.',
  })
  photos!: AdminMoviePhotoResponse[];

  @ApiProperty({
    type: () => [AdminMovieVideoResponse],
    nullable: false,
    description: 'YouTube videos in display order.',
  })
  videos!: AdminMovieVideoResponse[];

  @ApiProperty({
    type: () => [MovieCreditResponse],
    nullable: false,
    description: 'Cast and crew in display order.',
  })
  credits!: MovieCreditResponse[];

  @ApiProperty({
    enum: PUBLISH_REQUIREMENTS,
    enumName: 'PublishRequirement',
    isArray: true,
    nullable: false,
    example: ['synopsis', 'genres'],
    description:
      'What the movie still needs before it can be Coming soon or Now showing; empty when it can be published.',
  })
  publishBlockers!: PublishRequirement[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-01T10:00:00+03:00',
    description: 'When the movie was created.',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T15:10:00+03:00',
    description: 'When the movie, its media or its credits last changed ("Last edited").',
  })
  updatedAt!: string;

  @ApiProperty({
    type: () => StaffRefResponse,
    nullable: false,
    description: 'Who made the last change ("Last edited by").',
  })
  updatedBy!: StaffRefResponse;
}
