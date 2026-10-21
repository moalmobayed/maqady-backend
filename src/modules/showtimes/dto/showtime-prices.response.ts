import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';

/** A showtime's price per seat zone (design §7.10); reused by the public showtime routes. */
@ApiSchema({ name: 'ShowtimePrices' })
export class ShowtimePricesResponse {
  @ApiProperty({ type: () => MoneyResponse, description: 'Front rows (nearest the screen).' })
  front!: MoneyResponse;

  @ApiProperty({ type: () => MoneyResponse, description: 'Middle rows.' })
  middle!: MoneyResponse;

  @ApiProperty({ type: () => MoneyResponse, description: 'Back rows.' })
  back!: MoneyResponse;
}
