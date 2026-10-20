import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { defineComposedSchema } from '../../../common/swagger/composed-schemas';
import { GenreRefResponse } from '../../catalog/dto/genre-ref.response';

/**
 * A genre with how many public movies it has (contract `GenreWithCount`). The contract writes it
 * as `allOf: [GenreRef, { movieCount }]`, which @nestjs/swagger can't build from a class, so the
 * schema is composed by hand and properties reference it with `GENRE_WITH_COUNT_REF`.
 */
export class GenreWithCountResponse extends GenreRefResponse {
  movieCount!: number;
}

export const GENRE_WITH_COUNT_REF = defineComposedSchema('GenreWithCount', {
  description: 'A genre with how many Coming soon and Now showing movies it has.',
  allOf: [
    { $ref: getSchemaPath(GenreRefResponse) },
    {
      type: 'object',
      required: ['movieCount'],
      properties: {
        movieCount: {
          type: 'integer',
          minimum: 0,
          example: 4,
          description: 'Now showing plus Coming soon movies in this genre',
        },
      },
    },
  ],
});

/** `GET /genres`: one page of genres with their counts. */
export class GenreWithCountPage {
  @ApiProperty({
    type: 'array',
    items: { $ref: GENRE_WITH_COUNT_REF },
    description: 'This page, alphabetical. Empty when nothing matches.',
  })
  items!: GenreWithCountResponse[];

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
    example: 10,
    description: 'How many genres there are.',
  })
  total!: number;
}
