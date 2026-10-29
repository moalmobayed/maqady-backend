import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
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
import { SEAT_LABEL_PATTERN } from '../../seating/seating.constants';
import {
  MAX_SEATS_PER_HOLD,
  RECEIPT_REFERENCE_MAX_LENGTH,
  RECEIPT_REFERENCE_PATTERN,
} from '../bookings.constants';
import { EDIT_REASONS } from '../enums';
import type { EditReason } from '../types';
import { OnlyWhen } from './counter.validators';

const PHONE_MESSAGE =
  'phone must be an international number such as +201012345678, or an Egyptian mobile such as 01012345678';
const RECEIPT_MESSAGE =
  'receiptReference must be the terminal receipt reference: 1 to 64 letters, digits, spaces and . / _ -, starting with a letter or digit';

const sent = (value: unknown): boolean => value !== undefined && value !== null;

/** The booking's new contact details (PRD A6 "edit contact name/email/phone"). */
@ApiSchema({ name: 'EditBookingContact' })
export class EditBookingContactRequest {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: CUSTOMER_FULL_NAME_MAX_LENGTH,
    example: 'Karim Mostafa',
    description:
      'The name the tickets are for; null clears it. Left out: unchanged. Surrounding spaces are dropped.',
  })
  @ValidateIf((body: EditBookingContactRequest) => sent(body.name))
  @TrimString()
  @IsString({ message: 'name must be a string or null' })
  @MinLength(1, { message: 'name must not be empty (send null to clear it)' })
  @MaxLength(CUSTOMER_FULL_NAME_MAX_LENGTH)
  @NotContains(NUL_CHARACTER, { message: 'name must not contain a NUL character' })
  name?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    nullable: true,
    maxLength: EMAIL_MAX_LENGTH,
    example: 'karim.mostafa@example.com',
    description:
      'Where tickets and notices are emailed; null clears it. Left out: unchanged. Stored in lower case.',
  })
  @ValidateIf((body: EditBookingContactRequest) => sent(body.email))
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: 'email must be an email address or null' })
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
      'The mobile SMS go to; null clears it. Left out: unchanged. International form (`+201012345678`) or an Egyptian mobile as typed locally (`01012345678`), stored as `+201012345678`.',
  })
  @ValidateIf((body: EditBookingContactRequest) => sent(body.phone))
  @NormalisePhone()
  @IsString({ message: PHONE_MESSAGE })
  @Matches(E164_PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string | null;
}

/** The difference of a higher total, taken at the counter now (PRD A6, call 3: no payment links). */
@ApiSchema({ name: 'EditBookingPayment' })
export class EditBookingPaymentRequest {
  @ApiProperty({
    enum: COUNTER_PAYMENT_METHODS,
    enumName: 'CounterPaymentMethod',
    nullable: false,
    example: 'cash',
    description: '`cash`, or `card_terminal` with the terminal receipt in `receiptReference`.',
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
      'Required with `card_terminal`, refused with `cash`: the receipt reference printed by the card terminal.',
  })
  @OnlyWhen<EditBookingPaymentRequest>(
    (body) => body.method === 'card_terminal',
    'receiptReference is sent only with method card_terminal',
  )
  @ValidateIf(
    (body: EditBookingPaymentRequest) =>
      body.method === 'card_terminal' || sent(body.receiptReference),
  )
  @TrimString()
  @IsString({ message: `${RECEIPT_MESSAGE} (required with card_terminal)` })
  @Matches(RECEIPT_REFERENCE_PATTERN, { message: RECEIPT_MESSAGE })
  receiptReference?: string | null;
}

/**
 * `POST /admin/bookings/{ref}/edit-previews` and `/edits` (design §7.8; PRD A6 "Edit booking"):
 * another showtime of the same movie, other seats, other contact details, or any mix, with a
 * required reason.
 */
@ApiSchema({ name: 'EditBooking' })
export class EditBookingRequest {
  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 82,
    description:
      "Another showtime of the same movie (any theater), bookable now; left out: the booking's own. Without `seats`, the booking keeps its seat labels on the new showtime, priced at its current zone prices.",
  })
  @IsOptional()
  @IsInt({ message: 'showtimeId must be a positive integer' })
  @Min(1, { message: 'showtimeId must be a positive integer' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'showtimeId must be a positive integer' })
  showtimeId?: number;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    nullable: false,
    minItems: 1,
    maxItems: MAX_SEATS_PER_HOLD,
    uniqueItems: true,
    pattern: SEAT_LABEL_PATTERN.source,
    example: ['F7', 'F8'],
    description: `The booking's seats after the edit, 1 to ${MAX_SEATS_PER_HOLD} distinct labels of the target hall; left out: the current labels. A seat kept on the same showtime keeps the price it was sold at; every other seat takes the showtime's current zone price.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEATS_PER_HOLD)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(SEAT_LABEL_PATTERN, {
    each: true,
    message: 'each seat must be a label such as F7 (row A to P without I, seat 1 to 20)',
  })
  seats?: string[];

  @ApiPropertyOptional({
    type: () => EditBookingContactRequest,
    nullable: false,
    description: 'Contact fields to change; each left out stays as it is.',
  })
  @IsOptional()
  @IsObject({ message: 'contact must be an object' })
  @ValidateNested()
  @Type(() => EditBookingContactRequest)
  contact?: EditBookingContactRequest;

  @ApiProperty({
    enum: EDIT_REASONS,
    enumName: 'EditReason',
    nullable: false,
    example: 'customer_request',
    description:
      'Why (required, saved in the activity log): `customer_request`, `seat_problem`, `showtime_changed` or `staff_error`.',
  })
  @IsIn(EDIT_REASONS, {
    message: 'reason must be customer_request, seat_problem, showtime_changed or staff_error',
  })
  reason!: EditReason;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: false,
    default: false,
    example: true,
    description:
      '"Email and SMS the customer new tickets": queue the new tickets to the contact email and phone. The old QR code stops working either way.',
  })
  @IsOptional()
  @IsBoolean()
  notify?: boolean;

  @ApiPropertyOptional({
    type: () => EditBookingPaymentRequest,
    nullable: false,
    description:
      'Exactly when the new total is higher (`difference.direction: collect` in the preview): the difference taken at the counter now. Refused otherwise. Ignored by the preview.',
  })
  @IsOptional()
  @IsObject({ message: 'payment must be an object' })
  @ValidateNested()
  @Type(() => EditBookingPaymentRequest)
  payment?: EditBookingPaymentRequest;
}
