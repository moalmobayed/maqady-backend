/** Log levels pino understands, from most to least severe. `silent` turns logging off. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** How email leaves the service (ADR 0004): through Resend, or recorded as sent without leaving. */
export const EMAIL_DRIVERS = ['resend', 'simulated'] as const;

/**
 * Where uploaded images are stored (design §9, §14.5): `supabase` is Supabase Storage (every
 * deployed environment); `local` is a directory the app serves itself, for development and tests.
 */
export const STORAGE_DRIVERS = ['supabase', 'local'] as const;
