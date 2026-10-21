import type { ACCESS_LEVELS, STAFF_ROLES, TOKEN_AUDIENCES } from './enums';

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export type TokenAudience = (typeof TOKEN_AUDIENCES)[number];

export type StaffRole = (typeof STAFF_ROLES)[number];

/** A signed-in customer, as the guard resolved them for this request. */
export interface CustomerPrincipal {
  readonly kind: 'customer';
  readonly id: number;
  readonly sessionId: number;
}

/** A signed-in staff member, with the role read from the database on this request. */
export interface StaffPrincipal {
  readonly kind: 'staff';
  readonly id: number;
  readonly sessionId: number;
  readonly role: StaffRole;
}

/** Who is acting on this request. Absent on public routes and for guests. */
export type Principal = CustomerPrincipal | StaffPrincipal;

/** The claims of an access token (design §10.2). `sub` and `sid` are positive integers as text. */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly aud: TokenAudience;
  readonly sid: string;
  readonly iat: number;
  readonly exp: number;
}

/** What an access token proves once its signature, audience, expiry and claims check out. */
export interface VerifiedAccessToken {
  readonly audience: TokenAudience;
  /** The customer or staff user id (`sub`). */
  readonly subjectId: number;
  /** The `sessions.id` the token was issued for (`sid`). */
  readonly sessionId: number;
}

/** What `AccessTokenService.sign()` needs. */
export interface AccessTokenSubject {
  readonly audience: TokenAudience;
  readonly subjectId: number;
  readonly sessionId: number;
}

/**
 * Turns a verified token into the principal, on every request (design §10.3): one indexed query
 * on the account and the `sid` session. It returns null when the session or account is gone
 * (the guard answers `UNAUTHENTICATED`), or throws its own `AppError`, such as
 * `ACCOUNT_BLOCKED`, `ACCOUNT_DEACTIVATED` or `SESSION_REVOKED`.
 *
 * U2 registers the staff resolver and U9 the customer one, with `PrincipalResolverRegistry`.
 */
export interface PrincipalResolver {
  resolve(token: VerifiedAccessToken): Promise<Principal | null>;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `JwtAuthGuard` when a valid token was presented. */
    principal?: Principal;
  }
}
