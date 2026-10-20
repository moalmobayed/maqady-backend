import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import type { GenreRef } from '../types';

/** A genre (home-page contract `GenreRef`). U8 reuses it in the public responses. */
@ApiSchema({ name: 'GenreRef' })
export class GenreRefResponse {
  @ApiProperty({ type: 'integer', description: 'Genre id.', example: 9 })
  id!: number;

  @ApiProperty({ type: String, description: 'Display name.', example: 'Sci-fi' })
  name!: string;

  @ApiProperty({
    type: String,
    example: 'sci-fi',
    description: 'Stable URL-safe name, for links such as `/movies?genres=sci-fi`',
  })
  slug!: string;
}

export function toGenreRefResponse(genre: GenreRef): GenreRefResponse {
  return Object.assign(new GenreRefResponse(), {
    id: genre.id,
    name: genre.name,
    slug: genre.slug,
  });
}
