import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U6 (#7): a movie's genres, at most five, in display order (design §6.2; home-page contract
 * "In display order; the first one is the 'first genre' shown on Now showing cards").
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE movie_genres (
      movie_id BIGINT NOT NULL,
      genre_id BIGINT NOT NULL,
      sort_order SMALLINT NOT NULL,
      CONSTRAINT pk_movie_genres PRIMARY KEY (movie_id, genre_id),
      CONSTRAINT fk_movie_genres_movie_id
        FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
      CONSTRAINT fk_movie_genres_genre_id FOREIGN KEY (genre_id) REFERENCES genres (id),
      CONSTRAINT chk_movie_genres_sort_order CHECK (sort_order BETWEEN 0 AND 4),
      CONSTRAINT uq_movie_genres_movie_id_sort_order UNIQUE (movie_id, sort_order)
    )
  `);
  await knex.raw(
    "COMMENT ON TABLE movie_genres IS 'Movie to genre, up to five per movie in display order (design 6.2).'",
  );
  await knex.raw(
    'CREATE INDEX idx_movie_genres_genre_id_movie_id ON movie_genres (genre_id, movie_id)',
  );

  const comments: [string, string][] = [
    [
      'pk_movie_genres',
      'Genres of movies: WHERE movie_id IN (...). Covers fk_movie_genres_movie_id.',
    ],
    [
      'uq_movie_genres_movie_id_sort_order',
      "Display order of a movie's genres: ORDER BY movie_id, sort_order; one genre per place.",
    ],
    [
      'idx_movie_genres_genre_id_movie_id',
      'Movies in genres: WHERE genre_id IN (...) (public genre filter, genre counts, similar movies). Covers fk_movie_genres_genre_id.',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE movie_genres ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.movie_genres', [schema]);
}
