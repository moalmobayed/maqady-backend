import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { NamedRefResponse } from '../../bookings/dto/booking-showtime.response';
import { CHARGE_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../../payments/enums';
import type { ChargeStatus, PaymentMethod, PaymentStatus } from '../../payments/types';
import { PAYMENT_CHANNELS, RECONCILIATION_CHECKS } from '../enums';
import type { PaymentChannel, ReconciliationCheck } from '../types';

/** The period the summary covers: whole cinema days, and the instants they span. */
@ApiSchema({ name: 'PaymentPeriod' })
export class PaymentPeriodResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-10',
    description: 'The first cinema date.',
  })
  dateFrom!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The last cinema date, inclusive.',
  })
  dateTo!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-10T06:00:00+03:00',
    description: 'The period starts here: 06:00 Cairo time on `dateFrom`.',
  })
  from!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-17T06:00:00+03:00',
    description: 'The period ends here, exclusive: 06:00 Cairo time the morning after `dateTo`.',
  })
  to!: string;
}

/** The four cards above the Payments table (PRD A8). */
@ApiSchema({ name: 'PaymentKpis' })
export class PaymentKpisResponse {
  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description:
      '"Collected online": card and wallet charges minus their refunds, by the day the money moved.',
  })
  collectedOnline!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description:
      '"Collected at counters": cash and card-terminal charges minus the counter refunds paid out.',
  })
  collectedAtCounters!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description:
      '"Refunds": every succeeded refund in the period (online at once; a counter refund once paid out).',
  })
  refunds!: MoneyResponse;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 0.125,
    description:
      'Refunds as a share of the money taken in the period (`refunds ÷ totals.gross`), 4 decimals: 0.125 is 12.5%. Null when nothing was taken.',
  })
  refundRate!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 3,
    description:
      '"Failed today": online charges declined, or closed by the customer at the wallet, on today\'s cinema day, whatever the period.',
  })
  failedToday!: number;
}

/** Money moved: succeeded charges, succeeded refunds and the difference. */
@ApiSchema({ name: 'PaymentTotals' })
export class PaymentTotalsResponse {
  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Money taken: the succeeded charges.',
  })
  gross!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 42,
    description: 'How many succeeded charges.',
  })
  chargeCount!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Money given back: the succeeded refunds (positive).',
  })
  refunds!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 4,
    description: 'How many succeeded refunds.',
  })
  refundCount!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Collected: `gross` minus `refunds`. Negative when more went back than came in.',
  })
  net!: MoneyResponse;
}

/** The totals of one channel. */
@ApiSchema({ name: 'ChannelTotals' })
export class ChannelTotalsResponse extends PaymentTotalsResponse {
  @ApiProperty({
    enum: PAYMENT_CHANNELS,
    enumName: 'PaymentChannel',
    nullable: false,
    example: 'online',
    description: '`online` (card, wallet) or `counter` (cash, card terminal).',
  })
  channel!: PaymentChannel;
}

/** The totals of one method. */
@ApiSchema({ name: 'MethodTotals' })
export class MethodTotalsResponse extends PaymentTotalsResponse {
  @ApiProperty({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    nullable: false,
    example: 'cash',
    description: 'The rail: `card`, `wallet`, `cash` or `card_terminal`.',
  })
  method!: PaymentMethod;
}

/** The charges shown `failed` in the period. */
@ApiSchema({ name: 'FailedPaymentCounts' })
export class FailedCountsResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 5,
    description: 'Every failed charge: `declinedCount + cancelledCount`.',
  })
  count!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 4,
    description: 'Declined by the provider.',
  })
  declinedCount!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 1,
    description: 'Wallets the customer closed (not a decline).',
  })
  cancelledCount!: number;
}

/** "Online, Cash, Terminal, Refunds, Net" (PRD A8). */
@ApiSchema({ name: 'ReconciliationAmounts' })
export class ReconciliationAmountsResponse {
  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Card and wallet charges taken.',
  })
  online!: MoneyResponse;

  @ApiProperty({ type: () => MoneyResponse, nullable: false, description: 'Cash charges taken.' })
  cash!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Card-terminal charges taken.',
  })
  cardTerminal!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Succeeded refunds on every rail (positive).',
  })
  refunds!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: '`online + cash + cardTerminal − refunds`.',
  })
  net!: MoneyResponse;
}

/** One theater's row of the reconciliation. */
@ApiSchema({ name: 'TheaterReconciliation' })
export class TheaterReconciliationResponse extends ReconciliationAmountsResponse {
  @ApiProperty({
    type: () => NamedRefResponse,
    nullable: false,
    description: "The theater (of each booking's showtime).",
  })
  theater!: NamedRefResponse;
}

/** The payment provider's side of the period's final online charges. */
@ApiSchema({ name: 'ProviderCheck' })
export class ProviderCheckResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 38,
    description:
      'Online charges final in the ledger (succeeded, declined, cancelled) whose money moved in the period, each retrieved from the provider.',
  })
  checkedCount!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'The ones the ledger has as succeeded.',
  })
  ledgerSucceeded!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'The ones the provider reports succeeded.',
  })
  providerSucceeded!: MoneyResponse;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description:
      'True when the provider agrees with every status and every online row has a provider reference.',
  })
  matched!: boolean;
}

