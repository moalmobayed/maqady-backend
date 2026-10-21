import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U6 (#7): a movie's backdrop and hero video must be its own photo and video. Composite foreign
 * keys onto `(id, movie_id)` enforce it; `MATCH SIMPLE` leaves them unchecked while the column is
 * NULL. Both are `NO ACTION`, checked at the end of the statement, so deleting a movie (which
 * cascades to its photos and videos) passes, while deleting a photo or video that is still the
 * backdrop or hero fails: the service clears the column first.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE movies
      ADD CONSTRAINT fk_movies_backdrop_photo
        FOREIGN KEY (backdrop_photo_id, id) REFERENCES movie_photos (id, movie_id),
      ADD CONSTRAINT fk_movies_hero_video
        FOREIGN KEY (hero_video_id, id) REFERENCES movie_videos (id, movie_id)
  `);
  await knex.raw(
    'CREATE INDEX idx_movies_backdrop_photo_id_id ON movies (backdrop_photo_id, id) WHERE backdrop_photo_id IS NOT NULL',
  );
  await knex.raw(
    'CREATE INDEX idx_movies_hero_video_id_id ON movies (hero_video_id, id) WHERE hero_video_id IS NOT NULL',
  );

  const comments: [string, string][] = [
    [
      'idx_movies_backdrop_photo_id_id',
      'Covers fk_movies_backdrop_photo: deleting a photo checks movies WHERE backdrop_photo_id = ? AND id = ?.',
    ],
    [
      'idx_movies_hero_video_id_id',
      'Covers fk_movies_hero_video: deleting a video checks movies WHERE hero_video_id = ? AND id = ?.',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS ??.idx_movies_hero_video_id_id', [schema]);
  await knex.raw('DROP INDEX IF EXISTS ??.idx_movies_backdrop_photo_id_id', [schema]);
  await knex.raw(
    'ALTER TABLE ??.movies DROP CONSTRAINT IF EXISTS fk_movies_hero_video, DROP CONSTRAINT IF EXISTS fk_movies_backdrop_photo',
    [schema],
  );
}
