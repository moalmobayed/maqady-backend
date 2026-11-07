import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';

/** What cancelling a showtime would do now (PRD A5 "Cancel shows its impact"; design §7.7). */
@ApiSchema({ name: 'ShowtimeCancellationPreview' })
export class ShowtimeCancellationPreviewResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 81, description: 'The showtime.' })
  showtimeId!: number;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description:
      'Scheduled and not ended, so `PATCH /admin/showtimes/{id}` with `status: cancelled` would cancel it.',
  })
  cancellable!: boolean;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 12,
    description: 'Confirmed bookings refunded ("{n} bookings").',
  })
  bookingCount!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 31,
    description: 'Their seats ("{seats} seats").',
  })
  seatCount!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Refunded to cards and wallets through the payment provider.',
  })
  refundedOnline!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Owed back at the counter (cash and card terminal), pending until paid out.',
  })
  owedAtCounter!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 1,
    description: 'Seat holds in progress that are released.',
  })
  liveHoldCount!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 11,
    description: 'Cancellation and refund emails sent: one per booking with an email.',
  })
  emailCount!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 9,
    description: 'Cancellation SMS sent: one per booking with a phone.',
  })
  smsCount!: number;
}
