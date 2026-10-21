import { ApiProperty } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';
import { CREDIT_ROLES, MOVIE_STATUSES } from '../enums';
import type { CreditRole, MovieStatus } from '../types';

/** The movie of a filmography credit. */
export class PersonCreditMovieResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 1, description: 'Movie id.' })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'The Last Lighthouse',
    description: 'Title.',
  })
  title!: string;

  @ApiProperty({
    enum: MOVIE_STATUSES,
    enumName: 'CatalogMovieStatus',
    nullable: false,
    example: 'now_showing',
    description: 'The movie status.',
  })
  status!: MovieStatus;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-01',
    description: 'Release date.',
  })
  releaseDate!: string | null;

  @ApiProperty({ type: () => ImageResponse, nullable: true, description: 'Poster, or null.' })
  poster!: ImageResponse | null;
}

/** One credit on a person's filmography. */
export class PersonCreditResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 31, description: 'Credit id.' })
  id!: number;

  @ApiProperty({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    nullable: false,
    example: 'actor',
    description: 'The role on this movie.',
  })
  role!: CreditRole;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Youssef, the keeper',
    description: 'The character played, or null.',
  })
  characterName!: string | null;

  @ApiProperty({
    type: () => PersonCreditMovieResponse,
    nullable: false,
    description: 'The movie.',
  })
  movie!: PersonCreditMovieResponse;
}

/** A person as the admin editor shows them (PRD A3). */
export class AdminPersonResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 4, description: 'Person id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Karim Fahmy', description: 'Full name.' })
  fullName!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '1984-03-12',
    description: 'Birth date.',
  })
  birthDate!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Alexandria, Egypt',
    description: 'Birth place.',
  })
  birthPlace!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Egyptian', description: 'Nationality.' })
  nationality!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Stage actor turned screen lead.',
    description: 'Short biography.',
  })
  bio!: string | null;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Square photo, or null when none is set.',
  })
  photo!: ImageResponse | null;

  @ApiProperty({
    type: String,
    format: 'uri',
    nullable: true,
    example: 'https://www.instagram.com/example.actor',
    description: 'Instagram link.',
  })
  instagramUrl!: string | null;

  @ApiProperty({
    type: String,
    format: 'uri',
    nullable: true,
    example: 'https://www.imdb.com/name/nm0000001/',
    description: 'IMDb link.',
  })
  imdbUrl!: string | null;

  @ApiProperty({
    type: String,
    format: 'uri',
    nullable: true,
    example: 'https://example-actor.com',
    description: 'Website.',
  })
  websiteUrl!: string | null;

  @ApiProperty({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    isArray: true,
    nullable: false,
    example: ['actor'],
    description: 'The roles set on the person, in role-list order.',
  })
  roles!: CreditRole[];

  @ApiProperty({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    isArray: true,
    nullable: false,
    example: ['actor', 'director'],
    description: 'The roles the person is credited in on any movie, in role-list order.',
  })
  creditedRoles!: CreditRole[];

  @ApiProperty({
    type: () => [PersonCreditResponse],
    nullable: false,
    description: 'Filmography: newest release first, undated last, then title.',
  })
  credits!: PersonCreditResponse[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-01T10:00:00+03:00',
    description: 'When the person was created.',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T15:10:00+03:00',
    description: 'When the person last changed.',
  })
  updatedAt!: string;
}
