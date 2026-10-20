import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';
import { DayHoursResponse } from '../../theaters/dto/day-hours.response';
import { OpenStateResponse } from '../../theaters/dto/open-state.response';
import { SpecialDateResponse } from '../../theaters/dto/special-date.response';
import { TheaterPhoneResponse } from '../../theaters/dto/theater-phone.response';
import { TodayHoursResponse } from '../../theaters/dto/today-hours.response';
import type { Facility } from '../../theaters/types';
import { FACILITY_ENUM, TheaterCardResponse } from './theater-card.response';

/** A card of the Theaters page and its map (PRD C4): the home card plus location and hours. */
@ApiSchema({ name: 'PublicTheaterListItem' })
export class PublicTheaterListItemResponse extends TheaterCardResponse {
  @ApiProperty({ type: Number, example: 30.0609, description: 'Latitude, for the map.' })
  latitude!: number;

  @ApiProperty({ type: Number, example: 31.2197, description: 'Longitude, for the map.' })
  longitude!: number;

  @ApiProperty({
    type: () => TodayHoursResponse,
    description: "Today's hours (the cinema day), including a special date's.",
  })
  today!: TodayHoursResponse;

  @ApiProperty({
    type: () => [DayHoursResponse],
    description: 'The weekly hours, Monday (1) to Sunday (7).',
  })
  weeklyHours!: DayHoursResponse[];
}

/** `GET /theaters`: one page of theater cards. */
@ApiSchema({ name: 'PublicTheaterPage' })
export class PublicTheaterPageResponse {
  @ApiProperty({
    type: () => [PublicTheaterListItemResponse],
    description: 'This page, alphabetical. Empty when nothing matches.',
  })
  items!: PublicTheaterListItemResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Pass as `cursor` to get the next page; null on the last page.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 5,
    description: 'How many theaters match.',
  })
  total!: number;
}

/** A gallery photo of a theater page. */
@ApiSchema({ name: 'TheaterGalleryPhoto' })
export class TheaterGalleryPhotoResponse {
  @ApiProperty({ type: 'integer', example: 3, description: 'Photo id.' })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'The lobby',
    description: 'Caption (also its alt text), or null.',
  })
  caption!: string | null;

  @ApiProperty({ type: () => ImageResponse, description: 'The photo in web sizes.' })
  image!: ImageResponse;
}

/** A theater's page (PRD C5). */
@ApiSchema({ name: 'PublicTheater' })
export class PublicTheaterResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Theater id.' })
  id!: number;

  @ApiProperty({ type: String, example: 'Maqady Zamalek', description: 'Name.' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '26 July Street, Zamalek',
    description: 'Street address.',
  })
  address!: string;

  @ApiProperty({ type: String, example: 'Zamalek', description: 'District or area.' })
  district!: string;

  @ApiProperty({ type: String, example: 'Cairo', description: 'City.' })
  city!: string;

  @ApiProperty({ type: Number, example: 30.0609, description: 'Latitude ("Directions").' })
  latitude!: number;

  @ApiProperty({ type: Number, example: 31.2197, description: 'Longitude ("Directions").' })
  longitude!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Metro: Opera station, 10 minutes on foot',
    description: 'How to get there, or null.',
  })
  transitInfo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Valet at the main entrance',
    description: 'Parking notes, or null.',
  })
  parkingInfo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'zamalek@maqady.example',
    description: 'Contact email; null when none is set or the theater hides its contacts.',
  })
  email!: string | null;

  @ApiProperty({
    type: () => [TheaterPhoneResponse],
    description: 'Phones, the main one first; empty when the theater hides its contacts.',
  })
  phones!: TheaterPhoneResponse[];

  @ApiProperty({
    ...FACILITY_ENUM,
    isArray: true,
    example: ['wheelchair_access', 'valet_parking'],
    description: 'Every facility, in the facility list order.',
  })
  facilities!: Facility[];

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Cover photo (16:9), or null when none is set.',
  })
  cover!: ImageResponse | null;

  @ApiProperty({
    type: () => [TheaterGalleryPhotoResponse],
    description: 'Gallery photos in the admin order.',
  })
  photos!: TheaterGalleryPhotoResponse[];

  @ApiProperty({
    type: () => OpenStateResponse,
    description: 'Open now, and until when; or when it opens next.',
  })
  openState!: OpenStateResponse;

  @ApiProperty({
    type: () => TodayHoursResponse,
    description: "Today's hours (the cinema day), including a special date's.",
  })
  today!: TodayHoursResponse;

  @ApiProperty({
    type: () => [DayHoursResponse],
    description: 'The weekly hours, Monday (1) to Sunday (7).',
  })
  weeklyHours!: DayHoursResponse[];

  @ApiProperty({
    type: () => [SpecialDateResponse],
    description:
      "Special dates in the next 7 cinema days (today included), by date; each replaces that day's weekly hours.",
  })
  specialDates!: SpecialDateResponse[];

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 6,
    description: 'How many halls the theater has.',
  })
  hallCount!: number;
}
