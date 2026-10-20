import { ApiProperty } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';
import { FACILITIES, THEATER_STATUSES } from '../enums';
import type { Facility, TheaterStatus } from '../types';
import { DayHoursResponse } from './day-hours.response';
import { OpenStateResponse } from './open-state.response';
import { SpecialDateResponse } from './special-date.response';
import { TheaterPhoneResponse } from './theater-phone.response';
import { TheaterPhotoResponse } from './theater-photo.response';
import { ZonePricesResponse } from './zone-prices.response';

/** A theater as the admin theater page shows it (PRD A4): every tab but Halls and Overview. */
export class TheaterResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Theater id.' })
  id!: number;

  @ApiProperty({ type: String, example: 'Maqady Zamalek', description: 'Theater name.' })
  name!: string;

  @ApiProperty({
    enum: THEATER_STATUSES,
    enumName: 'TheaterStatus',
    example: 'active',
    description:
      '`draft`: being set up, hidden from customers. `active`: on the site and selling. `sales_paused`: hidden from customers; existing tickets stay valid.',
  })
  status!: TheaterStatus;

  @ApiProperty({ type: String, example: '26 July Street, Zamalek', description: 'Street address.' })
  address!: string;

  @ApiProperty({ type: String, example: 'Zamalek', description: 'District or area.' })
  district!: string;

  @ApiProperty({ type: String, example: 'Cairo', description: 'City.' })
  city!: string;

  @ApiProperty({ type: Number, example: 30.0609, description: 'Latitude, decimal degrees.' })
  latitude!: number;

  @ApiProperty({ type: Number, example: 31.2197, description: 'Longitude, decimal degrees.' })
  longitude!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Metro: Opera station, then a 10-minute walk.',
    description: '"Public transport", or null.',
  })
  transitInfo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Valet parking at the main entrance.',
    description: '"Parking", or null.',
  })
  parkingInfo!: string | null;

  @ApiProperty({
    type: String,
    format: 'email',
    nullable: true,
    example: 'zamalek@maqady.example',
    description: 'Contact email, or null.',
  })
  email!: string | null;

  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'True when phones and email are shown on the website.',
  })
  showContactsPublic!: boolean;

  @ApiProperty({
    type: () => [TheaterPhoneResponse],
    description: 'Phones in display order; the first is the main phone.',
  })
  phones!: TheaterPhoneResponse[];

  @ApiProperty({
    enum: FACILITIES,
    enumName: 'Facility',
    isArray: true,
    example: ['wheelchair_access', 'valet_parking'],
    description: 'Facilities, in the order of the facility list.',
  })
  facilities!: Facility[];

  @ApiProperty({
    type: () => [DayHoursResponse],
    description: 'Weekly hours by weekday (1–7); empty until they are first set.',
  })
  hours!: DayHoursResponse[];

  @ApiProperty({
    type: () => [SpecialDateResponse],
    description: "Special dates from today's cinema date on, by date.",
  })
  specialDates!: SpecialDateResponse[];

  @ApiProperty({
    type: () => ZonePricesResponse,
    nullable: true,
    description: 'Default zone prices; null until they are first set.',
  })
  defaultPrices!: ZonePricesResponse | null;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'The 16:9 cover photo, or null; its alternative text is the theater name.',
  })
  cover!: ImageResponse | null;

  @ApiProperty({ type: () => [TheaterPhotoResponse], description: 'Gallery, in order.' })
  photos!: TheaterPhotoResponse[];

  @ApiProperty({
    type: () => OpenStateResponse,
    description: 'Whether the theater is open now, by its hours (whatever its status).',
  })
  openState!: OpenStateResponse;

  @ApiProperty({
    type: String,
    isArray: true,
    example: ['prices', 'hours'],
    description:
      "What a draft still needs before it can be published: `prices`, `hours`, `active_hall`. Empty when it is ready, and for a theater that isn't a draft.",
  })
  publishBlockers!: string[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-01T10:00:00+03:00',
    description: 'When the theater was created.',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-16T14:52:00+03:00',
    description: 'When the theater or any of its details last changed.',
  })
  updatedAt!: string;
}
