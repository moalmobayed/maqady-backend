import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { COORDINATE_DECIMALS, STORED_EMAIL_PATTERN, TEXT_LIMITS } from '../theaters.constants';
import { HasAtMostDecimals, HasLength, Trim } from './validators';

/** `POST /admin/theaters`: a new theater, created as a draft (PRD A4 "New theater wizard"). */
export class CreateTheaterRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.name.min,
    maxLength: TEXT_LIMITS.name.max,
    example: 'Maqady Zamalek',
    description:
      'Shown on cards, the theater page and tickets. Unique among theaters, ignoring letter case: a taken name is `CONFLICT` (`uq_theaters_name`). Trimmed.',
  })
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.name.min, TEXT_LIMITS.name.max)
  name!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.address.min,
    maxLength: TEXT_LIMITS.address.max,
    example: '26 July Street, Zamalek',
    description: 'Street address, shown with the map and on calendar files. Trimmed.',
  })
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.address.min, TEXT_LIMITS.address.max)
  address!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.district.min,
    maxLength: TEXT_LIMITS.district.max,
    example: 'Zamalek',
    description: 'District or area, shown on cards and searched by "area". Trimmed.',
  })
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.district.min, TEXT_LIMITS.district.max)
  district!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.city.min,
    maxLength: TEXT_LIMITS.city.max,
    example: 'Cairo',
    description: 'City. Trimmed.',
  })
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.city.min, TEXT_LIMITS.city.max)
  city!: string;

  @ApiProperty({
    type: Number,
    nullable: false,
    minimum: -90,
    maximum: 90,
    example: 30.0609,
    description: 'Decimal degrees, at most 6 decimals. Places the map pin and the Directions link.',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @HasAtMostDecimals(COORDINATE_DECIMALS)
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({
    type: Number,
    nullable: false,
    minimum: -180,
    maximum: 180,
    example: 31.2197,
    description: 'Decimal degrees, at most 6 decimals.',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @HasAtMostDecimals(COORDINATE_DECIMALS)
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: TEXT_LIMITS.transitInfo.min,
    maxLength: TEXT_LIMITS.transitInfo.max,
    example: 'Metro: Opera station, then a 10-minute walk.',
    description: '"Public transport" on the Location tab. Null or omitted: none. Trimmed.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.transitInfo.min, TEXT_LIMITS.transitInfo.max)
  transitInfo?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: TEXT_LIMITS.parkingInfo.min,
    maxLength: TEXT_LIMITS.parkingInfo.max,
    example: 'Valet parking at the main entrance.',
    description: '"Parking" on the Location tab. Null or omitted: none. Trimmed.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.parkingInfo.min, TEXT_LIMITS.parkingInfo.max)
  parkingInfo?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    nullable: true,
    maxLength: TEXT_LIMITS.email.max,
    example: 'zamalek@maqady.example',
    description:
      'Contact email, shown on the website only while `showContactsPublic` is true. Null or omitted: none.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.email.min, TEXT_LIMITS.email.max)
  @IsEmail({}, { message: 'email must be an email address' })
  @Matches(STORED_EMAIL_PATTERN, { message: 'email must contain one @ and no spaces' })
  email?: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: false,
    default: false,
    example: true,
    description:
      '"Show phone numbers and email on the website". Default false: phones and email stay admin-only.',
  })
  @IsOptional()
  @IsBoolean()
  showContactsPublic?: boolean;
}
