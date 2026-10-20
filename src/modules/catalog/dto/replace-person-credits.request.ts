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

/** One credit on a person's filmography. */
export class PersonCreditRequest {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 1,
    description: 'The movie. An unknown id is `VALIDATION_FAILED` on `credits.<i>.movieId`.',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  movieId!: number;

  @ApiProperty({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    example: 'director',
    description: 'Actor, Voice, Director, Writer, Producer, Cinematographer or Composer.',
  })
  @IsIn(CREDIT_ROLES)
  role!: CreditRole;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.characterName,
    example: null,
    description: 'The character played: only for `actor` and `voice`.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.characterName)
  @CharacterNameForRole()
  characterName?: string | null;
}

/** `PUT /admin/people/{id}/credits`: the person's whole filmography. */
export class ReplacePersonCreditsRequest {
  @ApiProperty({
    type: () => [PersonCreditRequest],
    maxItems: MAX_CREDITS,
    description:
      "Every credit of the person (0 to 200), each movie and role once. A credit that stays keeps its place in the movie's list; a new one goes last; one left out is removed. `[]` removes every credit.",
  })
  @IsArray()
  @ArrayMaxSize(MAX_CREDITS)
  @ValidateNested({ each: true })
  @Type(() => PersonCreditRequest)
  @UniqueBy(['movieId', 'role'])
  credits!: PersonCreditRequest[];
}
