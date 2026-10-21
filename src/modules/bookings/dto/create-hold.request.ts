import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';
import { SEAT_LABEL_PATTERN } from '../../seating/seating.constants';
import { MAX_SEATS_PER_HOLD } from '../bookings.constants';

/** `POST /showtimes/{id}/holds`: the seats picked on the map. */
export class CreateHoldRequest {
  @ApiProperty({
    type: String,
    isArray: true,
    nullable: false,
    minItems: 1,
    maxItems: MAX_SEATS_PER_HOLD,
    uniqueItems: true,
    pattern: SEAT_LABEL_PATTERN.source,
    example: ['F7', 'F8'],
    description: `1 to ${MAX_SEATS_PER_HOLD} distinct seat labels: the row letter (A to P without I) and the seat number (1 to 20), as \`F7\`. Each must be a seat of the hall's current layout, not a gap (\`VALIDATION_FAILED\` on \`seats.<index>\` otherwise).`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEATS_PER_HOLD)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(SEAT_LABEL_PATTERN, {
    each: true,
    message: 'each seat must be a label such as F7 (row A to P without I, seat 1 to 20)',
  })
  seats!: string[];
}
