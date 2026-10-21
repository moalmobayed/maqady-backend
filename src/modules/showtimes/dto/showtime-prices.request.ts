import { ApiSchema } from '@nestjs/swagger';
import { ReplacePricesRequest } from '../../theaters/dto/replace-prices.request';

/**
 * A showtime's price per seat zone (design §7.10), with the theater default prices' rules: each
 * from 1 to 1,000,000 piastres, all three in the currency of `front`.
 */
@ApiSchema({ name: 'ShowtimePricesRequest' })
export class ShowtimePricesRequest extends ReplacePricesRequest {}
