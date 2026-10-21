/**
 * A customer's state (`customers.status`, design §6.2):
 *
 * - `active`: may sign in and book;
 * - `blocked`: switched off by an admin (U15); every session was revoked and sign-in answers
 *   `ACCOUNT_BLOCKED`. Paid tickets stay valid (PRD Accounts 5).
 *
 * Anonymisation is not a status: it sets `deleted_at` (U15).
 */
export const CUSTOMER_STATUSES = ['active', 'blocked'] as const;
