import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { CARD_BRANDS, CHARGE_STATUSES, PAYMENT_METHODS, WALLET_TYPES } from '../../payments/enums';
import type { CardBrand, ChargeStatus, PaymentMethod, WalletType } from '../../payments/types';

/** The card a payment was made with: its brand and last four digits, never more. */
@ApiSchema({ name: 'PaymentCard' })
export class PaymentCardResponse {
  @ApiProperty({
    enum: CARD_BRANDS,
    enumName: 'CardBrand',
    nullable: false,
    example: 'visa',
    description: 'The card brand.',
  })
  brand!: CardBrand;

  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^[0-9]{4}$',
    example: '4242',
    description: 'The last four digits, for "Visa •••• 4242".',
  })
  last4!: string;
}

/** A booking's sale charge as the customer and the box office see it (PRD C8, C9, C11, A6). */
@ApiSchema({ name: 'Payment' })
export class PaymentResponse {
  @ApiProperty({
    enum: CHARGE_STATUSES,
    enumName: 'PaymentResultStatus',
    nullable: false,
    example: 'succeeded',
    description:
      '`succeeded`: paid, the booking is confirmed (a counter payment is always `succeeded`: it is recorded once the money is taken). `declined`: show "declined" and offer to try again or switch method while the hold lasts (a new `Idempotency-Key`). `cancelled`: the wallet was closed; not a decline. `processing`: show "Confirming your payment" and read `GET /bookings/{ref}` again after `settlesAt`.',
  })
  status!: ChargeStatus;

  @ApiProperty({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    nullable: false,
    example: 'card',
    description: '`card` or `wallet` online; `cash` or `card_terminal` at the box office.',
  })
  method!: PaymentMethod;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: "The amount charged: exactly the booking's total.",
  })
  amount!: MoneyResponse;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      "The card terminal's receipt reference staff typed, for a `card_terminal` payment at the counter; null otherwise.",
  })
  receiptReference!: string | null;

  @ApiProperty({
    type: () => PaymentCardResponse,
    nullable: true,
    description: 'The card, for a card payment; null otherwise.',
  })
  card!: PaymentCardResponse | null;

  @ApiProperty({
    enum: WALLET_TYPES,
    enumName: 'WalletType',
    nullable: true,
    example: null,
    description: 'The wallet, for a wallet payment; null otherwise.',
  })
  walletType!: WalletType | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:02:10+03:00',
    description: 'When the payment was made (Cairo time).',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T19:02:10+03:00',
    description: 'When it reached its result ("paid on"); null while processing.',
  })
  completedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description:
      'While processing: when the result is expected. Read the booking again after it (the seats stay held until then plus 30 seconds). Null once there is a result.',
  })
  settlesAt!: string | null;
}
