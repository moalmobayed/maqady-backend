import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U4b (#5): theaters (design §6.2, §9). A theater is created as `draft`, published to `active`
 * and toggled between `active` and `sales_paused`. Its three default zone prices (whole
 * piastres) and their currency are set together or not at all, and are required once it leaves
 * `draft`. Only a draft is ever deleted, so rows are removed, never retracted: no `deleted_at`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE theaters (
      id BIGSERIAL PRIMARY KEY,
      name CITEXT NOT NULL,
      status VARCHAR(16) NOT NULL,
      address VARCHAR(200) NOT NULL,
      district VARCHAR(80) NOT NULL,
      city VARCHAR(80) NOT NULL,
      latitude NUMERIC(9, 6) NOT NULL,
      longitude NUMERIC(9, 6) NOT NULL,
      transit_info VARCHAR(500) NULL,
      parking_info VARCHAR(500) NULL,
      email CITEXT NULL,
      show_contacts_public BOOLEAN NOT NULL,
      cover_image_id BIGINT NULL,
      default_price_front INT NULL,
      default_price_middle INT NULL,
      default_price_back INT NULL,
      currency VARCHAR(3) NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT uq_theaters_name UNIQUE (name),
      CONSTRAINT uq_theaters_cover_image_id UNIQUE (cover_image_id),
      CONSTRAINT fk_theaters_cover_image_id FOREIGN KEY (cover_image_id) REFERENCES images (id),
      CONSTRAINT chk_theaters_status CHECK (status IN ('draft', 'active', 'sales_paused')),
      CONSTRAINT chk_theaters_name CHECK (length(name) BETWEEN 2 AND 100 AND btrim(name) = name),
      CONSTRAINT chk_theaters_address CHECK (length(address) >= 1 AND btrim(address) = address),
      CONSTRAINT chk_theaters_district CHECK (length(district) >= 1 AND btrim(district) = district),
      CONSTRAINT chk_theaters_city CHECK (length(city) >= 1 AND btrim(city) = city),
      CONSTRAINT chk_theaters_latitude CHECK (latitude BETWEEN -90 AND 90),
      CONSTRAINT chk_theaters_longitude CHECK (longitude BETWEEN -180 AND 180),
      CONSTRAINT chk_theaters_transit_info CHECK (transit_info IS NULL OR length(transit_info) >= 1),
      CONSTRAINT chk_theaters_parking_info CHECK (parking_info IS NULL OR length(parking_info) >= 1),
      CONSTRAINT chk_theaters_email CHECK (
        email IS NULL OR (length(email) <= 320 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$')
      ),
      CONSTRAINT chk_theaters_prices_positive CHECK (
        default_price_front > 0 AND default_price_middle > 0 AND default_price_back > 0
      ),
      CONSTRAINT chk_theaters_prices_complete CHECK (
        num_nonnulls(default_price_front, default_price_middle, default_price_back, currency) IN (0, 4)
      ),
      CONSTRAINT chk_theaters_currency CHECK (currency IN ('EGP')),
      CONSTRAINT chk_theaters_prices_when_published CHECK (status = 'draft' OR currency IS NOT NULL)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE theaters IS
      'Theaters of the chain: location, contacts, default zone prices and status (design 6.2, 9).'
  `);

  await knex.raw('CREATE INDEX idx_theaters_status_name ON theaters (status, name)');

  const comments: [string, string][] = [
    [
      'uq_theaters_name',
      'Admin theater list without a status filter: ORDER BY name, id with the cursor (name, id) > (?, ?). Also keeps names unique, case-insensitively.',
    ],
    [
      'idx_theaters_status_name',
      'Admin theater list with a status filter, and the active theaters (U8): WHERE status = ? ORDER BY name, id.',
    ],
    [
      'uq_theaters_cover_image_id',
      'Covers fk_theaters_cover_image_id, so deleting an image checks theaters by index. Also keeps an image the cover of one theater at most.',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE theaters ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.theaters', [schema]);
}
