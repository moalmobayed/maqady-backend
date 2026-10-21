/** The admin `npm run seed` signs in as; the frontend developer can sign in with it too. */
export const SEED_ADMIN_EMAIL = 'seed-admin@maqady.local';
export const SEED_ADMIN_NAME = 'Seed Admin';

/** Overrides the seed admin's password; it must meet the password policy. */
export const SEED_ADMIN_PASSWORD_VARIABLE = 'SEED_ADMIN_PASSWORD';

/** The development-only default, documented in the README; the seed refuses production. */
export const DEFAULT_SEED_ADMIN_PASSWORD = 'Maqady-seed-2026';

/** The loopback hosts a seeded database may be on (besides a socket or a single-label host). */
export const LOCAL_DATABASE_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]', '::1'];

/** Placeholder image sizes: each at or above its kind's minimum (design §9). */
export const SEED_IMAGE_SIZES = {
  poster: { width: 800, height: 1200 },
  backdrop: { width: 1920, height: 1080 },
  still: { width: 1920, height: 1080 },
  person: { width: 800, height: 800 },
  gallery: { width: 1600, height: 1067 },
} as const;

/** The seed's theater prices per zone, in piastres (EGP 150, 190, 230). */
export const SEED_PRICES = {
  front: { amount: 15000, currency: 'EGP' },
  middle: { amount: 19000, currency: 'EGP' },
  back: { amount: 23000, currency: 'EGP' },
} as const;

/** The admin lists the seed reads to find what exists, one page of the maximum size. */
export const SEED_LIST_LIMIT = 100;

/** The hall the seed adds to each theater it publishes (the standard 12 × 16 layout). */
export const SEED_HALL_NAME = 'Hall 1';

/** The seed schedules showtimes on today's cinema date and the 6 after. */
export const SEED_SHOWTIME_DAYS = 7;
