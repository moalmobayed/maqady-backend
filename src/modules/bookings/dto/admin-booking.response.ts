import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { ACTOR_KINDS } from '../../../common/audit/enums';
import type { ActorKind, AuditMetadataValue } from '../../../common/audit/types';
import { CUSTOMER_STATUSES } from '../../customers/enums';
import type { CustomerStatus } from '../../customers/types';
import { AdminPaymentResponse, StaffRefResponse } from './admin-payment.response';
import { BookingResponse } from './booking.response';

/** A booking's contact: who the tickets are for and where they go (PRD A6 "CUSTOMER"). */
@ApiSchema({ name: 'BookingContact' })
export class BookingContactResponse {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Karim Mostafa',
    description: 'The name on the booking; null for a walk-in.',
  })
  name!: string | null;

  @ApiProperty({
    type: String,
    format: 'email',
    nullable: true,
    example: 'karim.mostafa@example.com',
    description: 'Where tickets and notices are emailed; null when none was given.',
  })
  email!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '+201012345678',
    description: 'The mobile SMS go to (E.164); null when none was given.',
  })
  phone!: string | null;
}

/** The customer card of the admin booking detail (PRD A6). */
@ApiSchema({ name: 'AdminCustomerCard' })
export class AdminCustomerCardResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 42,
    description: 'Customer id ("Open customer").',
  })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Karim Mostafa',
    description: 'Null once anonymised.',
  })
  fullName!: string | null;

  @ApiProperty({
    type: String,
    format: 'email',
    nullable: true,
    example: 'karim.mostafa@example.com',
    description: 'Null once anonymised.',
  })
  email!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '+201012345678',
    description: 'Null when none is on file, and once anonymised.',
  })
  phone!: string | null;

  @ApiProperty({
    enum: CUSTOMER_STATUSES,
    enumName: 'CustomerStatus',
    nullable: false,
    example: 'active',
    description: '`active` or `blocked`.',
  })
  status!: CustomerStatus;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description: 'True once the account was deleted (anonymised); the booking stays.',
  })
  anonymised!: boolean;
}

/** One event of a booking's activity log (PRD A6 "Activity log": label, actor, time). */
@ApiSchema({ name: 'AdminActivityEvent' })
export class AdminActivityEventResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    example: 'booking.edited',
    description:
      'What happened, `noun.verb`: for example `booking.held`, `payment.succeeded`, `booking.confirmed`, `booking.refunded`, `payment.refunded`, `payment.paid_out`, `booking.edited`, `booking.note_added`, `booking.tickets_resent`, `booking.checked_in`, `booking.ticket_downloaded`.',
  })
  action!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:02:10+03:00',
    description: 'When (Cairo time).',
  })
  occurredAt!: string;

  @ApiProperty({
    enum: ACTOR_KINDS,
    enumName: 'ActorKind',
    nullable: false,
    example: 'staff',
    description:
      '`staff` (named in `staff`), `customer` (online) or `system` (settlement, a guest).',
  })
  actorKind!: ActorKind;

  @ApiProperty({
    type: () => StaffRefResponse,
    nullable: true,
    description: 'The staff member who acted; null for a customer or the system.',
  })
  staff!: StaffRefResponse | null;

  @ApiProperty({
    type: String,
    isArray: true,
    nullable: false,
    example: ['showtime', 'seats'],
    description: 'The names of the fields it changed, never their values.',
  })
  changedFields!: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
      nullable: true,
    },
    nullable: false,
    example: { reason: 'customer_request', difference: -4000 },
    description:
      'Non-personal facts of the event, each a string, number, boolean or null (for example an edit reason, a seat count, a method, an amount in piastres). Never a name, email or phone.',
  })
  metadata!: Record<string, AuditMetadataValue>;
}

/** What an admin may do with the booking now (buttons to enable). */
@ApiSchema({ name: 'AdminBookingActions' })
export class AdminBookingActionsResponse {
  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description:
      '"Cancel & refund" (admins): the booking is confirmed and its showtime has not ended.',
  })
  refund!: boolean;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description:
      '"Edit booking" (admins): confirmed, its showtime not started, and nobody checked it in yet.',
  })
  edit!: boolean;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description:
      '"Resend tickets" (both roles): it has a ticket (confirmed or completed) and an email or phone on file.',
  })
  resendTickets!: boolean;
}

/**
 * A booking as staff see it in the admin detail (PRD A6 "Detail"): every `Booking` field, plus
 * the contact, the customer card, the counter seller, the check-in, every payment and refund, what
 * can be done, and the activity log. Internal notes come from `GET /admin/bookings/{ref}/notes`.
 */
@ApiSchema({ name: 'AdminBooking' })
export class AdminBookingResponse extends BookingResponse {
  @ApiProperty({ type: () => BookingContactResponse, nullable: false, description: 'The contact.' })
  contact!: BookingContactResponse;

  @ApiProperty({
    type: () => AdminCustomerCardResponse,
    nullable: true,
    description: 'The customer account that owns the booking; null for a guest-free counter sale.',
  })
  customer!: AdminCustomerCardResponse | null;

  @ApiProperty({
    type: () => StaffRefResponse,
    nullable: true,
    description: 'The box office member who sold a counter booking; null online.',
  })
  soldBy!: StaffRefResponse | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When the ticket was scanned at the entrance; null until then.',
  })
  checkedInAt!: string | null;

  @ApiProperty({
    type: () => StaffRefResponse,
    nullable: true,
    description: 'Who scanned it; null until then.',
  })
  checkedInBy!: StaffRefResponse | null;

  @ApiProperty({
    type: () => AdminPaymentResponse,
    isArray: true,
    nullable: false,
    description: 'Every payment and refund of the booking, oldest first.',
  })
  payments!: AdminPaymentResponse[];

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description:
      'What "Cancel & refund" would give back now: the succeeded charges’ remaining amounts (the total of a confirmed booking).',
  })
  refundable!: MoneyResponse;

  @ApiProperty({
    type: () => AdminBookingActionsResponse,
    nullable: false,
    description: 'What can be done with the booking now.',
  })
  actions!: AdminBookingActionsResponse;

  @ApiProperty({
    type: () => AdminActivityEventResponse,
    isArray: true,
    nullable: false,
    description: "The booking's activity log, oldest first: its first 100 events.",
  })
  activity!: AdminActivityEventResponse[];
}
