import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { TEXT_LIMITS } from '../../catalog/catalog.constants';
import { GenreRefResponse } from '../../catalog/dto/genre-ref.response';
import { MovieCreditResponse } from '../../catalog/dto/movie-credit.response';
import { VideoResponse } from '../../catalog/dto/video.response';
import { MOVIE_PHOTO_KINDS } from '../../catalog/enums';
import type { AgeRating, MoviePhotoKind, PublicMovieStatus } from '../../catalog/types';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { ImageResponse } from '../../media/dto/image.response';
import { ShowtimeHallRefResponse } from '../../showtimes/dto/admin-showtime.response';
import { SHOWTIME_DAYS } from '../discovery.constants';
import { AGE_RATING_ENUM, MOVIE_STATUS_ENUM } from './movie-card.response';
import { ShowtimeTheaterRefResponse } from './public-showtime.response';

/** The next showtime of a movie today that can still be booked. */
@ApiSchema({ name: 'NextShow' })
export class NextShowResponse {
  @ApiProperty({ type: 'integer', example: 501, description: 'Showtime id.' })
  id!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-16T19:30:00+03:00',
    description: 'Start, Cairo time with offset.',
  })
  startsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-16',
    description: "Today's cinema date (06:00 to 06:00).",
  })
  cinemaDate!: string;

  @ApiProperty({ type: () => ShowtimeTheaterRefResponse, description: 'Where it plays.' })
  theater!: ShowtimeTheaterRefResponse;

  @ApiProperty({ type: () => ShowtimeHallRefResponse, description: 'The hall.' })
  hall!: ShowtimeHallRefResponse;

  @ApiProperty({ type: () => MoneyResponse, description: 'Its cheapest zone price.' })
  fromPrice!: MoneyResponse;
}

/** The side panel of a movie's page (PRD C3), from its showtimes still to start. */
@ApiSchema({ name: 'MovieShowtimeSummary' })
export class MovieShowtimeSummaryResponse {
  @ApiProperty({
    type: () => NextShowResponse,
    nullable: true,
    description:
      "Its next showtime of today's cinema date that hasn't started, at any theater; null when none is left today.",
  })
  nextShowToday!: NextShowResponse | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 3,
    description: `How many theaters have a showtime of it still to start in the next ${SHOWTIME_DAYS} cinema days.`,
  })
  cinemaCount!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: true,
    description: `"From EGP x": the lowest \`fromPrice\` among those showtimes; null when there are none (always for Coming soon).`,
  })
  fromPrice!: MoneyResponse | null;
}

/** A photo of a movie's media viewer: a still or a behind-the-scenes shot. */
@ApiSchema({ name: 'MoviePhoto' })
export class MoviePhotoResponse {
  @ApiProperty({ type: 'integer', example: 21, description: 'Photo id.' })
  id!: number;

  @ApiProperty({
    enum: MOVIE_PHOTO_KINDS,
    enumName: 'MoviePhotoKind',
    example: 'still',
    description: 'Still or Behind the scenes.',
  })
  kind!: MoviePhotoKind;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Youssef reads the logbook by lamplight',
    description: 'Caption, or null.',
  })
  caption!: string | null;

  @ApiProperty({
    type: () => ImageResponse,
    description: 'The photo in web sizes, in its own shape.',
  })
  image!: ImageResponse;
}

/** A public movie's page (PRD C3). */
@ApiSchema({ name: 'MovieDetails' })
export class MovieDetailsResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Movie id.' })
  id!: number;

  @ApiProperty({ type: String, example: 'The Last Lighthouse', description: 'Title.' })
  title!: string;

  @ApiProperty({ ...MOVIE_STATUS_ENUM, example: 'now_showing', description: 'Public status.' })
  status!: PublicMovieStatus;

  @ApiProperty({
    type: String,
    maxLength: TEXT_LIMITS.synopsis,
    example: 'A lighthouse keeper on the Red Sea coast finds a logbook that predicts the storms.',
    description: 'Synopsis.',
  })
  synopsis!: string;

  @ApiProperty({ type: 'integer', minimum: 1, example: 128, description: 'Runtime in minutes.' })
  runtimeMinutes!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-01',
    description: 'Release date, `YYYY-MM-DD`.',
  })
  releaseDate!: string;

  @ApiProperty({ ...AGE_RATING_ENUM, example: '12+', description: 'Age certificate.' })
  ageRating!: AgeRating;

  @ApiProperty({ type: String, nullable: true, example: 'Arabic', description: 'Language.' })
  language!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Egypt', description: 'Country.' })
  country!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Nile Light Pictures',
    description: 'Production company.',
  })
  productionCompany!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'EGP 48M',
    description: 'Budget as display text; show it only when not null.',
  })
  budgetLabel!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Marsa Alam, Red Sea',
    description: 'Filming locations; show them only when not null.',
  })
  filmingLocations!: string | null;

  @ApiProperty({
    type: () => [GenreRefResponse],
    description: 'Genres in display order; also the tag chips.',
  })
  genres!: GenreRefResponse[];

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Poster image (2:3), or null when none is set.',
  })
  poster!: ImageResponse | null;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description:
      'Backdrop: one of the photos, any shape; show it at 16:9 with a cover crop. Null when none is set.',
  })
  backdrop!: ImageResponse | null;

  @ApiProperty({
    type: () => VideoResponse,
    nullable: true,
    description: 'The hero video ("Watch trailer"), or null when none is set.',
  })
  heroVideo!: VideoResponse | null;

  @ApiProperty({ type: () => [VideoResponse], description: 'Every video, in display order.' })
  videos!: VideoResponse[];

  @ApiProperty({ type: () => [MoviePhotoResponse], description: 'Every photo, in display order.' })
  photos!: MoviePhotoResponse[];

  @ApiProperty({
    type: () => [MovieCreditResponse],
    description:
      'Cast and crew in display order. Group them by `role` for Director, Writers and Stars; each person links to `/movies?people=<id>`.',
  })
  credits!: MovieCreditResponse[];

  @ApiProperty({
    type: () => MovieShowtimeSummaryResponse,
    description:
      'The side panel: next show today, how many cinemas show it and the "from" price. The showtimes themselves are `GET /movies/{id}/showtimes`.',
  })
  showtimeSummary!: MovieShowtimeSummaryResponse;
}
