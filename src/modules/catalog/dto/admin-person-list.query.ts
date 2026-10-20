import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH } from '../catalog.constants';
import { ROLE_GROUPS } from '../enums';
import type { RoleGroup } from '../types';
import { Trim } from './catalog.validators';

/** `GET /admin/people?q=&roleGroup=&cursor=&limit=`. */
export class AdminPersonListQuery extends PageQuery {
  @ApiPropertyOptional({
    type: String,
    minLength: MIN_SEARCH_LENGTH,
    maxLength: MAX_SEARCH_LENGTH,
    example: 'fahm',
    description: 'People whose name contains this text (case-insensitive), 2 to 100 characters.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @Length(MIN_SEARCH_LENGTH, MAX_SEARCH_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    enum: ROLE_GROUPS,
    enumName: 'RoleGroup',
    example: 'actors',
    description:
      'Actors (actor, voice), Directors, Writers or Crew (producer, cinematographer, composer): people with a role in the group, set on them or from a credit.',
  })
  @IsOptional()
  @IsIn(ROLE_GROUPS)
  roleGroup?: RoleGroup;
}
