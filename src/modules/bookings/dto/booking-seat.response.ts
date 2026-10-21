import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { ZONES } from '../../halls/enums';
import type { Zone } from '../../halls/types';

/** One seat of a booking, with the zone and price it was held at (design §7.10). */
@ApiSchema({ name: 'BookingSeat' })
export class BookingSeatResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    example: 'F7',
    description: 'Seat label: row letter and seat number.',
  })
  label!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^[A-HJ-P]$',
    example: 'F',
    description: 'Row letter, A nearest the screen.',
  })
  rowLabel!: string;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: 20,
    example: 7,
    description: 'Seat number from the left.',
  })
  seatNumber!: number;

  @ApiProperty({
    enum: ZONES,
    enumName: 'SeatZone',
    nullable: false,
    example: 'middle',
    description: "The seat's zone when it was held; it decided the price.",
  })
  zone!: Zone;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description:
      'The price of this seat, fixed when the hold was made ("Price confirmed by Maqady").',
  })
  price!: MoneyResponse;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description: 'True for a wheelchair space.',
  })
  isWheelchair!: boolean;
}
