import { ApiProperty } from '@nestjs/swagger';

/** What `PATCH /admin/movies` (bulk archive) did. */
export class BulkArchiveMoviesResponse {
  @ApiProperty({
    type: 'integer',
    isArray: true,
    nullable: false,
    example: [12],
    description: 'The movies archived by this request, ascending.',
  })
  archivedIds!: number[];

  @ApiProperty({
    type: 'integer',
    isArray: true,
    nullable: false,
    example: [14],
    description: 'The movies that were archived already, ascending; left unchanged.',
  })
  alreadyArchivedIds!: number[];
}
