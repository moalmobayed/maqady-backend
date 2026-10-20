import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U6 (#7): a movie's YouTube videos (design §6.2, §9): only the 11-character video id is
 * stored; the embed and thumbnail URLs are derived from it. The title, type and optional
 * duration are typed by the admin. One of them may be the movie's hero video (0070_09).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE movie_videos (
      id BIGSERIAL PRIMARY KEY,
      movie_id BIGINT NOT NULL,
      youtube_id VARCHAR(11) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      title VARCHAR(120) NOT NULL,
      duration_seconds INT NULL,
      sort_order SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_movie_videos_movie_id
        FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
      CONSTRAINT chk_movie_videos_youtube_id CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
      CONSTRAINT chk_movie_videos_kind CHECK (kind IN ('trailer', 'teaser', 'clip', 'featurette')),
      CONSTRAINT chk_movie_videos_title CHECK (btrim(title) = title AND length(title) >= 1),
      CONSTRAINT chk_movie_videos_duration_seconds CHECK (duration_seconds BETWEEN 1 AND 36000),
      CONSTRAINT chk_movie_videos_sort_order CHECK (sort_order >= 0)
    )
  `);
  await knex.raw(
    "COMMENT ON TABLE movie_videos IS 'YouTube videos of movies, by video id, in display order; the hero video is one of them (design 6.2, 9).'",
  );
  await knex.raw(
    'CREATE UNIQUE INDEX uq_movie_videos_movie_id_youtube_id ON movie_videos (movie_id, youtube_id)',
  );
  await knex.raw('CREATE UNIQUE INDEX uq_movie_videos_id_movie_id ON movie_videos (id, movie_id)');
  await knex.raw(
    'CREATE INDEX idx_movie_videos_movie_id_sort_order ON movie_videos (movie_id, sort_order, id)',
  );

  const comments: [string, string][] = [
    [
      'uq_movie_videos_movie_id_youtube_id',
      'The same YouTube video at most once per movie: WHERE movie_id = ? AND youtube_id = ?.',
    ],
    [
      'uq_movie_videos_id_movie_id',
      'Target of fk_movies_hero_video: the hero (hero_video_id, id) must be a video of the same movie.',
    ],
    [
      'idx_movie_videos_movie_id_sort_order',
      'Videos of movies in display order: WHERE movie_id IN (...) ORDER BY movie_id, sort_order, id. Covers fk_movie_videos_movie_id.',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE movie_videos ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.movie_videos', [schema]);
}
