import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U4a (#5): every uploaded image (design §6.2, §9). One row per image; its WebP variants live in
 * storage under `storage_prefix`, and `variants` names each file with its size.
 *
 * `created_by_staff_id` gets its foreign key to `staff_users` from U4b, the first unit that
 * depends on both the staff and the media units (§6.1). Its covering index is created here.
 * Rows are deleted, never retracted: an image goes with its files, so there is no `deleted_at`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE images (
      id BIGSERIAL PRIMARY KEY,
      kind VARCHAR(16) NOT NULL,
      storage_prefix VARCHAR(64) NOT NULL,
      variants JSONB NOT NULL,
      source_width INT NOT NULL,
      source_height INT NOT NULL,
      created_by_staff_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT chk_images_kind CHECK (kind IN ('poster', 'backdrop', 'person', 'gallery')),
      CONSTRAINT chk_images_storage_prefix
        CHECK (storage_prefix ~ '^(poster|backdrop|person|gallery)/[0-9a-f-]{36}$'),
      CONSTRAINT chk_images_prefix_kind CHECK (split_part(storage_prefix, '/', 1) = kind),
      CONSTRAINT chk_images_variants CHECK (
        jsonb_typeof(variants) = 'object'
        AND jsonb_exists_all(variants, ARRAY['small', 'medium', 'large'])
      ),
      CONSTRAINT chk_images_source_size CHECK (source_width > 0 AND source_height > 0),
      CONSTRAINT uq_images_storage_prefix UNIQUE (storage_prefix)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE images IS
      'Uploaded images: one storage prefix of WebP variants (small, medium, large) per row (design 9).'
  `);

  await knex.raw('CREATE INDEX idx_images_created_by_staff_id ON images (created_by_staff_id)');

  const comments: [string, string][] = [
    [
      'uq_images_storage_prefix',
      'npm run media:orphans: WHERE storage_prefix IN (...) finds the prefixes in storage that still have a row. Also keeps one row per prefix.',
    ],
    [
      'idx_images_created_by_staff_id',
      'Images uploaded by a staff member: WHERE created_by_staff_id = ?. Covers fk_images_created_by_staff_id (U4b).',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE images ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.images', [schema]);
}
