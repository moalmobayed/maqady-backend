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
