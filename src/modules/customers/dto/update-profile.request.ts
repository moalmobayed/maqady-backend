import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  Matches,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
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
  @TrimString()
  @IsProfileName()
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

/** Why a `fullName` is refused, or null when it is fine; one reason, so the form shows one line. */
function fullNameProblem(value: unknown, body: UpdateProfileRequest): string | null {
  if (value === undefined) return body.phone === undefined ? NOTHING_TO_CHANGE : null;
  if (typeof value !== 'string') return 'fullName must be a string';
  if (value === '') return 'fullName must not be empty';
  if (value.length > CUSTOMER_FULL_NAME_MAX_LENGTH) {
    return `fullName must be at most ${CUSTOMER_FULL_NAME_MAX_LENGTH} characters`;
  }
  return null;
}

/**
 * `fullName` when sent (already trimmed), and the "send something" rule when the body is empty,
 * as one check with one message.
 */
function IsProfileName(): PropertyDecorator {
  return ValidateBy({
    name: 'isProfileName',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        fullNameProblem(value, args?.object as UpdateProfileRequest) === null,
      defaultMessage: (args?: ValidationArguments) =>
        fullNameProblem(args?.value, args?.object as UpdateProfileRequest) ?? NOTHING_TO_CHANGE,
    },
  });
}
