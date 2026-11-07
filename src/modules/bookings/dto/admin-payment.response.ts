import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import {
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  WALLET_TYPES,
} from '../../payments/enums';
import type {
  PaymentKind,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  WalletType,
} from '../../payments/types';
import { PaymentCardResponse } from './payment.response';

/** A staff member as the admin screens name them. */
@ApiSchema({ name: 'StaffRef' })
export class StaffRefResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 7, description: 'Staff member id.' })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'Mona Saeed',
    description: 'Their full name.',
  })
  fullName!: string;
}

/**
 * One payment or refund of a booking as admins see it (PRD A6 "payment details, refund details";
 * design §7.7): every charge and every refund, each on its rail, with the counter and payout facts.
 */
@ApiSchema({ name: 'AdminPayment' })
export class AdminPaymentResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 418,
    description:
      'Payment id. A pending counter refund is paid out with `POST /admin/refunds/{id}/payouts`.',
  })
  id!: number;

  @ApiProperty({
    enum: PAYMENT_KINDS,
    enumName: 'PaymentKind',
    nullable: false,
    example: 'refund',
    description: '`charge`: money taken. `refund`: money given back, naming its charge.',
  })
  kind!: PaymentKind;

  @ApiProperty({
    enum: PAYMENT_PURPOSES,
    enumName: 'PaymentPurpose',
    nullable: false,
    example: 'cancellation',
    description:
      'A charge is a `sale` or the `edit_difference` of a higher total; a refund is a `cancellation` (cancel and refund, a cancelled showtime) or the `edit_difference` of a lower total.',
  })
  purpose!: PaymentPurpose;

  @ApiProperty({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    nullable: false,
    example: 'cash',
    description:
      'The rail: `card` or `wallet` online, `cash` or `card_terminal` at the counter. A refund always goes back on its charge’s rail.',
  })
  method!: PaymentMethod;

  @ApiProperty({
    enum: PAYMENT_STATUSES,
    enumName: 'PaymentStatus',
    nullable: false,
    example: 'pending',
    description:
      'A charge: `processing`, `succeeded`, `declined` or `cancelled` (a closed wallet). A refund: `succeeded` (online at once; a counter refund once paid out) or `pending` (a counter refund waiting to be paid out).',
  })
  status!: PaymentStatus;

  @ApiProperty({ type: () => MoneyResponse, nullable: false, description: 'The amount.' })
  amount!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 411,
    description: "A refund's charge (`id` of another row); null for a charge.",
  })
  refundOfPaymentId!: number | null;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: true,
    description:
      "A succeeded charge's amount still refundable (its amount minus the refunds naming it); null for any other row.",
  })
  refundable!: MoneyResponse | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: "A card-terminal charge's receipt reference as staff typed it; null otherwise.",
  })
  receiptReference!: string | null;

  @ApiProperty({
    type: () => PaymentCardResponse,
    nullable: true,
    description: 'The card of a card charge; null otherwise.',
  })
  card!: PaymentCardResponse | null;

  @ApiProperty({
    enum: WALLET_TYPES,
    enumName: 'WalletType',
    nullable: true,
    example: null,
    description: 'The wallet of a wallet charge; null otherwise.',
  })
  walletType!: WalletType | null;

  @ApiProperty({
    type: () => StaffRefResponse,
    nullable: true,
    description: 'Who took a counter charge ("Collected by"); null otherwise.',
  })
  collectedBy!: StaffRefResponse | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When a counter refund was paid out; null otherwise.',
  })
  paidOutAt!: string | null;

  @ApiProperty({
    type: () => StaffRefResponse,
    nullable: true,
    description: 'Who paid a counter refund out; null otherwise.',
  })
  paidOutBy!: StaffRefResponse | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:02:10+03:00',
    description: 'When the row was written (Cairo time).',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T19:02:10+03:00',
    description:
      'When the money moved: the final result of a charge, a succeeded refund (a counter refund: its payout). Null while processing or pending.',
  })
  completedAt!: string | null;
}
