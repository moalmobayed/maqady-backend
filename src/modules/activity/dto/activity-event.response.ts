import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { ACTOR_KINDS } from '../../../common/audit/enums';
import type { ActorKind, AuditMetadataValue } from '../../../common/audit/types';
import { StaffRefResponse } from '../../bookings/dto/admin-payment.response';

/** Who acted. */
@ApiSchema({ name: 'ActivityActor' })
export class ActivityActorResponse {
  @ApiProperty({
    enum: ACTOR_KINDS,
    enumName: 'ActorKind',
    nullable: false,
    example: 'staff',
    description:
      '`staff` (named in `staff`), `customer` (a signed-in customer, by `customerId` only) or `system` (settlement, a guest, an expiry).',
  })
  kind!: ActorKind;

  @ApiProperty({
    type: () => StaffRefResponse,
    nullable: true,
    description: 'The staff member who acted; null for a customer or the system.',
  })
  staff!: StaffRefResponse | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description:
      'The customer who acted (open `GET /admin/customers/{id}`); null for staff or the system. Never their name, email or phone.',
  })
  customerId!: number | null;
}

/** The item an event is about. */
@ApiSchema({ name: 'ActivityEntity' })
export class ActivityEntityResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    example: 'booking',
    description:
      'The item type, a lower-case name: `booking`, `payment`, `showtime`, `movie`, `movie_photo`, `movie_video`, `person`, `theater`, `theater_photo`, `theater_special_date`, `hall`, `customer`, `staff_user`, `session` or `export`.',
  })
  type!: string;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 512,
    description: 'Its id; null for an item with no row of its own (an `export`).',
  })
  id!: number | null;
}

/** The booking an event belongs to. */
@ApiSchema({ name: 'ActivityBooking' })
export class ActivityBookingResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^MQ-[2-9A-HJKMNP-Z]{6}$',
    example: 'MQ-7K3P9Q',
    description: 'Its reference: open it with `GET /admin/bookings/{ref}`.',
  })
  reference!: string;
}

/** One row of the Activity log (PRD: "time, staff member, action and item"). */
@ApiSchema({ name: 'ActivityEvent' })
export class ActivityEventResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 9042, description: 'Event id.' })
  id!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:02:10+03:00',
    description: 'When it happened (Cairo time).',
  })
  occurredAt!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The cinema date it happened on (a cinema day runs from 06:00 to 06:00).',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'booking.refunded',
    description:
      'What happened, `noun.verb`: for example `booking.confirmed`, `booking.refunded`, `payment.paid_out`, `booking.edited`, `showtime.moved`, `movie.updated`, `customer.status_changed`, `staff_user.invited`, `export.downloaded`.',
  })
  action!: string;

  @ApiProperty({ type: () => ActivityActorResponse, nullable: false })
  actor!: ActivityActorResponse;

  @ApiProperty({ type: () => ActivityEntityResponse, nullable: false })
  entity!: ActivityEntityResponse;

  @ApiProperty({
    type: () => ActivityBookingResponse,
    nullable: true,
    description: 'The booking it belongs to (booking and payment events); null otherwise.',
  })
  booking!: ActivityBookingResponse | null;

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
    example: { seatCount: 2, method: 'card' },
    description:
      "Non-personal facts of the event, each a string, number, boolean or null (a seat count, a method, an amount in piastres, an export's dataset and filters). Never a name, email or phone.",
  })
  metadata!: Record<string, AuditMetadataValue>;
}

/** `GET /admin/activity`: one page, newest first. */
@ApiSchema({ name: 'ActivityEventPage' })
export class ActivityEventPageResponse {
  @ApiProperty({
    type: () => ActivityEventResponse,
    isArray: true,
    nullable: false,
    description: 'This page, newest first. Empty when nothing matches.',
  })
  items!: ActivityEventResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'WyIyMDI2LTEwLTE2VDE5OjAyOjEwLjAwMFoiLDkwNDJd',
    description: 'Pass as `cursor` to get the next page; null on the last page.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    nullable: false,
    example: 1284,
    description: 'How many events match, with the same filters.',
  })
  total!: number;
}
