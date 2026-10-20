import type { TokenAudience } from '../../common/auth/types';
import type { ONE_TIME_TOKEN_PURPOSES, SESSION_REVOKE_REASONS } from './enums';

export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

export type OneTimeTokenPurpose = (typeof ONE_TIME_TOKEN_PURPOSES)[number];

/** The account a session belongs to: a staff member or a customer, by audience. */
export interface SessionOwner {
  readonly audience: TokenAudience;
  readonly id: number;
}

/** What `SessionService.open()` takes. */
export interface OpenSessionInput {
  readonly owner: SessionOwner;
  /** How long the session lasts from now, whatever its refreshes (`SESSION_LIFETIME_SECONDS`). */
  readonly lifetimeSeconds: number;
}

/** A new session: its first refresh token, raw, to hand to the client once. */
export interface IssuedSession {
  /** `sessions.id` of the token's row; the access token's `sid`. */
  readonly sessionId: number;
  readonly familyId: string;
  readonly refreshToken: string;
  /** When the session ends, however often it is refreshed. */
  readonly expiresAt: Date;
}

/**
 * What `SessionService.refresh()` takes. `assertOwnerLive` throws the owner's own error (for
 * example `ACCOUNT_DEACTIVATED`) when the account may no longer refresh; the rotation then rolls
 * back.
 */
export interface RefreshSessionInput {
  readonly audience: TokenAudience;
  readonly refreshToken: string;
  readonly assertOwnerLive: (ownerId: number) => Promise<void>;
}

/** The rotated session: the new refresh token and the row it lives in. */
export interface RefreshedSession {
  readonly sessionId: number;
  readonly ownerId: number;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}

/**
 * What a refresh decided inside its transaction. A reuse names the family and the presented row;
 * the family is revoked in a second transaction, and `SESSION_REVOKED` thrown after it commits.
 */
export type RefreshOutcome =
  | { readonly kind: 'rotated'; readonly session: RefreshedSession }
  | { readonly kind: 'reused'; readonly familyId: string; readonly sessionId: number };

/** A `sessions` row as the repository reads it. */
export interface SessionRow {
  readonly id: number;
  readonly family_id: string;
  readonly staff_user_id: number | null;
  readonly customer_id: number | null;
  readonly expires_at: Date;
  readonly rotated_at: Date | null;
  readonly revoked_at: Date | null;
}

/** A `sessions` row as the repository inserts it. */
export interface NewSessionRow {
  readonly family_id: string;
  readonly staff_user_id: number | null;
  readonly customer_id: number | null;
  readonly token_hash: string;
  readonly created_at: Date;
  readonly expires_at: Date;
}

/** Which rows a revocation covers: one family, or every session of one owner. */
export type SessionScope =
  | { readonly kind: 'family'; readonly familyId: string }
  | { readonly kind: 'owner'; readonly owner: SessionOwner };

/** The account a one-time token belongs to. Staff purposes need a staff member, customer ones a customer. */
export interface OneTimeTokenOwner {
  readonly kind: TokenAudience;
  readonly id: number;
}

/** What `OneTimeTokenService.issue()` takes. */
export interface IssueOneTimeTokenInput {
  readonly purpose: OneTimeTokenPurpose;
  readonly owner: OneTimeTokenOwner;
  /** `ONE_TIME_TOKEN_LIFETIME_SECONDS[purpose]` unless a test needs another. */
  readonly lifetimeSeconds: number;
}

/** A new one-time token: the raw value goes into the emailed link and is never stored. */
export interface IssuedOneTimeToken {
  readonly id: number;
  readonly token: string;
  readonly expiresAt: Date;
}

/** What `OneTimeTokenService.consume()` takes. */
export interface ConsumeOneTimeTokenInput {
  readonly purpose: OneTimeTokenPurpose;
  readonly token: string;
}

/** A token that was just used: whose it was. */
export interface ConsumedOneTimeToken {
  readonly id: number;
  readonly owner: OneTimeTokenOwner;
}

/** A `one_time_tokens` row as the repository inserts it. */
export interface NewOneTimeTokenRow {
  readonly purpose: OneTimeTokenPurpose;
  readonly staff_user_id: number | null;
  readonly customer_id: number | null;
  readonly token_hash: string;
  readonly created_at: Date;
  readonly expires_at: Date;
}

/** The owner columns of a consumed `one_time_tokens` row. */
export interface ConsumedOneTimeTokenRow {
  readonly id: number;
  readonly staff_user_id: number | null;
  readonly customer_id: number | null;
}

/** The scrypt profile of design §10.1, and the sizes of what it produces. */
export interface ScryptProfile {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly maxmem: number;
  readonly keyLength: number;
  readonly saltBytes: number;
}

/** A stored password hash, parsed. */
export interface ParsedPasswordHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly key: Buffer;
}
