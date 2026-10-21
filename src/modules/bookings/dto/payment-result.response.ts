import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { BookingResponse } from './booking.response';
import { PaymentResponse } from './payment.response';

/** What `POST /bookings/{ref}/payments` answers: the payment's result and the booking after it. */
@ApiSchema({ name: 'PaymentResult' })
export class PaymentResultResponse {
  @ApiProperty({
    type: () => PaymentResponse,
    nullable: false,
    description: 'This payment and its result.',
  })
  payment!: PaymentResponse;

  @ApiProperty({
    type: () => BookingResponse,
    nullable: false,
    description:
      'The booking after it: `confirmed` with its `ticket` when paid; still `held` after a decline, a cancelled wallet or while processing.',
  })
  booking!: BookingResponse;
}
