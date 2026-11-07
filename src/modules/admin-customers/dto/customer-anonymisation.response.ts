import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/** What "Delete account" removed, counted (design §21). Never a value. */
@ApiSchema({ name: 'CustomerAnonymisationRemovals' })
export class AnonymisationRemovalsResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 3,
    description: 'Sign-in sessions deleted: the customer is signed out everywhere.',
  })
  sessions!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 2,
    description: 'Verification and password reset links deleted, used or not.',
  })
  oneTimeTokens!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 4,
    description: "Stored results of the customer's requests (idempotency keys) deleted.",
  })
  idempotencyKeys!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 7,
    description: 'Emails and SMS about the customer deleted from the Message log.',
  })
  messages!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 1,
    description: "Internal staff notes on the customer's bookings deleted.",
  })
  bookingNotes!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 6,
    description: 'Bookings whose contact name, email and phone were cleared.',
  })
  bookingContacts!: number;
}

/** The answer of `DELETE /admin/customers/{id}`: the customer is anonymised. */
@ApiSchema({ name: 'CustomerAnonymisation' })
export class CustomerAnonymisationResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 42,
    description: 'The anonymised customer; their id stays on the kept bookings.',
  })
  customerId!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-29T14:05:00+03:00',
    description: 'When the account was deleted.',
  })
  anonymisedAt!: string;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 6,
    description:
      'Bookings kept for accounting, with their seats, totals and payments, without the name or contact details ("{n} past bookings are kept").',
  })
  bookingsKept!: number;

  @ApiProperty({
    type: () => AnonymisationRemovalsResponse,
    nullable: false,
    description: 'What was removed, counted.',
  })
  removed!: AnonymisationRemovalsResponse;
}
