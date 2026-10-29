import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';

/** A refunded booking's refund (PRD C11 "Refunded bookings show the refund amount and date"). */
@ApiSchema({ name: 'BookingRefund' })
export class BookingRefundResponse {
  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'The refunded amount: always the full booking total (a refund is never partial).',
  })
  amount!: MoneyResponse;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-15T14:20:00+03:00',
    description: 'When the booking was refunded, Cairo time with its offset.',
  })
  refundedAt!: string;
}
