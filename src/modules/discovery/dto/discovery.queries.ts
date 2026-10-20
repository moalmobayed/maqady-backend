import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH } from '../../catalog/catalog.constants';
import { PUBLIC_MOVIE_STATUSES, ROLE_GROUPS } from '../../catalog/enums';
import type { PublicMovieStatus, RoleGroup } from '../../catalog/types';
import { GENRE_SLUG_PATTERN, MAX_GENRES_FILTER, MAX_PEOPLE_FILTER } from '../discovery.constants';
import { CommaSeparated, CommaSeparatedIds, QueryBoolean, TrimQuery } from './discovery.transforms';

/** `GET /genres?status=&cursor=&limit=`. */
export class GenreListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: PUBLIC_MOVIE_STATUSES,
    enumName: 'MovieStatus',
    example: 'now_showing',
    description:
      'Count only the movies of this tab (the Movies page). Without it, `movieCount` counts Now showing plus Coming soon.',
  })
  @IsOptional()
  @IsIn(PUBLIC_MOVIE_STATUSES)
  status?: PublicMovieStatus;
}

/** `GET /movies?status=&genres=&q=&people=&cursor=&limit=` (PRD C2). */
export class MovieListQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: PUBLIC_MOVIE_STATUSES,
    enumName: 'MovieStatus',
    default: 'now_showing',
    example: 'now_showing',
    description:
      'The tab: Now showing (newest release first) or Coming soon (soonest release first). Default `now_showing`.',
  })
  @IsOptional()
  @IsIn(PUBLIC_MOVIE_STATUSES)
  status?: PublicMovieStatus;

  @ApiPropertyOptional({
    type: String,
    example: 'drama,sci-fi',
    description: `Genre slugs, comma-separated (at most ${MAX_GENRES_FILTER}): movies in any of them; empty is no filter. An unknown slug is \`VALIDATION_FAILED\`.`,
  })
  @CommaSeparated()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GENRES_FILTER)
  @IsString({ each: true })
  @Matches(GENRE_SLUG_PATTERN, { each: true, message: 'each genre must be a genre slug' })
  genres?: string[];

  @ApiPropertyOptional({
    type: String,
    minLength: MIN_SEARCH_LENGTH,
    maxLength: MAX_SEARCH_LENGTH,
    example: 'light',
    description:
      'Movies whose title or a credited person’s name contains this text (case-insensitive), 2 to 100 characters.',
  })
  @TrimQuery()
  @IsOptional()
  @IsString()
  @Length(MIN_SEARCH_LENGTH, MAX_SEARCH_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    example: '4,9',
    description: `Person ids, comma-separated (at most ${MAX_PEOPLE_FILTER}): movies crediting any of them; empty is no filter (the cast filter, and the links from a movie's credits).`,
  })
  @CommaSeparatedIds()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PEOPLE_FILTER)
  @IsInt({ each: true, message: 'each person must be a person id' })
  @Min(1, { each: true })
  @Max(Number.MAX_SAFE_INTEGER, { each: true })
  people?: number[];
}

/** `GET /people?q=&roleGroup=&cursor=&limit=`. */
export class PublicPersonListQuery extends PageQuery {
  @ApiPropertyOptional({
    type: String,
    minLength: MIN_SEARCH_LENGTH,
    maxLength: MAX_SEARCH_LENGTH,
    example: 'fahm',
    description: 'People whose name contains this text (case-insensitive), 2 to 100 characters.',
  })
  @TrimQuery()
  @IsOptional()
  @IsString()
  @Length(MIN_SEARCH_LENGTH, MAX_SEARCH_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    enum: ROLE_GROUPS,
    enumName: 'RoleGroup',
    example: 'actors',
    description:
      'Actors (actor, voice), Directors, Writers or Crew (producer, cinematographer, composer).',
  })
  @IsOptional()
  @IsIn(ROLE_GROUPS)
  roleGroup?: RoleGroup;
}

/** `GET /theaters?openNow=&parking=&cursor=&limit=` (PRD C4). */
export class PublicTheaterListQuery extends PageQuery {
  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description: '`true`: only theaters open right now (judged by the cinema day).',
  })
  @QueryBoolean()
  @IsOptional()
  @IsBoolean()
  openNow?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description: '`true`: only theaters with free or valet parking.',
  })
  @QueryBoolean()
  @IsOptional()
  @IsBoolean()
  parking?: boolean;
}
