import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { PAYMENT_METHODS } from '../../payments/enums';
import type { PaymentMethod } from '../../payments/types';
import { EDIT_DIRECTIONS, EDITED_FIELDS } from '../enums';
import type { EditDirection, EditedField } from '../types';
import { AdminPaymentResponse } from './admin-payment.response';
import { BookingSeatResponse } from './booking-seat.response';
import { BookingShowtimeResponse } from './booking-showtime.response';
import { BookingResponse } from './booking.response';

/** What an edit does with the money (PRD A6 "price delta"). */
@ApiSchema({ name: 'EditDifference' })
export class EditDifferenceResponse {
  @ApiProperty({
    enum: EDIT_DIRECTIONS,
    enumName: 'EditDirection',
    nullable: false,
    example: 'refund',
    description:
      '`collect`: the new total is higher; take `amount` at the counter (send `payment` with the edit). `refund`: it is lower; `amount` is refunded automatically when you save, each part on its own rail. `none`: same total; new tickets replace the old ones.',
  })
  direction!: EditDirection;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'The difference, never negative (0 with `none`).',
  })
  amount!: MoneyResponse;
}

/** A seat of the proposed booking: priced, and whether the booking keeps it. */
@ApiSchema({ name: 'PlannedSeat' })
export class PlannedSeatResponse extends BookingSeatResponse {
  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description:
      'True for a seat the booking already has on the same showtime: it keeps the price it was sold at. False: priced at the showtime’s current zone price.',
  })
  kept!: boolean;
}

/** One part of a lower total's refund: this much of this charge, on its rail. */
@ApiSchema({ name: 'PlannedRefund' })
export class PlannedRefundResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 411,
    description: 'The charge refunded (`AdminPayment.id`); newest charges first.',
  })
  paymentId!: number;

  @ApiProperty({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    nullable: false,
    example: 'card',
    description:
      'Its rail: `card` or `wallet` (through the provider), `cash` or `card_terminal` (pending until paid out).',
  })
  method!: PaymentMethod;

  @ApiProperty({ type: () => MoneyResponse, nullable: false, description: 'How much of it.' })
  amount!: MoneyResponse;
}

/** The booking before the edit. */
@ApiSchema({ name: 'EditPreviewCurrent' })
export class EditPreviewCurrentResponse {
  @ApiProperty({
    type: () => BookingShowtimeResponse,
    nullable: false,
    description: 'Its showtime.',
  })
  showtime!: BookingShowtimeResponse;

  @ApiProperty({
    type: () => BookingSeatResponse,
    isArray: true,
    nullable: false,
    description: 'Its seats and the prices they were sold at.',
  })
  seats!: BookingSeatResponse[];

  @ApiProperty({ type: () => MoneyResponse, nullable: false, description: 'Its total.' })
  total!: MoneyResponse;
}

/** The booking after the edit. */
@ApiSchema({ name: 'EditPreviewProposed' })
export class EditPreviewProposedResponse {
  @ApiProperty({
    type: () => BookingShowtimeResponse,
    nullable: false,
    description: 'Its showtime.',
  })
  showtime!: BookingShowtimeResponse;

  @ApiProperty({
    type: () => PlannedSeatResponse,
    isArray: true,
    nullable: false,
    description: 'Its seats, priced.',
  })
  seats!: PlannedSeatResponse[];

  @ApiProperty({ type: () => MoneyResponse, nullable: false, description: 'Its total.' })
  total!: MoneyResponse;
}

/** `POST /admin/bookings/{ref}/edit-previews`: the "before/after diff" of the edit dialog. */
@ApiSchema({ name: 'BookingEditPreview' })
export class BookingEditPreviewResponse {
  @ApiProperty({ type: () => EditPreviewCurrentResponse, nullable: false, description: 'Before.' })
  current!: EditPreviewCurrentResponse;

  @ApiProperty({ type: () => EditPreviewProposedResponse, nullable: false, description: 'After.' })
  proposed!: EditPreviewProposedResponse;

  @ApiProperty({ type: () => EditDifferenceResponse, nullable: false, description: 'The money.' })
  difference!: EditDifferenceResponse;

  @ApiProperty({
    type: () => PlannedRefundResponse,
    isArray: true,
    nullable: false,
    description: 'How a lower total would be refunded, newest charge first; empty otherwise.',
  })
  refunds!: PlannedRefundResponse[];

  @ApiProperty({
    enum: EDITED_FIELDS,
    enumName: 'EditedField',
    isArray: true,
    nullable: false,
    example: ['showtime'],
    description:
      'What the edit changes: `showtime`, `seats`, `contactName`, `contactEmail`, `contactPhone`.',
  })
  changedFields!: EditedField[];

  @ApiProperty({
    type: String,
    isArray: true,
    nullable: false,
    example: [],
    description:
      'Proposed seats someone else holds or bought right now: saving would answer `SEAT_TAKEN`. Pick others.',
  })
  unavailableSeats!: string[];
}

/** `POST /admin/bookings/{ref}/edits`: the booking after the edit and the money it moved. */
@ApiSchema({ name: 'BookingEditResult' })
export class BookingEditResultResponse {
  @ApiProperty({
    type: () => BookingResponse,
    nullable: false,
    description: 'The booking after the edit, with its new QR code in `ticket`.',
  })
  booking!: BookingResponse;

  @ApiProperty({ type: () => EditDifferenceResponse, nullable: false, description: 'The money.' })
  difference!: EditDifferenceResponse;

  @ApiProperty({
    enum: EDITED_FIELDS,
    enumName: 'EditedField',
    isArray: true,
    nullable: false,
    example: ['showtime'],
    description: 'What changed.',
  })
  changedFields!: EditedField[];

  @ApiProperty({
    type: () => AdminPaymentResponse,
    isArray: true,
    nullable: false,
    description:
      'The payments the edit wrote: the refunds of a lower total, or the counter charge of a higher one; empty for the same total.',
  })
  payments!: AdminPaymentResponse[];
}
