import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { CURRENCIES } from '../enums';
import { MAX_PRICE_AMOUNT } from '../money.constants';
import type { Currency } from '../types';

/**
 * A price in a request: `{ "amount": 19000, "currency": "EGP" }` is EGP 190.00 (design §11). The
 * amount is whole piastres, from 1 to `MAX_PRICE_AMOUNT`: a seat is never free and never a
 * fraction of a piastre. Theater zone prices (U4b) and showtime prices (U7) use it.
 */
export class MoneyRequest {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: MAX_PRICE_AMOUNT,
    example: 19000,
    description: `Whole minor units: piastres for EGP, so 19000 is EGP 190.00. From 1 to ${MAX_PRICE_AMOUNT}.`,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_AMOUNT)
  amount!: number;

  @ApiProperty({
    type: String,
    enum: [...CURRENCIES],
    nullable: false,
    example: 'EGP',
    description: 'ISO 4217 currency code. Always EGP in v1.',
  })
  @IsIn(CURRENCIES)
  currency!: Currency;
}
