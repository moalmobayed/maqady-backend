import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_GENRES_PER_MOVIE, MAX_RUNTIME_MINUTES, TEXT_LIMITS } from '../catalog.constants';
import { AGE_RATINGS } from '../enums';
import type { AgeRating } from '../types';
import { IsCalendarDate, TrimToNull } from './catalog.validators';

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
  @IsOptional()
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
    type: 'integer',
    isArray: true,
    maxItems: MAX_GENRES_PER_MOVIE,
    uniqueItems: true,
    example: [7, 5],
    description:
      'Genre ids, at most 5, in display order: the first is the genre Now showing cards show. Replaces the whole list; `[]` clears it. At least one is required before publishing. An unknown id is `VALIDATION_FAILED` on `genreIds`.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GENRES_PER_MOVIE)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(Number.MAX_SAFE_INTEGER, { each: true })
  genreIds?: number[];
}
