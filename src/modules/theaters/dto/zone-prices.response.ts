import { ApiProperty } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';

/** The default price of each seat zone (PRD "Prices"). */
export class ZonePricesResponse {
  @ApiProperty({ type: () => MoneyResponse, description: 'Front rows.' })
  front!: MoneyResponse;

  @ApiProperty({ type: () => MoneyResponse, description: 'Middle rows.' })
  middle!: MoneyResponse;

  @ApiProperty({ type: () => MoneyResponse, description: 'Back rows.' })
  back!: MoneyResponse;
}
