/** Log levels pino understands, from most to least severe. `silent` turns logging off. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** How email leaves the service (ADR 0004): through Resend, or recorded as sent without leaving. */
export const EMAIL_DRIVERS = ['resend', 'simulated'] as const;
