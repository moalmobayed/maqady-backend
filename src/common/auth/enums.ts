/**
 * The access a route declares, exactly one per route (design §10.3, §11):
 *
 * - `public`: anyone; a token is ignored.
 * - `guest`: anyone, optionally a signed-in customer (an invalid customer token is refused).
 * - `customer`: a signed-in customer.
 * - `staff`: a signed-in staff member of either role.
 * - `admin`: a signed-in admin.
 *
 * "Owner" is not a declaration: an owner route is `customer` (or `guest` for a hold code), and
 * its service loads the resource by the principal's id, answering `NOT_FOUND` for anyone else's.
 */
export const ACCESS_LEVELS = ['public', 'guest', 'customer', 'staff', 'admin'] as const;

/** Access-token audiences; each has its own signing secret (design §10.2). */
export const TOKEN_AUDIENCES = ['customer', 'staff'] as const;

/** Staff roles (design §6.2 `staff_users.role`). The role is read from the database, never the token. */
export const STAFF_ROLES = ['admin', 'box_office'] as const;
