import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { randomToken, sha256Hex } from '../../common/crypto/hashing';
import { TransactionContext } from '../../common/database/transaction-context';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { addToInstant } from '../../common/time/time';
import { OPAQUE_TOKEN_PATTERN, REFRESH_REUSE_GRACE_SECONDS } from './auth.constants';
import { SessionsRepository } from './sessions.repository';
import type {
  IssuedSession,
  OpenSessionInput,
  RefreshedSession,
  RefreshOutcome,
  RefreshSessionInput,
  RevokeAllOptions,
  SessionOwner,
  SessionRevokeReason,
  SessionRow,
  SessionScope,
} from './types';

/**
 * Refresh-token sessions for both audiences (design §10.2). Staff (U2a) and customers (U9) call
 * the same service with their own lifetimes and account checks.
 *
 * - `open()` starts a family with its first refresh token. Only the token's SHA-256 is stored.
 * - `refresh()` rotates within the family. The caller's account check runs first, so a
 *   deactivated or blocked account gets its own code. The previous token again within 30 seconds
 *   of its rotation is `REFRESH_CONFLICT` (nothing revoked); later it revokes the family
 *   (`SESSION_REVOKED`). It runs in its own transactions, so the revocation commits before the
 *   error is answered: call it from a `@NoRequestTransaction()` route.
 * - `revokeFamilyOf()` and `revokeAllFor()` end sessions; the guard checks the session on every
 *   request, so they take effect on the next one.
 *
 * `open()` and the revocations join the open transaction, if any.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly transactions: TransactionRepository,
    private readonly context: TransactionContext,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async open(input: OpenSessionInput): Promise<IssuedSession> {
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const familyId = randomUUID();
      const refreshToken = randomToken();
      const expiresAt = addToInstant(now, { seconds: input.lifetimeSeconds });
      const sessionId = await this.sessions.insert({
        family_id: familyId,
        staff_user_id: input.owner.audience === 'staff' ? input.owner.id : null,
        customer_id: input.owner.audience === 'customer' ? input.owner.id : null,
        token_hash: sha256Hex(refreshToken),
        created_at: now,
        expires_at: expiresAt,
      });
      return { sessionId, familyId, refreshToken, expiresAt };
    });
  }

  async refresh(input: RefreshSessionInput): Promise<RefreshedSession> {
    if (this.context.isActive()) {
      throw new AppError('INTERNAL', 'A refresh must run outside the request transaction.');
    }
    const outcome = await this.transactions.run(() => this.rotate(input));
    if (outcome.kind === 'rotated') return outcome.session;

    // A reuse revokes the family in a transaction of its own, after the one that read the
    // presented row (and held its lock) ended: the revocation then locks the live heads before any
    // other row, as every revocation does, so replays and sign-outs racing it can't deadlock.
    await this.transactions.run(async () => {
      await this.revokeScope({ kind: 'family', familyId: outcome.familyId }, 'refresh_reuse');
      await this.audit.record({
        actor: { kind: 'system' },
        action: 'session.reuse_detected',
        entity: { type: 'session', id: outcome.sessionId },
        metadata: { audience: input.audience },
      });
    });
    throw new AppError('SESSION_REVOKED');
  }

  /** Revokes the whole family of a session (sign-out). Does nothing for an unknown session. */
  async revokeFamilyOf(sessionId: number, reason: SessionRevokeReason): Promise<number> {
    return this.transactions.run(async () => {
      const familyId = await this.sessions.familyOf(sessionId);
      if (familyId === undefined) return 0;
      return this.revokeScope({ kind: 'family', familyId }, reason);
    });
  }

  /**
   * Revokes every session of an account (deactivation, demotion, blocking, password change).
   * With `exceptSessionId`, the family of that session stays live: a customer's password change
   * keeps the device in use signed in and signs out every other one (U9).
   */
  async revokeAllFor(
    owner: SessionOwner,
    reason: SessionRevokeReason,
    options: RevokeAllOptions = {},
  ): Promise<number> {
    return this.transactions.run(async () => {
      const exceptFamilyId =
        options.exceptSessionId === undefined
          ? undefined
          : await this.sessions.familyOf(options.exceptSessionId);
      const scope: SessionScope = {
        kind: 'owner',
        owner,
        ...(exceptFamilyId === undefined ? {} : { exceptFamilyId }),
      };
      return this.revokeScope(scope, reason);
    });
  }

  private async rotate(input: RefreshSessionInput): Promise<RefreshOutcome> {
    if (!OPAQUE_TOKEN_PATTERN.test(input.refreshToken)) throw new AppError('UNAUTHENTICATED');
    const row = await this.sessions.findByTokenHashForUpdate(sha256Hex(input.refreshToken));
    const ownerId = row ? ownerIdOf(row, input.audience) : null;
    if (!row || ownerId === null) throw new AppError('UNAUTHENTICATED');
    // The account first, as the per-request check does (design 10.3): a deactivated or blocked
    // account had every session revoked with it, and its own code is the clearer answer.
    await input.assertOwnerLive(ownerId);

    const now = this.clock.now();
    if (row.revoked_at !== null) throw new AppError('SESSION_REVOKED');
    if (row.expires_at.getTime() <= now.getTime()) throw new AppError('SESSION_EXPIRED');
    if (row.rotated_at !== null) {
      const graceEnds = addToInstant(row.rotated_at, { seconds: REFRESH_REUSE_GRACE_SECONDS });
      if (now.getTime() < graceEnds.getTime()) throw new AppError('REFRESH_CONFLICT');
      return { kind: 'reused', familyId: row.family_id, sessionId: row.id };
    }

    const refreshToken = randomToken();
    const sessionId = await this.sessions.insert({
      family_id: row.family_id,
      staff_user_id: row.staff_user_id,
      customer_id: row.customer_id,
      token_hash: sha256Hex(refreshToken),
      created_at: now,
      expires_at: row.expires_at,
    });
    await this.sessions.markRotated(row.id, now, sessionId);
    return {
      kind: 'rotated',
      session: { sessionId, ownerId, refreshToken, expiresAt: row.expires_at },
    };
  }

  private async revokeScope(scope: SessionScope, reason: SessionRevokeReason): Promise<number> {
    await this.sessions.lockLiveHeads(scope);
    return this.sessions.revoke(scope, this.clock.now(), reason);
  }
}

/** The owner id of a row for the audience, or null when the row belongs to the other audience. */
function ownerIdOf(row: SessionRow, audience: RefreshSessionInput['audience']): number | null {
  return audience === 'staff' ? row.staff_user_id : row.customer_id;
}
