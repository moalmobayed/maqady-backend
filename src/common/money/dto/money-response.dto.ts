import { ApiProperty } from '@nestjs/swagger';
import { CURRENCIES } from '../enums';
import type { Currency } from '../types';

/** Money in a response: `{ "amount": 19000, "currency": "EGP" }` is EGP 190.00 (design §11). */
export class MoneyResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 19000,
    description: 'Whole minor units: piastres for EGP, so 19000 is EGP 190.00. Never a fraction.',
  })
  amount!: number;

  @ApiProperty({
    type: String,
    enum: [...CURRENCIES],
    nullable: false,
    example: 'EGP',
    description: 'ISO 4217 currency code. Always EGP in v1.',
  })
  currency!: Currency;
}
