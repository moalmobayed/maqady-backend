import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import {
  ACCEPTED_PHONE_PATTERN_SOURCE,
  CUSTOMER_FULL_NAME_MAX_LENGTH,
  E164_PHONE_PATTERN,
} from '../customers.constants';
import { NormalisePhone, TrimString } from './transforms';

const NOTHING_TO_CHANGE = 'send fullName, phone or both';
const PHONE_MESSAGE =
  'phone must be an international number such as +201012345678, or an Egyptian mobile such as 01012345678';

/** `PATCH /me` (PRD C12 Your details): the name and the optional phone. The email is read-only. */
export class UpdateProfileRequest {
  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: CUSTOMER_FULL_NAME_MAX_LENGTH,
    example: 'Layla Hassan',
    description: 'Full name, required on the profile: it can be changed, never emptied.',
  })
  // Validated when sent, and when `phone` is missing too, so an empty body names a field.
  @ValidateIf(
    (body: UpdateProfileRequest) => body.fullName !== undefined || body.phone === undefined,
  )
  @IsDefined({ message: NOTHING_TO_CHANGE })
  @TrimString()
  @IsString()
  @MinLength(1, { message: 'fullName must not be empty' })
  @MaxLength(CUSTOMER_FULL_NAME_MAX_LENGTH)
  fullName?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: ACCEPTED_PHONE_PATTERN_SOURCE,
    example: '+201012345678',
    description:
      'Optional mobile number for ticket SMS. International form (`+201012345678`), or an Egyptian mobile as typed locally (`01012345678`), which is stored and returned as `+201012345678`. `null` removes it.',
  })
  @ValidateIf((body: UpdateProfileRequest) => body.phone !== undefined && body.phone !== null)
  @NormalisePhone()
  @IsString({ message: PHONE_MESSAGE })
  @Matches(E164_PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string | null;
}
