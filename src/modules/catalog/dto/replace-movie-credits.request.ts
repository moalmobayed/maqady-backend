import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_CREDITS, TEXT_LIMITS } from '../catalog.constants';
import { CREDIT_ROLES } from '../enums';
import type { CreditRole } from '../types';
import { CharacterNameForRole, TrimToNull, UniqueBy } from './catalog.validators';

/** One credit of a movie's cast and crew. */
export class MovieCreditRequest {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 4,
    description:
      'The person credited. An unknown id is `VALIDATION_FAILED` on `credits.<i>.personId`.',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  personId!: number;

  @ApiProperty({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    example: 'actor',
    description: 'Actor, Voice, Director, Writer, Producer, Cinematographer or Composer.',
  })
  @IsIn(CREDIT_ROLES)
  role!: CreditRole;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.characterName,
    example: 'Youssef, the keeper',
    description: 'The character played: only for `actor` and `voice`.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.characterName)
  @CharacterNameForRole()
  characterName?: string | null;
}

/** `PUT /admin/movies/{id}/credits`: the whole cast and crew, in display order. */
export class ReplaceMovieCreditsRequest {
  @ApiProperty({
    type: () => [MovieCreditRequest],
    maxItems: MAX_CREDITS,
    description:
      'Every credit of the movie, in display order (0 to 200). A person may appear in several roles, but each person and role once. `[]` removes every credit.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_CREDITS)
  @ValidateNested({ each: true })
  @Type(() => MovieCreditRequest)
  @UniqueBy(['personId', 'role'])
  credits!: MovieCreditRequest[];
}
