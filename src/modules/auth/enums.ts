/**
 * Why a session was revoked (`sessions.revoked_reason`, design §10.2):
 *
 * - `sign_out`: the user signed out (the family).
 * - `refresh_reuse`: a rotated refresh token was presented after the grace window (the family).
 * - `account_deactivated`, `role_changed`: an admin deactivated or demoted a staff member (all
 *   their sessions).
 * - `password_changed`, `account_blocked`: a customer changed their password or was blocked (U9,
 *   U15).
 */
export const SESSION_REVOKE_REASONS = [
  'sign_out',
  'refresh_reuse',
  'account_deactivated',
  'role_changed',
  'password_changed',
  'account_blocked',
] as const;

/** What a single-use emailed link is for (`one_time_tokens.purpose`, design §10.5). */
export const ONE_TIME_TOKEN_PURPOSES = [
  'verify_email',
  'customer_password_reset',
  'staff_invite',
  'staff_password_reset',
] as const;
