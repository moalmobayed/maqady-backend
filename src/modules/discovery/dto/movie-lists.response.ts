import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SIMILAR_MOVIES_LIMIT } from '../../catalog/catalog.constants';
import { MovieCardResponse } from './movie-card.response';

/** How many movies each tab of the Movies page has with the current filters. */
@ApiSchema({ name: 'MovieTabCounts' })
export class MovieTabCountsResponse {
  @ApiProperty({ type: 'integer', minimum: 0, example: 7, description: 'Now showing movies.' })
  nowShowing!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 4, description: 'Coming soon movies.' })
  comingSoon!: number;
}

/** `GET /movies`: one page of a tab, with both tabs' counts. */
@ApiSchema({ name: 'MovieCardPage' })
export class MovieCardPageResponse {
  @ApiProperty({
    type: () => [MovieCardResponse],
    description: 'This page, in the tab order. Empty when nothing matches ("No matches").',
  })
  items!: MovieCardResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'WyIyMDI2LTEwLTAxIiwxMl0',
    description: 'Pass as `cursor` to get the next page ("Load more"); null on the last page.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 7,
    description: 'How many movies this tab has with these filters ("Showing n of total").',
  })
  total!: number;

  @ApiProperty({
    type: () => MovieTabCountsResponse,
    description: 'Both tabs’ totals with the same filters, for the tab labels.',
  })
  tabCounts!: MovieTabCountsResponse;
}

/** `GET /movies/{id}/similar`: "More like this". */
@ApiSchema({ name: 'SimilarMovies' })
export class SimilarMoviesResponse {
  @ApiProperty({
    type: () => [MovieCardResponse],
    maxItems: SIMILAR_MOVIES_LIMIT,
    description: `Up to ${SIMILAR_MOVIES_LIMIT} Now showing movies sharing the most genres, then newest release first.`,
  })
  items!: MovieCardResponse[];
}
