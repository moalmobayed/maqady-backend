import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { AGE_RATINGS } from '../../catalog/enums';
import type { AgeRating } from '../../catalog/types';
import { ImageResponse } from '../../media/dto/image.response';

/** A movie as a booking and the seat page show it. */
@ApiSchema({ name: 'BookingMovie' })
export class BookingMovieResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 12, description: 'Movie id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'The Nile Light', description: 'Title.' })
  title!: string;

  @ApiProperty({
    enum: AGE_RATINGS,
    enumName: 'AgeRating',
    nullable: false,
    example: '12+',
    description: 'Age rating, shown in the seat page header.',
  })
  ageRating!: AgeRating;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 128,
    description: 'Runtime in minutes.',
  })
  runtimeMinutes!: number | null;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'The poster in every size (alt text: the title), or null without one.',
  })
  poster!: ImageResponse | null;
}

/** A theater or a hall, by id and name. */
@ApiSchema({ name: 'NamedRef' })
export class NamedRefResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 3, description: 'Id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Hall 3', description: 'Name.' })
  name!: string;
}

/** A theater as a booking names it, with where it is for "Directions" (PRD C9, C11). */
@ApiSchema({ name: 'BookingTheater' })
export class BookingTheaterResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 3, description: 'Theater id.' })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'Zamalek Cinema',
    description: 'Name.',
  })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    example: '26 July St',
    description: 'Street address.',
  })
  address!: string;

  @ApiProperty({ type: String, nullable: false, example: 'Zamalek', description: 'District.' })
  district!: string;

  @ApiProperty({ type: String, nullable: false, example: 'Cairo', description: 'City.' })
  city!: string;

  @ApiProperty({
    type: Number,
    nullable: false,
    minimum: -90,
    maximum: 90,
    example: 30.0626,
    description: 'Latitude, for the "Directions" link.',
  })
  latitude!: number;

  @ApiProperty({
    type: Number,
    nullable: false,
    minimum: -180,
    maximum: 180,
    example: 31.2197,
    description: 'Longitude, for the "Directions" link.',
  })
  longitude!: number;
}

/** The showtime of a booking, and the header of the seat page (PRD C6). */
@ApiSchema({ name: 'BookingShowtime' })
export class BookingShowtimeResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 81, description: 'Showtime id.' })
  id!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:30:00+03:00',
    description: 'Start, Cairo time with its offset.',
  })
  startsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T21:38:00+03:00',
    description: "End (start plus the movie's runtime), Cairo time with its offset.",
  })
  endsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The cinema day it belongs to (06:00 to 06:00 Cairo time).',
  })
  cinemaDate!: string;

  @ApiProperty({ type: () => BookingMovieResponse, nullable: false, description: 'The movie.' })
  movie!: BookingMovieResponse;

  @ApiProperty({
    type: () => BookingTheaterResponse,
    nullable: false,
    description: 'The theater, with its address and coordinates.',
  })
  theater!: BookingTheaterResponse;

  @ApiProperty({ type: () => NamedRefResponse, nullable: false, description: 'The hall.' })
  hall!: NamedRefResponse;
}
