import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { PageResponseOf } from '../../../common/pagination/dto/page-response.dto';
import { StaffRefResponse } from '../../bookings/dto/admin-payment.response';
import { NamedRefResponse } from '../../bookings/dto/booking-showtime.response';
import { PaymentCardResponse } from '../../bookings/dto/payment.response';
import { BOOKING_CHANNELS } from '../../bookings/enums';
import type { BookingChannel } from '../../bookings/types';
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
import { PAYMENT_CHANNELS, TRANSACTION_FAILURE_REASONS, TRANSACTION_STATUSES } from '../enums';
import type { PaymentChannel, TransactionFailureReason, TransactionStatus } from '../types';

/** The booking a transaction belongs to, for "open the booking" (PRD A8 drawer). */
@ApiSchema({ name: 'TransactionBooking' })
export class TransactionBookingResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    example: 'MQ-7K3P9Q',
    description: 'The booking reference: open it with `GET /admin/bookings/{ref}`.',
  })
  reference!: string;

  @ApiProperty({
    enum: BOOKING_CHANNELS,
    enumName: 'BookingChannel',
    nullable: false,
    example: 'online',
    description: 'Where the booking was made: `online` or at the `counter`.',
  })
  channel!: BookingChannel;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Nadia Farouk',
    description:
      "The booking's contact name (the customer's, or typed at the counter); null for a walk-in or an anonymised customer.",
  })
  contactName!: string | null;
}

/** What the drawer may do with a transaction now. */
@ApiSchema({ name: 'TransactionActions' })
export class TransactionActionsResponse {
  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description:
      'True for a counter refund waiting at the counter: "Mark refund paid out" calls `POST /admin/refunds/{id}/payouts` with this `id`.',
  })
  markPaidOut!: boolean;
}

/**
 * One row of the Payments screen's transactions (PRD A8; design §13.3): a charge or a refund, with
 * the status the screen shows and the stored one behind it.
 */
@ApiSchema({ name: 'AdminTransaction' })
export class AdminTransactionResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 418,
    description: 'Payment id (a charge or a refund).',
  })
  id!: number;

  @ApiProperty({
    enum: PAYMENT_KINDS,
    enumName: 'PaymentKind',
    nullable: false,
    example: 'charge',
    description: '`charge`: money taken. `refund`: money given back, naming its charge.',
  })
  kind!: PaymentKind;

  @ApiProperty({
    enum: PAYMENT_PURPOSES,
    enumName: 'PaymentPurpose',
    nullable: false,
    example: 'sale',
    description:
      'A charge is a `sale` (online or at the counter) or the `edit_difference` of a higher total; a refund is a `cancellation` or the `edit_difference` of a lower total.',
  })
  purpose!: PaymentPurpose;

  @ApiProperty({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    nullable: false,
    example: 'card',
    description:
      'The rail: `card` or `wallet` online, `cash` or `card_terminal` at the counter. A refund is on its charge’s rail.',
  })
  method!: PaymentMethod;

  @ApiProperty({
    enum: PAYMENT_CHANNELS,
    enumName: 'PaymentChannel',
    nullable: false,
    example: 'online',
    description: '`online` (card, wallet) or `counter` (cash, card terminal).',
  })
  channel!: PaymentChannel;

  @ApiProperty({
    enum: TRANSACTION_STATUSES,
    enumName: 'TransactionStatus',
    nullable: false,
    example: 'succeeded',
    description:
      'As the screen shows it. A charge: `pending` while processing, `succeeded`, `refunded` once its succeeded refunds reach its amount (a counter refund counts once paid out), `failed` (see `failureReason`). A refund: `pending` while a counter refund waits to be paid out, else `succeeded`.',
  })
  status!: TransactionStatus;

  @ApiProperty({
    enum: TRANSACTION_FAILURE_REASONS,
    enumName: 'TransactionFailureReason',
    nullable: true,
    example: null,
    description:
      'Why a charge is `failed`: `declined` by the provider, or `cancelled` (the customer closed the wallet). Null otherwise.',
  })
  failureReason!: TransactionFailureReason | null;

  @ApiProperty({
    enum: PAYMENT_STATUSES,
    enumName: 'PaymentStatus',
    nullable: false,
    example: 'succeeded',
    description:
      'The stored status behind `status`: a charge `processing`, `succeeded`, `declined` or `cancelled`; a refund `pending` or `succeeded`.',
  })
  ledgerStatus!: PaymentStatus;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Signed: a charge positive, a refund negative (money going back).',
  })
  amount!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: "A refund's charge (`id` of another row); null for a charge.",
  })
  refundOfPaymentId!: number | null;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: true,
    description: "A charge's succeeded refunds so far (positive); null for a refund.",
  })
  refundedAmount!: MoneyResponse | null;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: true,
    description:
      "A charge's counter refunds still waiting to be paid out (positive); null for a refund.",
  })
  pendingRefundAmount!: MoneyResponse | null;

  @ApiProperty({
    type: () => TransactionBookingResponse,
    nullable: false,
    description: 'The booking it belongs to.',
  })
  booking!: TransactionBookingResponse;

  @ApiProperty({
    type: () => NamedRefResponse,
    nullable: false,
    description: "The theater of the booking's showtime (the reconciliation's theater).",
  })
  theater!: NamedRefResponse;

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
    type: String,
    nullable: true,
    example: null,
    description: "A card-terminal charge's receipt reference as staff typed it; null otherwise.",
  })
  receiptReference!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'sim.sim_card_visa.1791910800000.3f2a9c1d4b5e6f70',
    description:
      "The payment provider's id of an online charge or refund; null at the counter, and while an online charge has no provider answer.",
  })
  providerReference!: string | null;

  @ApiProperty({
    type: () => StaffRefResponse,
    nullable: true,
    description: 'Who took a counter charge; null otherwise.',
  })
  collectedBy!: StaffRefResponse | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When a counter refund was paid out (Cairo time); null otherwise.',
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
      "When the money moved: a charge's final result, an online refund, a counter refund's payout. Null while processing or pending.",
  })
  completedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:02:10+03:00',
    description:
      '`completedAt`, or `createdAt` while nothing has moved yet: the list is newest first by it, and the date filters read its cinema date.',
  })
  occurredAt!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The cinema date of `occurredAt` (a cinema day runs from 06:00 to 06:00).',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: () => TransactionActionsResponse,
    nullable: false,
    description: 'What the drawer may do now.',
  })
  actions!: TransactionActionsResponse;
}

/** `{ items, nextCursor, total }` of transactions. */
export const AdminTransactionPageResponse = PageResponseOf(AdminTransactionResponse);
