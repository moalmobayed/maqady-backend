import { ApiProperty } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';
import { THEATER_STATUSES } from '../enums';
import type { TheaterStatus } from '../types';
import { OpenStateResponse } from './open-state.response';
import { TheaterPhoneResponse } from './theater-phone.response';
import { TodayHoursResponse } from './today-hours.response';

/** One row of the admin theater list (PRD A4). */
export class TheaterListItemResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Theater id.' })
  id!: number;

  @ApiProperty({ type: String, example: 'Maqady Zamalek', description: 'Theater name.' })
  name!: string;

  @ApiProperty({
    enum: THEATER_STATUSES,
    enumName: 'TheaterStatus',
    example: 'active',
    description: 'Draft, Active or Sales paused.',
  })
  status!: TheaterStatus;

  @ApiProperty({ type: String, example: '26 July Street, Zamalek', description: 'Street address.' })
  address!: string;

  @ApiProperty({ type: String, example: 'Zamalek', description: 'District or area.' })
  district!: string;

  @ApiProperty({ type: String, example: 'Cairo', description: 'City.' })
  city!: string;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'The cover photo, or null.',
  })
  cover!: ImageResponse | null;

  @ApiProperty({
    type: () => TheaterPhoneResponse,
    nullable: true,
    description:
      'The first phone, or null when there is none (shown to admins whatever `showContactsPublic` is).',
  })
  mainPhone!: TheaterPhoneResponse | null;

  @ApiProperty({ type: () => OpenStateResponse, description: 'Whether it is open now.' })
  openState!: OpenStateResponse;

  @ApiProperty({ type: () => TodayHoursResponse, description: "Today's hours." })
  today!: TodayHoursResponse;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-16T14:52:00+03:00',
    description: 'When the theater or any of its details last changed.',
  })
  updatedAt!: string;
}
