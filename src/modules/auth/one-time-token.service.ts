import { Injectable } from '@nestjs/common';
import { randomToken, sha256Hex } from '../../common/crypto/hashing';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { addToInstant } from '../../common/time/time';
import { ONE_TIME_TOKEN_OWNER_KIND, OPAQUE_TOKEN_PATTERN } from './auth.constants';
import { OneTimeTokensRepository } from './one-time-tokens.repository';
import type {
  ConsumedOneTimeToken,
  ConsumeOneTimeTokenInput,
  IssuedOneTimeToken,
  IssueOneTimeTokenInput,
  ConsumedOneTimeTokenRow,
  LiveOneTimeToken,
  OneTimeTokenOwner,
} from './types';

/**
 * Single-use emailed links (design §10.5): 32 random bytes, stored as SHA-256, usable once. For
 * staff invites and resets (U2b) and customer verification and resets (U9). Every method joins
 * the open transaction, so a link is issued or consumed together with the change it belongs to.
 */
@Injectable()
export class OneTimeTokenService {
  constructor(
    private readonly tokens: OneTimeTokensRepository,
    private readonly transactions: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  /** A new token; the owner's earlier unused tokens of the same purpose stop working. */
  async issue(input: IssueOneTimeTokenInput): Promise<IssuedOneTimeToken> {
    if (ONE_TIME_TOKEN_OWNER_KIND[input.purpose] !== input.owner.kind) {
      throw new AppError('INTERNAL', 'A one-time token purpose names the wrong kind of owner.');
    }
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const token = randomToken();
      const expiresAt = addToInstant(now, { seconds: input.lifetimeSeconds });
      await this.tokens.deleteUnused(input.owner, input.purpose);
      const id = await this.tokens.insert({
        purpose: input.purpose,
        staff_user_id: input.owner.kind === 'staff' ? input.owner.id : null,
        customer_id: input.owner.kind === 'customer' ? input.owner.id : null,
        token_hash: sha256Hex(token),
        created_at: now,
        expires_at: expiresAt,
      });
      return { id, token, expiresAt };
    });
  }

  /**
   * Uses a token once and says whose it was. Unknown, already used, expired, or issued for another
   * purpose: `INVALID_TOKEN`.
   */
  async consume(input: ConsumeOneTimeTokenInput): Promise<ConsumedOneTimeToken> {
    if (!OPAQUE_TOKEN_PATTERN.test(input.token)) throw new AppError('INVALID_TOKEN');
    return this.transactions.run(async () => {
      const row = await this.tokens.consume(
        sha256Hex(input.token),
        input.purpose,
        this.clock.now(),
      );
      if (!row) throw new AppError('INVALID_TOKEN');
      return { id: row.id, owner: ownerOf(row) };
    });
  }

  /**
   * Whose a live token is and what it is for, without using it or locking anything: null when it
   * is malformed, unknown, used or expired. A caller that must lock the owner before the token
   * (a password setup, which locks the member as every staff change does) reads it here, takes
   * its lock, then `consume()`s it; a token used or deleted in between fails `consume()`.
   */
  async findLive(token: string): Promise<LiveOneTimeToken | null> {
    if (!OPAQUE_TOKEN_PATTERN.test(token)) return null;
    const row = await this.tokens.findLive(sha256Hex(token), this.clock.now());
    return row ? { id: row.id, purpose: row.purpose, owner: ownerOf(row) } : null;
  }

  /** Deletes every unused token of an account, of any purpose (deactivation, anonymisation). */
  async invalidateAllFor(owner: OneTimeTokenOwner): Promise<number> {
    return this.transactions.run(() => this.tokens.deleteUnused(owner));
  }
}

/** The one owner a row names (the table's CHECK guarantees exactly one). */
function ownerOf(row: ConsumedOneTimeTokenRow): OneTimeTokenOwner {
  if (row.staff_user_id !== null) return { kind: 'staff', id: row.staff_user_id };
  if (row.customer_id !== null) return { kind: 'customer', id: row.customer_id };
  throw new AppError('INTERNAL', 'A one-time token has no owner.');
}
