import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { AGE_RATINGS, CREDIT_ROLES, MOVIE_STATUSES } from '../../catalog/enums';
import type { AgeRating, CreditRole, MovieStatus } from '../../catalog/types';
import { ImageResponse } from '../../media/dto/image.response';
import { THEATER_STATUSES } from '../../theaters/enums';
import type { TheaterStatus } from '../../theaters/types';

/** The credited person whose name made a movie a hit. */
@ApiSchema({ name: 'SearchMatchedPerson' })
export class SearchMatchedPersonResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 4, description: 'Person id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Ahmed Helmy', description: 'Full name.' })
  fullName!: string;
}

/** A movie found by its title or its cast. */
@ApiSchema({ name: 'SearchMovie' })
export class SearchMovieResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 12,
    description:
      'Movie id: open `GET /movies/{id}` on the customer site, `GET /admin/movies/{id}` in the dashboard.',
  })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Inception', description: 'Title.' })
  title!: string;

  @ApiProperty({
    enum: MOVIE_STATUSES,
    enumName: 'CatalogMovieStatus',
    nullable: false,
    example: 'now_showing',
    description:
      'The public search only ever answers `coming_soon` or `now_showing`; the admin search any status, drafts and archived included.',
  })
  status!: MovieStatus;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-10-01',
    description: 'Release date; null only on a draft without one (admin search).',
  })
  releaseDate!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 1,
    example: 148,
    description: 'Runtime in minutes; null only on a draft without one (admin search).',
  })
  runtimeMinutes!: number | null;

  @ApiProperty({
    enum: AGE_RATINGS,
    enumName: 'AgeRating',
    nullable: false,
    example: '12+',
    description: 'Age rating.',
  })
  ageRating!: AgeRating;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'The 2:3 poster, or null when none is uploaded.',
  })
  poster!: ImageResponse | null;

  @ApiProperty({
    type: () => SearchMatchedPersonResponse,
    nullable: true,
    description:
      'When the movie was found by its cast or crew ("title or cast"): the best matching credited person. Null when the title matched at least as well.',
  })
  matchedPerson!: SearchMatchedPersonResponse | null;
}

/** A person found by their name. */
@ApiSchema({ name: 'SearchPerson' })
export class SearchPersonResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 4,
    description:
      'Person id: on the customer site open the Movies page filtered by them (`/movies?people=<id>`), in the dashboard `GET /admin/people/{id}`.',
  })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Ahmed Helmy', description: 'Full name.' })
  fullName!: string;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Square photo, or null when none is set.',
  })
  photo!: ImageResponse | null;

  @ApiProperty({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    isArray: true,
    nullable: false,
    example: ['actor', 'writer'],
    description:
      'Their roles in the credit role order: those set on the person plus those they are credited with (publicly, only credits on Coming soon and Now showing movies).',
  })
  roles!: CreditRole[];
}

/** A theater found by its name or its area (district). */
@ApiSchema({ name: 'SearchTheater' })
export class SearchTheaterResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    example: 3,
    description:
      'Theater id: open `GET /theaters/{id}` on the customer site, `GET /admin/theaters/{id}` in the dashboard.',
  })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'Maqady Zamalek',
    description: 'Name.',
  })
  name!: string;

  @ApiProperty({
    enum: THEATER_STATUSES,
    enumName: 'TheaterStatus',
    nullable: false,
    example: 'active',
    description:
      'The public search only ever answers `active` (open for sales); the admin search any status.',
  })
  status!: TheaterStatus;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'Zamalek',
    description: 'District: the area people search by.',
  })
  district!: string;

  @ApiProperty({ type: String, nullable: false, example: 'Cairo', description: 'City.' })
  city!: string;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'The cover photo, or null when none is set.',
  })
  cover!: ImageResponse | null;
}

@ApiSchema({ name: 'SearchMovieGroup' })
export class SearchMovieGroupResponse {
  @ApiProperty({
    type: () => [SearchMovieResponse],
    nullable: false,
    description:
      'Best match first: a whole title, then a title starting with the query, then one containing it, then one with a typo; a title match before a cast match of the same kind. At most 5 publicly, 10 in the dashboard. Empty when nothing matches.',
  })
  items!: SearchMovieResponse[];

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description: 'True when more movies matched than are listed ("See all").',
  })
  hasMore!: boolean;
}

@ApiSchema({ name: 'SearchPersonGroup' })
export class SearchPersonGroupResponse {
  @ApiProperty({
    type: () => [SearchPersonResponse],
    nullable: false,
    description:
      'Best match first (a whole name, a name starting with the query, containing it, then with a typo). At most 5 publicly, 10 in the dashboard. Empty when nothing matches.',
  })
  items!: SearchPersonResponse[];

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description: 'True when more people matched than are listed.',
  })
  hasMore!: boolean;
}

@ApiSchema({ name: 'SearchTheaterGroup' })
export class SearchTheaterGroupResponse {
  @ApiProperty({
    type: () => [SearchTheaterResponse],
    nullable: false,
    description:
      'Best match first; a name match before a district match of the same kind. At most 5 publicly, 10 in the dashboard. Empty when nothing matches.',
  })
  items!: SearchTheaterResponse[];

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description: 'True when more theaters matched than are listed.',
  })
  hasMore!: boolean;
}

/** `GET /search`: the customer site's search results page, grouped. */
@ApiSchema({ name: 'SearchResults' })
export class SearchResultsResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    example: 'Incepton',
    description: 'The query that was searched, trimmed.',
  })
  q!: string;

  @ApiProperty({
    type: () => SearchMovieGroupResponse,
    nullable: false,
    description: 'Coming soon and Now showing movies by title or cast.',
  })
  movies!: SearchMovieGroupResponse;

  @ApiProperty({
    type: () => SearchPersonGroupResponse,
    nullable: false,
    description: 'People credited on a Coming soon or Now showing movie, by name.',
  })
  people!: SearchPersonGroupResponse;

  @ApiProperty({
    type: () => SearchTheaterGroupResponse,
    nullable: false,
    description: 'Theaters open for sales (`active`), by name or district.',
  })
  theaters!: SearchTheaterGroupResponse;
}
