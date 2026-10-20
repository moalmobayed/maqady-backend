import { ApiProperty } from '@nestjs/swagger';
import type { IsoWeekday } from '../../../common/time/types';

/** The weekly hours of one weekday of the cinema date, as the hours editor shows them. */
export class DayHoursResponse {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 7,
    example: 5,
    description: 'ISO weekday of the cinema date: 1 = Monday … 7 = Sunday.',
  })
  weekday!: IsoWeekday;

  @ApiProperty({ type: Boolean, example: false, description: 'True when closed that day.' })
  closed!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '12:00',
    description: 'Opening time, `HH:mm` Cairo time; null when closed.',
  })
  opens!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '01:00',
    description: 'Closing time, `HH:mm` Cairo time; null when closed.',
  })
  closes!: string | null;

  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'True when `closes` is on the next calendar day (the editor\'s "next day" tag).',
  })
  closesNextDay!: boolean;
}
