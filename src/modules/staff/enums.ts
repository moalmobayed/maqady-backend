/**
 * A staff member's state (`staff_users.status`, design §6.2):
 *
 * - `invited`: invited, no password yet (U2b sends the link);
 * - `active`: may sign in;
 * - `deactivated`: switched off by an admin; every session and link stopped working.
 *
 * Roles reuse `STAFF_ROLES` from `common/auth/enums.ts`.
 */
export const STAFF_STATUSES = ['invited', 'active', 'deactivated'] as const;

/** What `PATCH /admin/staff/{id}` may set. `invited` comes only from an invite (U2b). */
export const SETTABLE_STAFF_STATUSES = ['active', 'deactivated'] as const;

/**
 * The one-time tokens the set-password page (`/admin/set-password`) accepts: an invite turns an
 * invited member active, a reset replaces an active member's password (design §10.5).
 */
export const PASSWORD_SETUP_PURPOSES = ['staff_invite', 'staff_password_reset'] as const;