/** One record that does not add up. */
@ApiSchema({ name: 'ReconciliationMismatch' })
export class ReconciliationMismatchResponse {
  @ApiProperty({
    enum: RECONCILIATION_CHECKS,
    enumName: 'ReconciliationCheck',
    nullable: false,
    example: 'booking_balance',
    description:
      "Which check failed: `booking_balance` (a booking's succeeded charges minus refunds differ from its total while confirmed, or from nothing while held or refunded), `over_refunded` (a charge refunded beyond its amount), `provider_status` (the provider reports another status), `provider_unknown` (the provider does not know the reference), `missing_provider_reference` (an online row with none).",
  })
  check!: ReconciliationCheck;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'MQ-7K3P9Q',
    description: 'The booking to open.',
  })
  bookingReference!: string;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'The payment the check is about; null for `booking_balance`.',
  })
  paymentId!: number | null;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: true,
    description:
      "What should be there: the booking's balance, or the charge's amount (`over_refunded`); null for the provider checks.",
  })
  expectedAmount!: MoneyResponse | null;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: true,
    description:
      "What the ledger adds up to: the booking's charges minus refunds, or the charge's refunds; null for the provider checks.",
  })
  actualAmount!: MoneyResponse | null;

  @ApiProperty({
    enum: PAYMENT_STATUSES,
    enumName: 'PaymentStatus',
    nullable: true,
    example: null,
    description: "The ledger's status of the payment (provider checks); null otherwise.",
  })
  ledgerStatus!: PaymentStatus | null;

  @ApiProperty({
    enum: CHARGE_STATUSES,
    enumName: 'PaymentResultStatus',
    nullable: true,
    example: null,
    description: "The provider's status (`provider_status`); null otherwise.",
  })
  providerStatus!: ChargeStatus | null;

  @ApiProperty({
    type: String,
    nullable: false,
    example:
      'Booking MQ-7K3P9Q is confirmed and should hold EGP 380, but its succeeded charges minus refunds come to EGP 0.',
    description: 'What is wrong, in English, with no personal data.',
  })
  message!: string;
}

/** The reconciliation of the period (PRD A8). */
@ApiSchema({ name: 'PaymentsReconciliation' })
export class ReconciliationResponse {
  @ApiProperty({
    type: () => TheaterReconciliationResponse,
    isArray: true,
    nullable: false,
    description: 'One row per theater that moved money in the period, by theater name.',
  })
  byTheater!: TheaterReconciliationResponse[];

  @ApiProperty({
    type: () => ReconciliationAmountsResponse,
    nullable: false,
    description: 'The sum of `byTheater`; equal to the KPI totals.',
  })
  totals!: ReconciliationAmountsResponse;

  @ApiProperty({
    type: () => ProviderCheckResponse,
    nullable: false,
    description: "The provider's totals against the ledger's.",
  })
  provider!: ProviderCheckResponse;

  @ApiProperty({
    type: () => ReconciliationMismatchResponse,
    isArray: true,
    nullable: false,
    description:
      'Every record that does not add up (at most 100; see `truncated`). Empty when all is well.',
  })
  mismatches!: ReconciliationMismatchResponse[];

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description: 'True when more than 100 mismatches were found and only the first 100 are listed.',
  })
  truncated!: boolean;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description: 'True when no mismatch was found.',
  })
  consistent!: boolean;
}

/** `GET /admin/payments/summary` (PRD A8): the KPIs of a period and its reconciliation. */
@ApiSchema({ name: 'AdminPaymentsSummary' })
export class AdminPaymentsSummaryResponse {
  @ApiProperty({
    type: () => PaymentPeriodResponse,
    nullable: false,
    description: 'The period.',
  })
  period!: PaymentPeriodResponse;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: "Today's cinema date (the day of `kpis.failedToday`).",
  })
  cinemaDate!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T21:15:00+03:00',
    description: 'When the figures were computed (Cairo time).',
  })
  serverTime!: string;

  @ApiProperty({
    type: () => PaymentKpisResponse,
    nullable: false,
    description: 'The four cards.',
  })
  kpis!: PaymentKpisResponse;

  @ApiProperty({
    type: () => PaymentTotalsResponse,
    nullable: false,
    description: 'Money moved in the period, every rail.',
  })
  totals!: PaymentTotalsResponse;

  @ApiProperty({
    type: () => ChannelTotalsResponse,
    isArray: true,
    nullable: false,
    description: '`online`, then `counter`, always both.',
  })
  byChannel!: ChannelTotalsResponse[];

  @ApiProperty({
    type: () => MethodTotalsResponse,
    isArray: true,
    nullable: false,
    description: '`card`, `wallet`, `cash`, `card_terminal`, always all four.',
  })
  byMethod!: MethodTotalsResponse[];

  @ApiProperty({
    type: () => FailedCountsResponse,
    nullable: false,
    description: 'Charges that failed in the period.',
  })
  failed!: FailedCountsResponse;

  @ApiProperty({
    type: () => ReconciliationResponse,
    nullable: false,
    description: 'Reconciliation by theater, the provider check and the mismatches.',
  })
  reconciliation!: ReconciliationResponse;
}
