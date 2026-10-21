import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH } from '../catalog.constants';
import { MOVIE_STATUSES } from '../enums';
import type { MovieStatus } from '../types';
import { Trim } from './catalog.validators';

/** `GET /admin/movies?q=&status=&cursor=&limit=`. */
export class AdminMovieListQuery extends PageQuery {
  @ApiPropertyOptional({
    type: String,
    minLength: MIN_SEARCH_LENGTH,
    maxLength: MAX_SEARCH_LENGTH,
    example: 'lighth',
    description:
      'Search: movies whose title, or the name of a credited person, contains this text (case-insensitive). 2 to 100 characters after trimming.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @Length(MIN_SEARCH_LENGTH, MAX_SEARCH_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    enum: MOVIE_STATUSES,
    enumName: 'CatalogMovieStatus',
    example: 'draft',
    description: 'Only movies in this status. `statusCounts` ignores it.',
  })
  @IsOptional()
  @IsIn(MOVIE_STATUSES)
  status?: MovieStatus;
}
