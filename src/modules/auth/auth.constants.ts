import type { TokenAudience } from '../../common/auth/types';
import type { OneTimeTokenPurpose, ScryptProfile } from './types';

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;

/**
 * How long a session lasts from its sign-in (design §10.2): 12 hours for staff, 30 days for
 * customers. Refreshing never extends it.
 */
export const SESSION_LIFETIME_SECONDS: Readonly<Record<TokenAudience, number>> = {
  staff: 12 * HOUR_SECONDS,
  customer: 30 * DAY_SECONDS,
};

/**
 * Design §10.2: presenting a rotated refresh token again within this many seconds of its rotation
 * answers `REFRESH_CONFLICT` and revokes nothing; later, it revokes the family.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 30;

/** Design §10.5. */
export const ONE_TIME_TOKEN_LIFETIME_SECONDS: Readonly<Record<OneTimeTokenPurpose, number>> = {
  verify_email: DAY_SECONDS,
  customer_password_reset: HOUR_SECONDS,
  staff_invite: 3 * DAY_SECONDS,
  staff_password_reset: HOUR_SECONDS,
};

/**
 * Prefix of the advisory-lock name that serializes issuing one-time tokens of one owner and
 * purpose, so the later of two concurrent issues always deletes the earlier token.
 */
export const ONE_TIME_TOKEN_ISSUE_LOCK_PREFIX = 'maqady-backend:one-time-token';

/** Which owner each one-time-token purpose names. */
export const ONE_TIME_TOKEN_OWNER_KIND: Readonly<Record<OneTimeTokenPurpose, TokenAudience>> = {
  verify_email: 'customer',
  customer_password_reset: 'customer',
  staff_invite: 'staff',
  staff_password_reset: 'staff',
};

/**
 * Design §10.1: Node's scrypt with OWASP's `N = 2^14, r = 8, p = 5` profile (16 MiB per hash),
 * `maxmem` 64 MiB, a 16-byte salt per password and a 64-byte key.
 */
export const SCRYPT_PROFILE: ScryptProfile = {
  N: 16_384,
  r: 8,
  p: 5,
  maxmem: 64 * 1024 * 1024,
  keyLength: 64,
  saltBytes: 16,
};

/** `scrypt$<N>$<r>$<p>$<salt base64url>$<key base64url>`. */
export const PASSWORD_HASH_PATTERN =
  /^scrypt\$([1-9][0-9]{0,9})\$([1-9][0-9]{0,3})\$([1-9][0-9]{0,3})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

/**
 * A valid hash of a random value nobody knows. Sign-in verifies against it when the email is
 * unknown or has no password, so the answer takes as long as a real check and reveals nothing.
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$5$pk1od4Vn7YT-3g7zA3NK2A$oSGkDqBfrPqDAaQBdfFHDk2MmIUgLoTEw7T1p_BIZQVPQCIg87g6Dn_bH02PH4D6M_Ym4ZiEKbKOhLlnoyrhWA';

/** Design §10.1: at least 8 characters including a digit; the upper bound caps hashing work. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_POLICY_MESSAGE = `password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters and include a digit`;

/** A refresh token or one-time token as issued: 32 random bytes in base64url, 43 characters. */
export const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The column of `sessions` and `one_time_tokens` that names an owner of each audience. */
export const OWNER_COLUMN: Readonly<Record<TokenAudience, 'staff_user_id' | 'customer_id'>> = {
  staff: 'staff_user_id',
  customer: 'customer_id',
};
