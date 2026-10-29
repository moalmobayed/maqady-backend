import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  NotContains,
  ValidateIf,
} from 'class-validator';
import {
  ACCEPTED_PHONE_PATTERN_SOURCE,
  CUSTOMER_FULL_NAME_MAX_LENGTH,
  E164_PHONE_PATTERN,
  EMAIL_MAX_LENGTH,
  NUL_CHARACTER,
  STORED_EMAIL_PATTERN,
} from '../../customers/customers.constants';
import { NormalisePhone, TrimString } from '../../customers/dto/transforms';
import { CUSTOMER_STATUSES } from '../../customers/enums';
import type { CustomerStatus } from '../../customers/types';

const NOTHING_TO_CHANGE = 'send fullName, email, phone or status';
const PHONE_MESSAGE =
  'phone must be an international number such as +201012345678, or an Egyptian mobile such as 01012345678';

/** True when the body names none of the four fields, so the first one reports it. */
function nothingSent(body: UpdateCustomerRequest): boolean {
  return (
    body.fullName === undefined &&
    body.email === undefined &&
    body.phone === undefined &&
    body.status === undefined
  );
}

/**
 * `PATCH /admin/customers/{id}` (PRD A7 "edit details", Block and Unblock): any of the account's
 * name, email and phone, and its status. At least one field; fields not sent stay as they are.
 */
export class UpdateCustomerRequest {
  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: CUSTOMER_FULL_NAME_MAX_LENGTH,
    example: 'Layla Hassan',
    description: 'Full name; surrounding spaces are dropped. It can be changed, never emptied.',
  })
  @ValidateIf((body: UpdateCustomerRequest) => body.fullName !== undefined || nothingSent(body))
  @TrimString()
  @IsString({
    message: (args) => (args.value === undefined ? NOTHING_TO_CHANGE : 'fullName must be a string'),
  })
  @MinLength(1, { message: 'fullName must not be empty' })
  @MaxLength(CUSTOMER_FULL_NAME_MAX_LENGTH)
  @NotContains(NUL_CHARACTER, { message: 'fullName must not contain a NUL character' })
  fullName?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    nullable: false,
    maxLength: EMAIL_MAX_LENGTH,
    example: 'layla.hassan@example.com',
    description:
      'The sign-in email. Another live account with it, whatever the letter case, is `EMAIL_TAKEN`. A new address is unverified from then on (the customer resends the link from their Profile), and their unused verification and reset links stop working.',
  })
  @ValidateIf((body: UpdateCustomerRequest) => body.email !== undefined)
  @TrimString()
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({}, { message: 'email must be an email address' })
  @Matches(STORED_EMAIL_PATTERN, { message: 'email must be an email address' })
  email?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: ACCEPTED_PHONE_PATTERN_SOURCE,
    example: '+201012345678',
    description:
      'Mobile number for ticket SMS: international form (`+201012345678`), or an Egyptian mobile as typed locally (`01012345678`), stored and returned as `+201012345678`. `null` removes it.',
  })
  @ValidateIf((body: UpdateCustomerRequest) => body.phone !== undefined && body.phone !== null)
  @NormalisePhone()
  @IsString({ message: PHONE_MESSAGE })
  @Matches(E164_PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string | null;

  @ApiPropertyOptional({
    enum: CUSTOMER_STATUSES,
    enumName: 'CustomerStatus',
    nullable: false,
    example: 'blocked',
    description:
      '`blocked` signs the customer out everywhere at once and refuses their sign-in with `ACCOUNT_BLOCKED`; their paid tickets stay valid. `active` unblocks them: they can sign in and book again right away.',
  })
  @ValidateIf((body: UpdateCustomerRequest) => body.status !== undefined)
  @IsIn(CUSTOMER_STATUSES)
  status?: CustomerStatus;
}
