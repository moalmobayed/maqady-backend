/** The drawer's "Recent bookings": the customer's newest bookings, in any status (PRD A7). */
export const RECENT_BOOKINGS_LIMIT = 4;

/** Audit action of the admin "Send password reset email" (U15). */
export const PASSWORD_RESET_SENT_ACTION = 'customer.password_reset_sent';

/** Audit action of "Delete account": the customer was anonymised (design §21). */
export const ANONYMISED_ACTION = 'customer.anonymised';

/** The account fields anonymisation clears, as the audit event names them (never their values). */
export const ANONYMISED_FIELDS = ['fullName', 'email', 'phone', 'passwordHash'] as const;
