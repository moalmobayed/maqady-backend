import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { ZONES } from '../../halls/enums';
import type { Zone } from '../../halls/types';

/** One line of a booking's payment table (PRD C8, C11): "Middle · F7, F8 · 2 × EGP 190". */
@ApiSchema({ name: 'SeatLine' })
export class SeatLineResponse {
  @ApiProperty({
    enum: ZONES,
    enumName: 'SeatZone',
    nullable: false,
    example: 'middle',
    description: 'The zone. Lines come front to back: `front`, `middle`, `back`.',
  })
  zone!: Zone;

  @ApiProperty({
    type: String,
    isArray: true,
    nullable: false,
    example: ['F7', 'F8'],
    description: 'The seats of this line in seat order: by row, then number (`F2` before `F10`).',
  })
  labels!: string[];

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 2,
    description: 'How many seats the line has.',
  })
  count!: number;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'The price of one seat of the line, as it was held.',
  })
  unitPrice!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: '`count × unitPrice`. The lines add up to the booking total.',
  })
  amount!: MoneyResponse;
}
