import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IMDB_HOSTS, INSTAGRAM_HOSTS, TEXT_LIMITS } from '../catalog.constants';
import { CREDIT_ROLES } from '../enums';
import type { CreditRole } from '../types';
import { IsCalendarDate, IsHttpsUrlOn, OptionalNotNull, TrimToNull } from './catalog.validators';

/**
 * The optional details shared by `POST /admin/people` and `PATCH /admin/people/{id}`. Text is
 * trimmed; an optional text sent empty is stored as null, and null clears a field.
 */
export class PersonDetailsFields {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '1984-03-12',
    description: 'Birth date, `YYYY-MM-DD`, not in the future.',
  })
  @IsOptional()
  @IsCalendarDate()
  birthDate?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.birthPlace,
    example: 'Alexandria, Egypt',
    description: 'Birth place.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.birthPlace)
  birthPlace?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.nationality,
    example: 'Egyptian',
    description: 'Nationality.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.nationality)
  nationality?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.bio,
    example: 'Stage actor turned screen lead, known for quiet, coastal dramas.',
    description: 'Short biography, up to 400 characters.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.bio)
  bio?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uri',
    nullable: true,
    maxLength: TEXT_LIMITS.url,
    example: 'https://www.instagram.com/example.actor',
    description: 'An https link on instagram.com.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.url)
  @IsHttpsUrlOn(INSTAGRAM_HOSTS)
  instagramUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uri',
    nullable: true,
    maxLength: TEXT_LIMITS.url,
    example: 'https://www.imdb.com/name/nm0000001/',
    description: 'An https link on imdb.com.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.url)
  @IsHttpsUrlOn(IMDB_HOSTS)
  imdbUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uri',
    nullable: true,
    maxLength: TEXT_LIMITS.url,
    example: 'https://example-actor.com',
    description: 'Any https link.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.url)
  @IsHttpsUrlOn(null)
  websiteUrl?: string | null;

  @ApiPropertyOptional({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    isArray: true,
    uniqueItems: true,
    example: ['actor'],
    description:
      'The roles shown on the person even without credits; replaces the set. Credited roles are reported separately (`creditedRoles`).',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(CREDIT_ROLES.length)
  @ArrayUnique()
  @IsIn(CREDIT_ROLES, { each: true })
  roles?: CreditRole[];
}
