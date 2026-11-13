import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { GenreRefResponse } from '../../catalog/dto/genre-ref.response';
import { ImageResponse } from '../../media/dto/image.response';
import { PEOPLE_FACET_LIMIT } from '../discovery.constants';
import { SHOW_DATES } from '../enums';
import type { ShowDate } from '../types';

/** A genre of the Movies page sidebar with how many matching movies it has. */
@ApiSchema({ name: 'GenreFacet' })
export class GenreFacetResponse extends GenreRefResponse {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 3,
    description:
      'How many movies of the tab match every current filter except `genres` and have this genre ("Action 3"). 0 when none; a movie with two genres counts in both.',
  })
  count!: number;
}

/** A cast member of the Movies page sidebar with how many matching movies they are in. */
@ApiSchema({ name: 'PersonFacet' })
export class PersonFacetResponse {
  @ApiProperty({
    type: 'integer',
    example: 4,
    description: 'Person id; filter with `/movies?people=<id>`.',
  })
  id!: number;

  @ApiProperty({
    type: String,
    example: 'Karim Fahmy',
    description: 'Full name, as the chip shows it.',
  })
  fullName!: string;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Square photo for the avatar, or null when none is set.',
  })
  photo!: ImageResponse | null;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 2,
    description:
      'How many movies of the tab matching every current filter except `people` credit this person as an actor or a voice.',
  })
  count!: number;
}

/** A "show date" option of the Movies page sidebar with how many matching movies show then. */
@ApiSchema({ name: 'ShowDateFacet' })
export class ShowDateFacetResponse {
  @ApiProperty({
    enum: SHOW_DATES,
    enumName: 'ShowDate',
    example: 'today',
    description: 'The option, as `showDate` takes it: Today, Tomorrow or This weekend.',
  })
  value!: ShowDate;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 5,
    description:
      'How many movies of the tab matching every current filter except `showDate` have a showtime still to start on these cinema dates at a theater open for sales: what `showDate=<value>` would list. Always 0 on the Coming soon tab (only Now showing movies have showtimes).',
  })
  count!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    isArray: true,
    example: ['2026-10-16', '2026-10-17'],
    description:
      'The cinema dates the option covers, seen from now (a cinema day runs 06:00 to 06:00 Cairo time, so a 00:30 show belongs to the date before): today, tomorrow, or this weekend (Friday and Saturday; on a Friday from today, on a Saturday today only). For a label such as "This weekend · Fri 16 – Sat 17".',
  })
  cinemaDates!: string[];
}

/** The Movies page sidebar counts, over every matching movie of the tab, not only this page. */
@ApiSchema({ name: 'MovieFacets' })
export class MovieFacetsResponse {
  @ApiProperty({
    type: () => [GenreFacetResponse],
    description:
      'Every genre, alphabetical (the order of `GET /genres`), with its count. Ignores the `genres` filter so the other genres stay selectable; follows `status`, `q`, `people` and `showDate`.',
  })
  genres!: GenreFacetResponse[];

  @ApiProperty({
    type: () => [PersonFacetResponse],
    maxItems: PEOPLE_FACET_LIMIT,
    description: `The cast (actors and voices) of the matching movies, most movies first, then by name; at most ${PEOPLE_FACET_LIMIT}. Ignores the \`people\` filter; follows \`status\`, \`q\`, \`genres\` and \`showDate\`. Empty when nothing matches.`,
  })
  people!: PersonFacetResponse[];

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 42,
    description: `How many cast members match before the cap of ${PEOPLE_FACET_LIMIT} ("Show all 42"; find the others with \`GET /people?q=\`).`,
  })
  peopleTotal!: number;

  @ApiProperty({
    type: () => [ShowDateFacetResponse],
    description:
      'The show date options in the order `today`, `tomorrow`, `weekend`, each with its count and cinema dates. Ignores the `showDate` filter; follows `status`, `q`, `genres` and `people`.',
  })
  showDates!: ShowDateFacetResponse[];
}
