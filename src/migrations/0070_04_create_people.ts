import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U6 (#7): actors and crew (design §6.2, PRD A3), managed once and credited on many movies. No
 * Arabic name (PRD out of scope). People are hard-deleted with their credits (design §9).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE people (
      id BIGSERIAL PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL,
      birth_date DATE NULL,
      birth_place VARCHAR(120) NULL,
      nationality VARCHAR(80) NULL,
      bio VARCHAR(400) NULL,
      photo_image_id BIGINT NULL,
      instagram_url VARCHAR(500) NULL,
      imdb_url VARCHAR(500) NULL,
      website_url VARCHAR(500) NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_people_photo_image_id FOREIGN KEY (photo_image_id) REFERENCES images (id),
      CONSTRAINT chk_people_full_name CHECK (btrim(full_name) = full_name AND length(full_name) >= 1),
      CONSTRAINT chk_people_birth_place
        CHECK (btrim(birth_place) = birth_place AND length(birth_place) >= 1),
      CONSTRAINT chk_people_nationality
        CHECK (btrim(nationality) = nationality AND length(nationality) >= 1),
      CONSTRAINT chk_people_bio CHECK (btrim(bio) = bio AND length(bio) >= 1),
      CONSTRAINT chk_people_instagram_url CHECK (instagram_url ~ '^https://'),
      CONSTRAINT chk_people_imdb_url CHECK (imdb_url ~ '^https://'),
      CONSTRAINT chk_people_website_url CHECK (website_url ~ '^https://')
    )
  `);
  await knex.raw(
    "COMMENT ON TABLE people IS 'Actors and crew, credited on movies through movie_credits (design 6.2, PRD A3).'",
  );
  await knex.raw('CREATE INDEX idx_people_full_name ON people (full_name, id)');
  await knex.raw(
    'CREATE INDEX idx_people_full_name_trgm ON people USING gin (full_name gin_trgm_ops)',
  );
  await knex.raw('CREATE UNIQUE INDEX uq_people_photo_image_id ON people (photo_image_id)');

  const comments: [string, string][] = [
    [
      'idx_people_full_name',
      'Admin and public people lists: ORDER BY full_name, id with the cursor (full_name, id) > (?, ?).',
    ],
    [
      'idx_people_full_name_trgm',
      'Name search: WHERE full_name ILIKE ? (admin people q, cast search in movie lists, U18).',
    ],
    [
      'uq_people_photo_image_id',
      'Covers fk_people_photo_image_id (deleting an image checks WHERE photo_image_id = ?); an image is the photo of at most one person.',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE people ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.people', [schema]);
}
