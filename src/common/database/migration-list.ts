import type { ListedMigration } from './types';
import * as m0010_01 from '../../migrations/0010_01_create_schema';
import * as m0020_01 from '../../migrations/0020_01_create_idempotency_keys';
import * as m0020_02 from '../../migrations/0020_02_create_audit_events';
import * as m0030_01 from '../../migrations/0030_01_create_messages';
import * as m0040_01 from '../../migrations/0040_01_create_staff_users';
import * as m0040_02 from '../../migrations/0040_02_create_sessions';
import * as m0040_03 from '../../migrations/0040_03_create_one_time_tokens';
import * as m0040_04 from '../../migrations/0040_04_add_audit_events_staff_fk';
import * as m0045_01 from '../../migrations/0045_01_add_messages_staff_fk';
import * as m0045_02 from '../../migrations/0045_02_comment_one_time_tokens_lookup';
import * as m0050_01 from '../../migrations/0050_01_create_images';
import * as m0055_01 from '../../migrations/0055_01_create_theaters';
import * as m0055_02 from '../../migrations/0055_02_create_theater_phones';
import * as m0055_03 from '../../migrations/0055_03_create_theater_facilities';
import * as m0055_04 from '../../migrations/0055_04_create_theater_photos';
import * as m0055_05 from '../../migrations/0055_05_create_theater_hours';
import * as m0055_06 from '../../migrations/0055_06_create_theater_special_dates';
import * as m0055_07 from '../../migrations/0055_07_add_images_created_by_staff_fk';
import * as m0060_01 from '../../migrations/0060_01_create_halls';
import * as m0060_02 from '../../migrations/0060_02_create_hall_rows';
import * as m0060_03 from '../../migrations/0060_03_create_hall_seat_marks';
import * as m0070_01 from '../../migrations/0070_01_create_genres';
import * as m0070_02 from '../../migrations/0070_02_create_movies';
import * as m0070_03 from '../../migrations/0070_03_create_movie_genres';
import * as m0070_04 from '../../migrations/0070_04_create_people';
import * as m0070_05 from '../../migrations/0070_05_create_person_roles';
import * as m0070_06 from '../../migrations/0070_06_create_movie_credits';
import * as m0070_07 from '../../migrations/0070_07_create_movie_photos';
import * as m0070_08 from '../../migrations/0070_08_create_movie_videos';
import * as m0070_09 from '../../migrations/0070_09_add_movies_media_fks';
import * as m0080_01 from '../../migrations/0080_01_create_showtimes';
import * as m0100_01 from '../../migrations/0100_01_create_customers';
import * as m0100_02 from '../../migrations/0100_02_add_customer_foreign_keys';
import * as m0110_01 from '../../migrations/0110_01_create_bookings';
import * as m0110_02 from '../../migrations/0110_02_create_booking_seats';
import * as m0110_03 from '../../migrations/0110_03_create_seat_claims';
import * as m0110_04 from '../../migrations/0110_04_create_hold_refusals';
import * as m0110_05 from '../../migrations/0110_05_add_booking_foreign_keys';
import * as m0120_01 from '../../migrations/0120_01_create_payments';

/**
 * Every migration in `src/migrations/`, in run order. Imported statically so a bundler or file
 * tracer (Vercel) ships them with the app; a unit test fails when this list and the directory
 * differ. A new migration is added here in the same change, at the end.
 */
export const MIGRATIONS: readonly ListedMigration[] = [
  { name: '0010_01_create_schema', file: m0010_01 },
  { name: '0020_01_create_idempotency_keys', file: m0020_01 },
  { name: '0020_02_create_audit_events', file: m0020_02 },
  { name: '0030_01_create_messages', file: m0030_01 },
  { name: '0040_01_create_staff_users', file: m0040_01 },
  { name: '0040_02_create_sessions', file: m0040_02 },
  { name: '0040_03_create_one_time_tokens', file: m0040_03 },
  { name: '0040_04_add_audit_events_staff_fk', file: m0040_04 },
  { name: '0045_01_add_messages_staff_fk', file: m0045_01 },
  { name: '0045_02_comment_one_time_tokens_lookup', file: m0045_02 },
  { name: '0050_01_create_images', file: m0050_01 },
  { name: '0055_01_create_theaters', file: m0055_01 },
  { name: '0055_02_create_theater_phones', file: m0055_02 },
  { name: '0055_03_create_theater_facilities', file: m0055_03 },
  { name: '0055_04_create_theater_photos', file: m0055_04 },
  { name: '0055_05_create_theater_hours', file: m0055_05 },
  { name: '0055_06_create_theater_special_dates', file: m0055_06 },
  { name: '0055_07_add_images_created_by_staff_fk', file: m0055_07 },
  { name: '0060_01_create_halls', file: m0060_01 },
  { name: '0060_02_create_hall_rows', file: m0060_02 },
  { name: '0060_03_create_hall_seat_marks', file: m0060_03 },
  { name: '0070_01_create_genres', file: m0070_01 },
  { name: '0070_02_create_movies', file: m0070_02 },
  { name: '0070_03_create_movie_genres', file: m0070_03 },
  { name: '0070_04_create_people', file: m0070_04 },
  { name: '0070_05_create_person_roles', file: m0070_05 },
  { name: '0070_06_create_movie_credits', file: m0070_06 },
  { name: '0070_07_create_movie_photos', file: m0070_07 },
  { name: '0070_08_create_movie_videos', file: m0070_08 },
  { name: '0070_09_add_movies_media_fks', file: m0070_09 },
  { name: '0080_01_create_showtimes', file: m0080_01 },
  { name: '0100_01_create_customers', file: m0100_01 },
  { name: '0100_02_add_customer_foreign_keys', file: m0100_02 },
  { name: '0110_01_create_bookings', file: m0110_01 },
  { name: '0110_02_create_booking_seats', file: m0110_02 },
  { name: '0110_03_create_seat_claims', file: m0110_03 },
  { name: '0110_04_create_hold_refusals', file: m0110_04 },
  { name: '0110_05_add_booking_foreign_keys', file: m0110_05 },
  { name: '0120_01_create_payments', file: m0120_01 },
];
