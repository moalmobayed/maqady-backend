import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_GENRES_PER_MOVIE,
  MAX_MOVIE_RATING,
  MAX_RUNTIME_MINUTES,
  MOVIE_RATING_DECIMALS,
  TEXT_LIMITS,
} from '../catalog.constants';
import { AGE_RATINGS } from '../enums';
import type { AgeRating } from '../types';
import { IsCalendarDate, OptionalNotNull, TrimToNull } from './catalog.validators';

/**
 * The optional details shared by `POST /admin/movies` and `PATCH /admin/movies/{id}`. Text is
 * trimmed; an optional text sent empty is stored as null, and null clears a field.
 */
export class MovieDetailsFields {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.synopsis,
    example:
      'A lighthouse keeper on the Red Sea coast finds a logbook that predicts the storms before they arrive.',
    description: 'Up to 600 characters. Required before the movie is published.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.synopsis)
  synopsis?: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: MAX_RUNTIME_MINUTES,
    example: 128,
    description: 'Runtime in minutes, 1 to 600. Required before the movie is published.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RUNTIME_MINUTES)
  runtimeMinutes?: number | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-01',
    description: 'Release date, `YYYY-MM-DD`. Required before the movie is published.',
  })
  @IsOptional()
  @IsCalendarDate()
  releaseDate?: string | null;

  @ApiPropertyOptional({
    enum: AGE_RATINGS,
    enumName: 'AgeRating',
    example: '12+',
    description:
      'Shown on the movie page, tickets and at the cinema entrance. A new movie defaults to `12+`.',
  })
  @OptionalNotNull()
  @IsIn(AGE_RATINGS)
  ageRating?: AgeRating;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.language,
    example: 'Arabic, English subtitles',
    description: 'Spoken language and subtitles, as customers read it.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.language)
  language?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.country,
    example: 'Egypt',
    description: 'Country of production.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.country)
  country?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.productionCompany,
    example: 'Nile Frame Studios',
    description: 'Production company.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.productionCompany)
  productionCompany?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.budgetLabel,
    example: 'EGP 48M',
    description:
      'Optional free text shown as typed, for example "EGP 48M"; never parsed or added up (PRD call 5). Customers see it only when set.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.budgetLabel)
  budgetLabel?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.filmingLocations,
    example: 'Hurghada, Alexandria',
    description: 'Optional free text; customers see it only when set.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.filmingLocations)
  filmingLocations?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: MAX_MOVIE_RATING,
    example: 8.4,
    description:
      'The rating score customers see on the movie page with a star: 0 to 10 with at most one decimal (8.4), typed from an outside source. Null clears it (clear `ratingSource` with it). More decimals, text or a value outside 0 to 10 is `VALIDATION_FAILED`.',
  })
  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: MOVIE_RATING_DECIMALS },
    { message: 'rating must be a number with at most one decimal place' },
  )
  @Min(0)
  @Max(MAX_MOVIE_RATING)
  rating?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.ratingSource,
    example: 'elCinema users',
    description:
      'Where the score comes from, shown small under it. Up to 80 characters; empty text is null, and null shows the score alone. Needs a rating on the movie: a source without one is `VALIDATION_FAILED` on `ratingSource`.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.ratingSource)
  ratingSource?: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    isArray: true,
    maxItems: MAX_GENRES_PER_MOVIE,
    uniqueItems: true,
    example: [7, 5],
    description:
      'Genre ids, at most 5, in display order: the first is the genre Now showing cards show. Replaces the whole list; `[]` clears it. At least one is required before publishing. An unknown id is `VALIDATION_FAILED` on `genreIds`.',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_GENRES_PER_MOVIE)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(Number.MAX_SAFE_INTEGER, { each: true })
  genreIds?: number[];
}
