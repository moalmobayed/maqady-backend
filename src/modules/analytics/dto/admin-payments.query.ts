import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { PAYMENT_KINDS, PAYMENT_METHODS } from '../../payments/enums';
import type { PaymentKind, PaymentMethod } from '../../payments/types';
import { IsCinemaDate } from '../../showtimes/dto/showtime.validators';
import { PAYMENT_CHANNELS, TRANSACTION_STATUSES } from '../enums';
import type { PaymentChannel, TransactionStatus } from '../types';

/**
 * `GET /admin/payments?kind=&method=&channel=&status=&theaterId=&dateFrom=&dateTo=&cursor=&limit=`
 * (PRD A8 "Filters by method, status and date range"). Every filter is optional and they combine
 * (AND).
 */
export class AdminPaymentsQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: PAYMENT_KINDS,
    enumName: 'PaymentKind',
    nullable: false,
    example: 'refund',
    description: 'Only charges (money taken) or only refunds (money given back).',
  })
  @IsOptional()
  @IsIn(PAYMENT_KINDS)
  kind?: PaymentKind;

  @ApiPropertyOptional({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    nullable: false,
    example: 'cash',
    description:
      'Only rows on this rail: `card`, `wallet` (online), `cash` or `card_terminal` (at the counter). A refund is on its charge’s rail.',
  })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional({
    enum: PAYMENT_CHANNELS,
    enumName: 'PaymentChannel',
    nullable: false,
    example: 'counter',
    description: '`online` (card and wallet) or `counter` (cash and card terminal).',
  })
  @IsOptional()
  @IsIn(PAYMENT_CHANNELS)
  channel?: PaymentChannel;

  @ApiPropertyOptional({
    enum: TRANSACTION_STATUSES,
    enumName: 'TransactionStatus',
    nullable: false,
    example: 'pending',
    description:
      'Only rows shown with this status: `succeeded`, `pending` (a payment in progress, or a counter refund waiting to be paid out), `failed` (declined, or a closed wallet) or `refunded` (a charge whose succeeded refunds reach its amount).',
  })
  @IsOptional()
  @IsIn(TRANSACTION_STATUSES)
  status?: TransactionStatus;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 1,
    description: 'Only rows of bookings for showtimes at this theater.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  theaterId?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-10',
    description:
      'Rows whose money moved (or, while processing or pending, that were written) on or after this cinema date (`YYYY-MM-DD`; a cinema day runs from 06:00 to 06:00 Cairo time). With `dateTo` for the period the summary shows.',
  })
  @IsOptional()
  @IsCinemaDate()
  dateFrom?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'Rows on or before this cinema date (inclusive: until 06:00 the next morning). Not before `dateFrom`.',
  })
  @IsOptional()
  @IsCinemaDate()
  dateTo?: string;
}

/** `GET /admin/payments/summary?dateFrom=&dateTo=` (PRD A8 "Period picker (default last 7 days)"). */
export class AdminPaymentsSummaryQuery {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-10',
    description:
      'The first cinema date of the period (`YYYY-MM-DD`, from 06:00 Cairo time). Omitted: 6 days before `dateTo`, so the default period is the last 7 cinema days.',
  })
  @IsOptional()
  @IsCinemaDate()
  dateFrom?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'The last cinema date of the period, inclusive (until 06:00 the next morning). Omitted: today. Not before `dateFrom`; at most 366 days in all.',
  })
  @IsOptional()
  @IsCinemaDate()
  dateTo?: string;
}
