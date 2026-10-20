import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { THEATER_STATUSES } from '../enums';
import { TEXT_LIMITS } from '../theaters.constants';
import type { TheaterStatus } from '../types';
import { Trim } from './validators';

const NOTHING_TO_CHANGE = 'send at least one field to change';

const FIELDS = [
  'name',
  'address',
  'district',
  'city',
  'latitude',
  'longitude',
  'transitInfo',
  'parkingInfo',
  'email',
  'showContactsPublic',
  'status',
] as const;

/** A field that may be left out but not set to null. */
const sent = (_: object, value: unknown): boolean => value !== undefined;

/**
 * `PATCH /admin/theaters/{id}`: any field of `CreateTheaterRequest`, and `status`. The fields
 * apply first, then the status change, in one transaction.
 */
export class UpdateTheaterRequest {
  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.name.min,
    maxLength: TEXT_LIMITS.name.max,
    example: 'Maqady Zamalek',
    description: 'Unique among theaters, ignoring letter case (`CONFLICT` when taken). Trimmed.',
  })
  // Validated when sent, and when nothing at all is sent, so an empty body names a field.
  @ValidateIf((body: UpdateTheaterRequest) =>
    FIELDS.every((field) => body[field] === undefined) ? true : body.name !== undefined,
  )
  @IsDefined({ message: NOTHING_TO_CHANGE })
  @Trim()
  @IsString()
  @Length(TEXT_LIMITS.name.min, TEXT_LIMITS.name.max)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.address.min,
    maxLength: TEXT_LIMITS.address.max,
    example: '26 July Street, Zamalek',
    description: 'Street address. Trimmed.',
  })
  @ValidateIf(sent)
  @Trim()
  @IsString()
  @Length(TEXT_LIMITS.address.min, TEXT_LIMITS.address.max)
  address?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.district.min,
    maxLength: TEXT_LIMITS.district.max,
    example: 'Zamalek',
    description: 'District or area. Trimmed.',
  })
  @ValidateIf(sent)
  @Trim()
  @IsString()
  @Length(TEXT_LIMITS.district.min, TEXT_LIMITS.district.max)
  district?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.city.min,
    maxLength: TEXT_LIMITS.city.max,
    example: 'Cairo',
    description: 'City. Trimmed.',
  })
  @ValidateIf(sent)
  @Trim()
  @IsString()
  @Length(TEXT_LIMITS.city.min, TEXT_LIMITS.city.max)
  city?: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: false,
    minimum: -90,
    maximum: 90,
    example: 30.0609,
    description: 'Decimal degrees, at most 6 decimals.',
  })
  @ValidateIf(sent)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: false,
    minimum: -180,
    maximum: 180,
    example: 31.2197,
    description: 'Decimal degrees, at most 6 decimals.',
  })
  @ValidateIf(sent)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: TEXT_LIMITS.transitInfo.min,
    maxLength: TEXT_LIMITS.transitInfo.max,
    example: 'Metro: Opera station, then a 10-minute walk.',
    description: '"Public transport". Null removes it. Trimmed.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(TEXT_LIMITS.transitInfo.min, TEXT_LIMITS.transitInfo.max)
  transitInfo?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: TEXT_LIMITS.parkingInfo.min,
    maxLength: TEXT_LIMITS.parkingInfo.max,
    example: 'Valet parking at the main entrance.',
    description: '"Parking". Null removes it. Trimmed.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(TEXT_LIMITS.parkingInfo.min, TEXT_LIMITS.parkingInfo.max)
  parkingInfo?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    nullable: true,
    maxLength: TEXT_LIMITS.email.max,
    example: 'zamalek@maqady.example',
    description: 'Contact email. Null removes it.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(TEXT_LIMITS.email.min, TEXT_LIMITS.email.max)
  @IsEmail({}, { message: 'email must be an email address' })
  email?: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: false,
    example: true,
    description: '"Show phone numbers and email on the website".',
  })
  @ValidateIf(sent)
  @IsBoolean()
  showContactsPublic?: boolean;

  @ApiPropertyOptional({
    enum: THEATER_STATUSES,
    enumName: 'TheaterStatus',
    nullable: false,
    example: 'active',
    description:
      '`active` on a draft publishes it, once its zone prices, opening hours and an active hall are set (`THEATER_NOT_PUBLISHABLE` lists what is missing). `sales_paused` and `active` toggle selling on a published theater. A published theater never returns to `draft`, and a draft cannot be paused: `CONFLICT` with `details.from` and `details.to`.',
  })
  @ValidateIf(sent)
  @IsIn(THEATER_STATUSES)
  status?: TheaterStatus;
}
