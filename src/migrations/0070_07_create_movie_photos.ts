import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U6 (#7): a movie's photos (design §6.2, PRD A2 "Media tab"): an uploaded gallery image with a
 * type (Still or Behind the scenes) and an optional caption, in display order. One of them may
 * be the movie's backdrop (0070_09).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE movie_photos (
      id BIGSERIAL PRIMARY KEY,
      movie_id BIGINT NOT NULL,
      image_id BIGINT NOT NULL,
      kind VARCHAR(20) NOT NULL,
      caption VARCHAR(200) NULL,
      sort_order SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_movie_photos_movie_id
        FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
      CONSTRAINT fk_movie_photos_image_id FOREIGN KEY (image_id) REFERENCES images (id),
      CONSTRAINT chk_movie_photos_kind CHECK (kind IN ('still', 'behind_the_scenes')),
      CONSTRAINT chk_movie_photos_caption CHECK (btrim(caption) = caption AND length(caption) >= 1),
      CONSTRAINT chk_movie_photos_sort_order CHECK (sort_order >= 0)
    )
  `);
  await knex.raw(
    "COMMENT ON TABLE movie_photos IS 'Photos of movies, in display order; the backdrop is one of them (design 6.2).'",
  );
  await knex.raw('CREATE UNIQUE INDEX uq_movie_photos_image_id ON movie_photos (image_id)');
  await knex.raw('CREATE UNIQUE INDEX uq_movie_photos_id_movie_id ON movie_photos (id, movie_id)');
  await knex.raw(
    'CREATE INDEX idx_movie_photos_movie_id_sort_order ON movie_photos (movie_id, sort_order, id)',
  );

  const comments: [string, string][] = [
    [
      'uq_movie_photos_image_id',
      'Covers fk_movie_photos_image_id (deleting an image checks WHERE image_id = ?); an image is one photo.',
    ],
    [
      'uq_movie_photos_id_movie_id',
      'Target of fk_movies_backdrop_photo: the backdrop (backdrop_photo_id, id) must be a photo of the same movie.',
    ],
    [
      'idx_movie_photos_movie_id_sort_order',
      'Photos of movies in display order: WHERE movie_id IN (...) ORDER BY movie_id, sort_order, id. Covers fk_movie_photos_movie_id.',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE movie_photos ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.movie_photos', [schema]);
}
