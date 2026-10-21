import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { AdminMovieListItemResponse } from './admin-movie-list-item.response';

/** How many movies have each status, with the list's search applied. */
export class StatusCountsResponse {
  @ApiProperty({ type: 'integer', nullable: false, minimum: 0, example: 3, description: 'Drafts.' })
  draft!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 4,
    description: 'Coming soon.',
  })
  comingSoon!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 9,
    description: 'Now showing.',
  })
  nowShowing!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 12,
    description: 'Archived.',
  })
  archived!: number;
}

/** `GET /admin/movies`: one page, newest first, with the status filter's counts. */
@ApiSchema({ name: 'AdminMoviePage' })
export class AdminMoviePageResponse {
  @ApiProperty({
    type: () => [AdminMovieListItemResponse],
    nullable: false,
    description: 'This page, newest first. Empty when nothing matches.',
  })
  items!: AdminMovieListItemResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'WyIyMDI2LTEwLTE2VDEyOjEwOjAwLjAwMFoiLDQyXQ',
    description: 'Pass as `cursor` to get the next page; null on the last page.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 28,
    description: 'How many movies match the search and status filter.',
  })
  total!: number;

  @ApiProperty({
    type: () => StatusCountsResponse,
    nullable: false,
    description: 'How many movies match the search in each status (the filter tabs).',
  })
  statusCounts!: StatusCountsResponse;
}
