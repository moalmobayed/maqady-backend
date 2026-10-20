import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U4b (#5): a theater's labelled phone numbers (design §6.2), in the order the admin lists them;
 * the first (`sort_order = 0`) is the main phone. Numbers are E.164. A theater's phones are
 * replaced as a whole, and go with the theater.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE theater_phones (
      id BIGSERIAL PRIMARY KEY,
      theater_id BIGINT NOT NULL,
      label VARCHAR(40) NOT NULL,
      number VARCHAR(16) NOT NULL,
      sort_order SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_theater_phones_theater_id
        FOREIGN KEY (theater_id) REFERENCES theaters (id) ON DELETE CASCADE,
      CONSTRAINT uq_theater_phones_theater_id_sort_order UNIQUE (theater_id, sort_order),
      CONSTRAINT chk_theater_phones_label CHECK (length(label) >= 1 AND btrim(label) = label),
      CONSTRAINT chk_theater_phones_number CHECK (number ~ '^[+][1-9][0-9]{6,14}$'),
      CONSTRAINT chk_theater_phones_sort_order CHECK (sort_order >= 0)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE theater_phones IS
      'Labelled phone numbers of a theater, in display order; the first is the main phone (design 6.2).'
  `);
  await knex.raw(`
    COMMENT ON INDEX uq_theater_phones_theater_id_sort_order IS
      'Phones of theaters: WHERE theater_id IN (...) ORDER BY theater_id, sort_order. Covers fk_theater_phones_theater_id.'
  `);
  await knex.raw('ALTER TABLE theater_phones ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.theater_phones', [schema]);
}
