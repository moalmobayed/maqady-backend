import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U6 (#7): movies (design §6.2, PRD A2). Status `draft`, `coming_soon`, `now_showing` or
 * `archived`; a public movie (Coming soon or Now showing) has a synopsis, runtime and release
 * date; a featured movie is public and has a hero video, and holds one carousel position 1–5.
 *
 * `backdrop_photo_id` and `hero_video_id` get their composite foreign keys in 0070_09, once
 * `movie_photos` and `movie_videos` exist. Movies are hard-deleted (a retracted movie is
 * `archived`), so there is no `deleted_at`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE movies (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      status VARCHAR(16) NOT NULL,
      synopsis VARCHAR(600) NULL,
      runtime_minutes SMALLINT NULL,
      release_date DATE NULL,
      age_rating VARCHAR(4) NOT NULL,
      language VARCHAR(80) NULL,
      country VARCHAR(80) NULL,
      production_company VARCHAR(120) NULL,
      budget_label VARCHAR(40) NULL,
      filming_locations VARCHAR(200) NULL,
      poster_image_id BIGINT NULL,
      backdrop_photo_id BIGINT NULL,
      hero_video_id BIGINT NULL,
      featured_position SMALLINT NULL,
      updated_by_staff_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_movies_poster_image_id FOREIGN KEY (poster_image_id) REFERENCES images (id),
      CONSTRAINT fk_movies_updated_by_staff_id
        FOREIGN KEY (updated_by_staff_id) REFERENCES staff_users (id),
      CONSTRAINT chk_movies_title CHECK (btrim(title) = title AND length(title) >= 1),
      CONSTRAINT chk_movies_status
        CHECK (status IN ('draft', 'coming_soon', 'now_showing', 'archived')),
      CONSTRAINT chk_movies_synopsis CHECK (btrim(synopsis) = synopsis AND length(synopsis) >= 1),
      CONSTRAINT chk_movies_runtime_minutes CHECK (runtime_minutes BETWEEN 1 AND 600),
      CONSTRAINT chk_movies_age_rating CHECK (age_rating IN ('G', 'PG', '12+', '16+', '18+')),
      CONSTRAINT chk_movies_language CHECK (btrim(language) = language AND length(language) >= 1),
      CONSTRAINT chk_movies_country CHECK (btrim(country) = country AND length(country) >= 1),
      CONSTRAINT chk_movies_production_company
        CHECK (btrim(production_company) = production_company AND length(production_company) >= 1),
      CONSTRAINT chk_movies_budget_label
        CHECK (btrim(budget_label) = budget_label AND length(budget_label) >= 1),
      CONSTRAINT chk_movies_filming_locations
        CHECK (btrim(filming_locations) = filming_locations AND length(filming_locations) >= 1),
      CONSTRAINT chk_movies_featured_position CHECK (featured_position BETWEEN 1 AND 5),
      CONSTRAINT chk_movies_public_fields CHECK (
        status NOT IN ('coming_soon', 'now_showing')
        OR (synopsis IS NOT NULL AND runtime_minutes IS NOT NULL AND release_date IS NOT NULL)
      ),
      CONSTRAINT chk_movies_featured CHECK (
        featured_position IS NULL
        OR (hero_video_id IS NOT NULL AND status IN ('coming_soon', 'now_showing'))
      )
    )
  `);
  await knex.raw(
    "COMMENT ON TABLE movies IS 'Movies: draft, coming_soon, now_showing or archived (design 6.2, PRD A2).'",
  );

  await knex.raw('CREATE INDEX idx_movies_created_at ON movies (created_at DESC, id DESC)');
  await knex.raw(
    'CREATE INDEX idx_movies_status_created_at ON movies (status, created_at DESC, id DESC)',
  );
  await knex.raw(
    'CREATE INDEX idx_movies_status_release_date ON movies (status, release_date, id)',
  );
  await knex.raw(
    'CREATE UNIQUE INDEX uq_movies_featured_position ON movies (featured_position) WHERE featured_position IS NOT NULL',
  );
  await knex.raw('CREATE UNIQUE INDEX uq_movies_poster_image_id ON movies (poster_image_id)');
  await knex.raw('CREATE INDEX idx_movies_updated_by_staff_id ON movies (updated_by_staff_id)');
  await knex.raw('CREATE INDEX idx_movies_title_trgm ON movies USING gin (title gin_trgm_ops)');

  const comments: [string, string][] = [
    [
      'idx_movies_created_at',
      'Admin movie list, newest first: ORDER BY created_at DESC, id DESC with the cursor (created_at, id) < (?, ?).',
    ],
    [
      'idx_movies_status_created_at',
      'Admin movie list filtered by status: WHERE status = ? ORDER BY created_at DESC, id DESC; and the status counts (GROUP BY status).',
    ],
    [
      'idx_movies_status_release_date',
      'Public movie lists (U8): WHERE status = ? ORDER BY release_date, id (ascending for Coming soon, descending for Now showing); similar movies.',
    ],
    [
      'uq_movies_featured_position',
      'One movie per carousel position (design 6.3); the featured list: WHERE featured_position IS NOT NULL ORDER BY featured_position.',
    ],
    [
      'uq_movies_poster_image_id',
      'Covers fk_movies_poster_image_id (deleting an image checks WHERE poster_image_id = ?); an image is the poster of at most one movie.',
    ],
    [
      'idx_movies_updated_by_staff_id',
      'Covers fk_movies_updated_by_staff_id: WHERE updated_by_staff_id = ?.',
    ],
    [
      'idx_movies_title_trgm',
      'Title search: WHERE title ILIKE ? (admin q, U8 and U18 search), a case-insensitive substring match.',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE movies ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.movies', [schema]);
}
