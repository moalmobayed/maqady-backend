import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U10 (#11): the seats of a booking and the price each was sold at (design §6.2, §7.10). A hold
 * writes one row per seat from the hall's layout and the showtime's zone prices at that moment,
 * so a later price or layout change never alters a booking. The booking's `total_amount` is the
 * sum of these prices, in the booking's currency.
 *
 * `seat_claims` says who holds a seat right now; this table keeps which seats a booking had.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE booking_seats (
      booking_id BIGINT NOT NULL,
      seat_label VARCHAR(3) NOT NULL,
      row_label VARCHAR(1) NOT NULL,
      seat_number SMALLINT NOT NULL,
      zone VARCHAR(8) NOT NULL,
      price INT NOT NULL,
      is_wheelchair BOOLEAN NOT NULL,
      CONSTRAINT pk_booking_seats PRIMARY KEY (booking_id, seat_label),
      CONSTRAINT fk_booking_seats_booking_id FOREIGN KEY (booking_id) REFERENCES bookings (id),
      CONSTRAINT chk_booking_seats_row_label CHECK (row_label ~ '^[A-HJ-P]$'),
      CONSTRAINT chk_booking_seats_seat_number CHECK (seat_number BETWEEN 1 AND 20),
      CONSTRAINT chk_booking_seats_seat_label CHECK (seat_label = row_label || seat_number::text),
      CONSTRAINT chk_booking_seats_zone CHECK (zone IN ('front', 'middle', 'back')),
      CONSTRAINT chk_booking_seats_price CHECK (price > 0)
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE booking_seats IS
      'The seats of a booking with the zone and price each had when it was held (design 6.2, 7.10).'
  `);
  await knex.raw(`
    COMMENT ON INDEX pk_booking_seats IS
      'A booking''s seats: WHERE booking_id = ANY(?) ORDER BY booking_id, seat_label. Covers fk_booking_seats_booking_id.'
  `);
  await knex.raw('ALTER TABLE booking_seats ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.booking_seats', [schema]);
}
