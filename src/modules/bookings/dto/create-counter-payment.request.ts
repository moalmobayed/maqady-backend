import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotContains,
  ValidateIf,
  ValidateNested,
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
import { COUNTER_PAYMENT_METHODS } from '../../payments/enums';
import type { CounterPaymentMethod } from '../../payments/types';
import { RECEIPT_REFERENCE_MAX_LENGTH, RECEIPT_REFERENCE_PATTERN } from '../bookings.constants';
import { COUNTER_CUSTOMER_KINDS } from '../enums';
import type { CounterCustomerKind } from '../types';
import { OnlyWhen } from './counter.validators';

const PHONE_MESSAGE =
  'phone must be an international number such as +201012345678, or an Egyptian mobile such as 01012345678';
const RECEIPT_MESSAGE =
  'receiptReference must be the terminal receipt reference: 1 to 64 letters, digits, spaces and . / _ -, starting with a letter or digit';

const sent = (value: unknown): boolean => value !== undefined && value !== null;

/** Who the counter sale is for (PRD A6 "New booking": walk-in, existing or typed contact). */
@ApiSchema({ name: 'CounterCustomer' })
export class CounterCustomerRequest {
  @ApiProperty({
    enum: COUNTER_CUSTOMER_KINDS,
    enumName: 'CounterCustomerKind',
    nullable: false,
    example: 'contact',
    description:
      '`walk_in`: nobody on file; no ticket message is sent, so download the PDF (`GET /admin/bookings/{ref}/ticket.pdf`). `existing`: a customer account (`customerId`); the booking becomes theirs, so it shows in their My Bookings, and the tickets go to their email (and SMS to their phone). `contact`: details typed at the counter (`fullName`, optional `email` and `phone`); the tickets go to whichever was given. A typed email is never linked to an account.',
  })
  @IsIn(COUNTER_CUSTOMER_KINDS, { message: 'kind must be walk_in, existing or contact' })
  kind!: CounterCustomerKind;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 42,
    description:
      'Required with `kind: existing`, refused otherwise: the customer account. An unknown, deleted (anonymised) or blocked account is `VALIDATION_FAILED` on `customer.customerId`.',
  })
  @OnlyWhen<CounterCustomerRequest>(
    (body) => body.kind === 'existing',
    'customerId is sent only with kind existing',
  )
  @ValidateIf((body: CounterCustomerRequest) => body.kind === 'existing' || sent(body.customerId))
  @IsInt({ message: 'customerId must be a positive integer (required with kind existing)' })
  @Min(1, { message: 'customerId must be a positive integer (required with kind existing)' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'customerId must be a positive integer' })
  customerId?: number;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: CUSTOMER_FULL_NAME_MAX_LENGTH,
    example: 'Karim Mostafa',
    description:
      'Required with `kind: contact`, refused otherwise: the name the ticket is for. Surrounding spaces are dropped.',
  })
  @OnlyWhen<CounterCustomerRequest>(
    (body) => body.kind === 'contact',
    'fullName is sent only with kind contact',
  )
  @ValidateIf((body: CounterCustomerRequest) => body.kind === 'contact' || sent(body.fullName))
  @TrimString()
  @IsString({ message: 'fullName must be a string (required with kind contact)' })
  @MinLength(1, { message: 'fullName must not be empty' })
  @MaxLength(CUSTOMER_FULL_NAME_MAX_LENGTH)
  @NotContains(NUL_CHARACTER, { message: 'fullName must not contain a NUL character' })
  fullName?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    nullable: true,
    maxLength: EMAIL_MAX_LENGTH,
    example: 'karim.mostafa@example.com',
    description:
      'Optional with `kind: contact`, refused otherwise: where the tickets email goes. Stored in lower case.',
  })
  @OnlyWhen<CounterCustomerRequest>(
    (body) => body.kind === 'contact',
    'email is sent only with kind contact',
  )
  @ValidateIf((body: CounterCustomerRequest) => sent(body.email))
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: 'email must be an email address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail({}, { message: 'email must be an email address' })
  @Matches(STORED_EMAIL_PATTERN, { message: 'email must be an email address' })
  email?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: ACCEPTED_PHONE_PATTERN_SOURCE,
    example: '01012345678',
    description:
      'Optional with `kind: contact`, refused otherwise: the mobile the tickets SMS goes to. International form (`+201012345678`), or an Egyptian mobile as typed locally (`01012345678`), stored as `+201012345678`.',
  })
  @OnlyWhen<CounterCustomerRequest>(
    (body) => body.kind === 'contact',
    'phone is sent only with kind contact',
  )
  @ValidateIf((body: CounterCustomerRequest) => sent(body.phone))
  @NormalisePhone()
  @IsString({ message: PHONE_MESSAGE })
  @Matches(E164_PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string | null;
}

/**
 * `POST /admin/bookings/{ref}/counter-payments`: the money taken at the counter and who the sale
 * is for (PRD Payments 2, A6). The amount is the hold's own total: there is nothing to type.
 */
@ApiSchema({ name: 'CreateCounterPayment' })
export class CreateCounterPaymentRequest {
  @ApiProperty({
    enum: COUNTER_PAYMENT_METHODS,
    enumName: 'CounterPaymentMethod',
    nullable: false,
    example: 'card_terminal',
    description:
      '`cash`, or `card_terminal` (the terminal is not connected: type its receipt reference in `receiptReference`).',
  })
  @IsIn(COUNTER_PAYMENT_METHODS, { message: 'method must be cash or card_terminal' })
  method!: CounterPaymentMethod;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: RECEIPT_REFERENCE_MAX_LENGTH,
    pattern: RECEIPT_REFERENCE_PATTERN.source,
    example: 'TRX-0042817',
    description:
      'Required with `card_terminal`, refused with `cash`: the receipt reference printed by the card terminal, 1 to 64 letters, digits, spaces and `. / _ -`. Surrounding spaces are dropped.',
  })
  @OnlyWhen<CreateCounterPaymentRequest>(
    (body) => body.method === 'card_terminal',
    'receiptReference is sent only with method card_terminal',
  )
  @ValidateIf(
    (body: CreateCounterPaymentRequest) =>
      body.method === 'card_terminal' || sent(body.receiptReference),
  )
  @TrimString()
  @IsString({ message: `${RECEIPT_MESSAGE} (required with card_terminal)` })
  @Matches(RECEIPT_REFERENCE_PATTERN, { message: RECEIPT_MESSAGE })
  receiptReference?: string | null;

  @ApiProperty({
    type: () => CounterCustomerRequest,
    nullable: false,
    description: 'Who the sale is for.',
  })
  @IsDefined({ message: 'customer is required: walk_in, existing or contact' })
  @IsObject({ message: 'customer must be an object' })
  @ValidateNested()
  @Type(() => CounterCustomerRequest)
  customer!: CounterCustomerRequest;
}
