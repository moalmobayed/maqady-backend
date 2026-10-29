import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { AdminPaymentResponse } from './admin-payment.response';
import { BookingResponse } from './booking.response';

/** What "Cancel & refund" did: the refunds, one per charge, and the booking, now `refunded`. */
@ApiSchema({ name: 'BookingRefundResult' })
export class BookingRefundResultResponse {
  @ApiProperty({
    type: () => AdminPaymentResponse,
    isArray: true,
    nullable: false,
    description:
      'One refund per charge that had money left, on its own rail: `succeeded` for a card or wallet (through the payment provider), `pending` for cash or card terminal (pay it out with `POST /admin/refunds/{id}/payouts`).',
  })
  refunds!: AdminPaymentResponse[];

  @ApiProperty({
    type: () => BookingResponse,
    nullable: false,
    description: 'The booking after the refund (`status: refunded`, with `refund`).',
  })
  booking!: BookingResponse;
}
