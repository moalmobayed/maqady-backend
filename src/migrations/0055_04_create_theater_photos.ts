import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U4b (#5): a theater's gallery (design §6.2, PRD A4 "Photos tab"). Each photo is one `images`
 * row of kind `gallery`; `sort_order` is kept contiguous from 0 by the service. The cover is not a
 * photo: it is `theaters.cover_image_id`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE theater_photos (
      id BIGSERIAL PRIMARY KEY,
      theater_id BIGINT NOT NULL,
      image_id BIGINT NOT NULL,
      caption VARCHAR(120) NULL,
      sort_order SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_theater_photos_theater_id
        FOREIGN KEY (theater_id) REFERENCES theaters (id) ON DELETE CASCADE,
      CONSTRAINT fk_theater_photos_image_id FOREIGN KEY (image_id) REFERENCES images (id),
      CONSTRAINT uq_theater_photos_image_id UNIQUE (image_id),
      CONSTRAINT chk_theater_photos_caption
        CHECK (caption IS NULL OR (length(caption) >= 1 AND btrim(caption) = caption)),
      CONSTRAINT chk_theater_photos_sort_order CHECK (sort_order >= 0)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE theater_photos IS
      'Gallery photos of a theater, in display order (design 6.2); the image is in images.'
  `);
  await knex.raw(
    'CREATE INDEX idx_theater_photos_theater_id_sort_order ON theater_photos (theater_id, sort_order, id)',
  );

  const comments: [string, string][] = [
    [
      'idx_theater_photos_theater_id_sort_order',
      'Gallery of theaters: WHERE theater_id IN (...) ORDER BY theater_id, sort_order, id. Covers fk_theater_photos_theater_id.',
    ],
    [
      'uq_theater_photos_image_id',
      'Covers fk_theater_photos_image_id, so deleting an image checks photos by index. Also keeps an image in one photo at most.',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE theater_photos ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.theater_photos', [schema]);
}
