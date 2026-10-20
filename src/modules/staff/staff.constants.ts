/** `staff_users.full_name VARCHAR(100)`. */
export const STAFF_FULL_NAME_MAX_LENGTH = 100;

/** The longest email address accepted (RFC 5321's path limit, as `staff_users` checks it). */
export const EMAIL_MAX_LENGTH = 320;

/** Sign-in compares at most this many characters; longer passwords can't exist (design §10.1). */
export const SIGN_IN_PASSWORD_MAX_LENGTH = 128;

/** Advisory-lock name that serializes `npm run admin:create` runs against one database. */
export const ADMIN_CREATE_LOCK_KEY = 'maqady-backend:admin-create';

/** The variables `npm run admin:create` reads. Only the command reads them, never the service. */
export const BOOTSTRAP_ADMIN_VARIABLES = {
  email: 'BOOTSTRAP_ADMIN_EMAIL',
  fullName: 'BOOTSTRAP_ADMIN_NAME',
  password: 'BOOTSTRAP_ADMIN_PASSWORD',
} as const;
