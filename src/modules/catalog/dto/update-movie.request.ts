import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { FEATURED_POSITION_MAX, FEATURED_POSITION_MIN, TEXT_LIMITS } from '../catalog.constants';
import { MOVIE_STATUSES } from '../enums';
import type { MovieStatus } from '../types';
import { noneSent, Trim } from './catalog.validators';
import { MovieDetailsFields } from './movie-fields';

/** Every field `PATCH /admin/movies/{id}` accepts; at least one must be sent. */
const UPDATE_MOVIE_FIELDS = [
  'title',
  'synopsis',
  'runtimeMinutes',
  'releaseDate',
  'ageRating',
  'language',
  'country',
  'productionCompany',
  'budgetLabel',
  'filmingLocations',
  'genreIds',
  'status',
  'featuredPosition',
  'heroVideoId',
  'backdropPhotoId',
] as const;

/**
 * `PATCH /admin/movies/{id}`: any of the details, plus the publishing fields (status, carousel
 * position, hero video, backdrop). Absent fields stay; null clears a nullable one.
 */
export class UpdateMovieRequest extends MovieDetailsFields {
  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: TEXT_LIMITS.title,
    example: 'The Last Lighthouse',
    description: 'The title, 1 to 200 characters after trimming. Not nullable.',
  })
  // Validated when sent, and when nothing is sent, so an empty body names a field.
  @ValidateIf(
    (body: UpdateMovieRequest) => body.title !== undefined || noneSent(body, UPDATE_MOVIE_FIELDS),
  )
  @IsDefined({ message: 'send at least one field to change' })
  @Trim()
  @IsString()
  @Length(1, TEXT_LIMITS.title)
  title?: string;

  @ApiPropertyOptional({
    enum: MOVIE_STATUSES,
    enumName: 'CatalogMovieStatus',
    example: 'now_showing',
    description:
      "`draft` (admins only), `coming_soon` (listed, no sales), `now_showing` (bookable) or `archived` (hidden, history kept). Allowed changes: draft → coming soon, now showing or archived; coming soon → draft, now showing or archived; now showing → archived; archived → coming soon or now showing. Anything else is `CONFLICT` with `details.from` and `details.to`. Coming soon and Now showing need a synopsis, runtime, release date and a genre (`MOVIE_NOT_PUBLISHABLE`). Moving to draft or archived frees the movie's carousel position.",
  })
  @IsOptional()
  @IsIn(MOVIE_STATUSES)
  status?: MovieStatus;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: FEATURED_POSITION_MIN,
    maximum: FEATURED_POSITION_MAX,
    example: 1,
    description:
      'Home carousel position 1 to 5, or null to unfeature. A featured movie must be Coming soon or Now showing and have a hero video (`MOVIE_NOT_FEATURABLE`); a position another movie holds is `FEATURED_POSITION_TAKEN`.',
  })
  @IsOptional()
  @IsInt()
  @Min(FEATURED_POSITION_MIN)
  @Max(FEATURED_POSITION_MAX)
  featuredPosition?: number | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    example: 11,
    description:
      "The home carousel's hero video: one of this movie's videos, any type, or null. Another movie's video is `VALIDATION_FAILED`; null on a featured movie is `MOVIE_NOT_FEATURABLE`.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  heroVideoId?: number | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    example: 21,
    description:
      "The backdrop, picked from this movie's photos, or null. It must be 16:9 (within 2 %) and at least 1280 × 720, else `IMAGE_WRONG_SHAPE`; another movie's photo is `VALIDATION_FAILED`.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  backdropPhotoId?: number | null;
}
