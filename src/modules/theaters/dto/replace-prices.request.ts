import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsObject, ValidateBy, ValidateNested } from 'class-validator';
import { MoneyRequest } from '../../../common/money/dto/money-request.dto';

/** The three prices share the front price's currency. */
function SameCurrencyAsFront(): PropertyDecorator {
  return ValidateBy({
    name: 'sameCurrencyAsFront',
    validator: {
      validate: (value: unknown, args) => {
        const front = (args?.object as Partial<ReplacePricesRequest> | undefined)?.front;
        const currency = (value as Partial<MoneyRequest> | null)?.currency;
        return front?.currency === undefined || currency === front.currency;
      },
      defaultMessage: (args) => `${args?.property ?? 'price'} must be in the currency of front`,
    },
  });
}

/**
 * `PUT /admin/theaters/{id}/prices`: the default price of each seat zone (PRD "Prices"). A new
 * showtime copies them; an admin can then change that showtime's prices.
 */
export class ReplacePricesRequest {
  @ApiProperty({
    type: () => MoneyRequest,
    description: 'Front rows (nearest the screen).',
    example: { amount: 15000, currency: 'EGP' },
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyRequest)
  front!: MoneyRequest;

  @ApiProperty({
    type: () => MoneyRequest,
    description: 'Middle rows. Same currency as `front`.',
    example: { amount: 19000, currency: 'EGP' },
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyRequest)
  @SameCurrencyAsFront()
  middle!: MoneyRequest;

  @ApiProperty({
    type: () => MoneyRequest,
    description: 'Back rows. Same currency as `front`.',
    example: { amount: 23000, currency: 'EGP' },
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MoneyRequest)
  @SameCurrencyAsFront()
  back!: MoneyRequest;
}
