import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U7 (#8): showtimes (design §6.2, §6.3, §8). A showtime is a movie in a hall of a theater at a
 * start time. It ends after the movie's runtime, and its hall is then cleaned for 20 minutes.
 *
 * - `ex_showtimes_hall_cleaning_gap` keeps two scheduled showtimes of a hall at least 20 minutes
 *   apart: their `[starts_at, cleaning_ends_at)` ranges may touch but never overlap. A cancelled
 *   showtime leaves the constraint, so its slot can be used again. `btree_gist` (migration
 *   `0010_01`) lets the gist index compare `hall_id` with `=`.
 * - The composite foreign key onto `halls (id, theater_id)` keeps a showtime's hall inside its
 *   theater. Every foreign key is `NO ACTION`: deleting a theater (which cascades its halls) or a
 *   movie that has showtimes fails here, behind the services' `has_showtimes` blockers.
 * - `cinema_date` is written by the service from `starts_at` (`cinemaDateOf`), not CHECKed, so
 *   Postgres's and Node's time-zone data never have to agree for an insert to succeed.
 * - No defaults: times come from the service's `Clock`. Rows are never deleted (a cancelled
 *   showtime keeps its row, `cancelled_at` says when), so there is no `deleted_at`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE showtimes (
      id BIGSERIAL PRIMARY KEY,
      movie_id BIGINT NOT NULL,
      theater_id BIGINT NOT NULL,
      hall_id BIGINT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      cleaning_ends_at TIMESTAMPTZ NOT NULL,
      cinema_date DATE NOT NULL,
      price_front INT NOT NULL,
      price_middle INT NOT NULL,
      price_back INT NOT NULL,
      currency VARCHAR(3) NOT NULL,
      seat_capacity SMALLINT NOT NULL,
      status VARCHAR(16) NOT NULL,
      cancel_reason VARCHAR(32) NULL,
      cancelled_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_showtimes_movie_id FOREIGN KEY (movie_id) REFERENCES movies (id),
      CONSTRAINT fk_showtimes_theater_id FOREIGN KEY (theater_id) REFERENCES theaters (id),
      CONSTRAINT fk_showtimes_hall_id_theater_id
        FOREIGN KEY (hall_id, theater_id) REFERENCES halls (id, theater_id),
      CONSTRAINT chk_showtimes_span CHECK (ends_at > starts_at),
      CONSTRAINT chk_showtimes_cleaning CHECK (cleaning_ends_at = ends_at + interval '20 minutes'),
      CONSTRAINT chk_showtimes_prices CHECK (
        price_front BETWEEN 1 AND 1000000
        AND price_middle BETWEEN 1 AND 1000000
        AND price_back BETWEEN 1 AND 1000000
      ),
      CONSTRAINT chk_showtimes_currency CHECK (currency IN ('EGP')),
      CONSTRAINT chk_showtimes_seat_capacity CHECK (seat_capacity BETWEEN 1 AND 300),
      CONSTRAINT chk_showtimes_status CHECK (status IN ('scheduled', 'cancelled')),
      CONSTRAINT chk_showtimes_cancel_reason CHECK (
        cancel_reason IN ('technical_issue', 'print_not_delivered', 'low_sales', 'private_event')
      ),
      CONSTRAINT chk_showtimes_cancellation CHECK (
        (status = 'scheduled' AND cancel_reason IS NULL AND cancelled_at IS NULL)
        OR (status = 'cancelled' AND cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL)
      ),
      CONSTRAINT ex_showtimes_hall_cleaning_gap EXCLUDE USING gist (
        hall_id WITH =,
        tstzrange(starts_at, cleaning_ends_at) WITH &&
      ) WHERE (status = 'scheduled')
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE showtimes IS
      'A movie in a hall at a start time, with its zone prices and seat capacity (design 6.2, 8).'
  `);

  await knex.raw(
    'CREATE INDEX idx_showtimes_hall_id_theater_id_starts_at ON showtimes (hall_id, theater_id, starts_at)',
  );
  await knex.raw(
    'CREATE INDEX idx_showtimes_theater_id_cinema_date_starts_at ON showtimes (theater_id, cinema_date, starts_at)',
  );
  await knex.raw(
    'CREATE INDEX idx_showtimes_movie_id_cinema_date_starts_at ON showtimes (movie_id, cinema_date, starts_at)',
  );
  await knex.raw(
    'CREATE INDEX idx_showtimes_cinema_date_starts_at ON showtimes (cinema_date, starts_at)',
  );

  const comments: [string, string][] = [
    [
      'ex_showtimes_hall_cleaning_gap',
      "The 20-minute cleaning gap (design 6.3): no two scheduled showtimes of a hall with overlapping [starts_at, cleaning_ends_at). Also serves the conflict queries: WHERE hall_id = ? AND status = 'scheduled' AND tstzrange(starts_at, cleaning_ends_at) && tstzrange(?, ?) (naming the showtimes a write overlaps, the dry run, the suggestions).",
    ],
    [
      'idx_showtimes_hall_id_theater_id_starts_at',
      "Covers fk_showtimes_hall_id_theater_id. Hall blockers: WHERE hall_id IN (...) [AND status = 'scheduled' AND ends_at > ?]; the layout participants: WHERE hall_id = ? AND status = 'scheduled' AND starts_at > ? ORDER BY id FOR UPDATE (a hall has one theater, so the hall_id prefix is selective), the capacity UPDATE with the same filter, and WHERE hall_id = ? AND status = 'scheduled' AND ends_at > ? ORDER BY starts_at, id (unended showtimes of a hall).",
    ],
    [
      'idx_showtimes_theater_id_cinema_date_starts_at',
      'Covers fk_showtimes_theater_id. Admin timeline: WHERE theater_id = ? AND cinema_date = ? [AND hall_id = ?] [AND status = ?] ORDER BY starts_at, id with the cursor (starts_at, id) > (?, ?); discovery by theater: WHERE theater_id IN (...) AND cinema_date BETWEEN ? AND ? (equality, then range); the theater deletion blocker: WHERE theater_id = ? LIMIT 1.',
    ],
    [
      'idx_showtimes_movie_id_cinema_date_starts_at',
      'Covers fk_showtimes_movie_id. Discovery by movie: WHERE movie_id IN (...) AND cinema_date BETWEEN ? AND ? ORDER BY starts_at, id (equality, then range); the movie deletion blocker: WHERE movie_id = ? LIMIT 1.',
    ],
    [
      'idx_showtimes_cinema_date_starts_at',
      "Discovery across movies and theaters: WHERE cinema_date BETWEEN ? AND ? [AND starts_at > ?] AND status = 'scheduled' (the home ticker's next showtime per movie, the movies with a showtime on a date).",
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE showtimes ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.showtimes', [schema]);
}
