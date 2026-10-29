import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { ONE_TIME_TOKEN_ISSUE_LOCK_PREFIX, OWNER_COLUMN } from './auth.constants';
import type {
  ConsumedOneTimeTokenRow,
  LiveOneTimeTokenRow,
  NewOneTimeTokenRow,
  OneTimeTokenOwner,
  OneTimeTokenPurpose,
} from './types';

/** `one_time_tokens` (design §6.2, §10.5). */
@Injectable()
export class OneTimeTokensRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: NewOneTimeTokenRow): Promise<number> {
    const [inserted] = await this.db
      .executor()('one_time_tokens')
      .insert(row)
      .returning<{ id: number }[]>('id');
    if (!inserted) throw new AppError('INTERNAL', 'The one-time token insert returned no id.');
    return inserted.id;
  }

  /**
   * Serializes issuing tokens of one owner and purpose until the transaction ends. Without it, two
   * concurrent issues each delete nothing they can see and both tokens stay live.
   */
  async lockIssue(owner: OneTimeTokenOwner, purpose: OneTimeTokenPurpose): Promise<void> {
    await this.db
      .executor()
      .raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
        `${ONE_TIME_TOKEN_ISSUE_LOCK_PREFIX}:${owner.kind}:${owner.id}:${purpose}`,
      ]);
  }

  /**
   * Deletes the owner's unused tokens, of one purpose or of all; returns how many. Used tokens stay
   * as the record that a link was followed.
   */
  async deleteUnused(owner: OneTimeTokenOwner, purpose?: OneTimeTokenPurpose): Promise<number> {
    const query = this.db
      .executor()('one_time_tokens')
      .where(OWNER_COLUMN[owner.kind], owner.id)
      .whereNull('used_at');
    if (purpose !== undefined) query.where({ purpose });
    return query.delete();
  }

  /** Deletes every token of the owner, used or not; returns how many. */
  async deleteAll(owner: OneTimeTokenOwner): Promise<number> {
    return this.db.executor()('one_time_tokens').where(OWNER_COLUMN[owner.kind], owner.id).delete();
  }

  /**
   * Marks a live, unused token of the purpose as used and returns its owner, in one statement, so
   * two concurrent uses can't both succeed. Undefined when nothing matched.
   */
  async consume(
    tokenHash: string,
    purpose: OneTimeTokenPurpose,
    now: Date,
  ): Promise<ConsumedOneTimeTokenRow | undefined> {
    const [row] = await this.db
      .executor()('one_time_tokens')
      .update({ used_at: now })
      .where({ token_hash: tokenHash, purpose })
      .whereNull('used_at')
      .where('expires_at', '>', now)
      .returning<ConsumedOneTimeTokenRow[]>(['id', 'staff_user_id', 'customer_id']);
    return row;
  }

  /**
   * The live, unused token with this hash, of any purpose, without locking it. Undefined when
   * nothing matches. `consume()` is still what makes a use count.
   */
  async findLive(tokenHash: string, now: Date): Promise<LiveOneTimeTokenRow | undefined> {
    const row = await this.db
      .executor()('one_time_tokens')
      .select<LiveOneTimeTokenRow[]>(['id', 'purpose', 'staff_user_id', 'customer_id'])
      .where({ token_hash: tokenHash })
      .whereNull('used_at')
      .where('expires_at', '>', now)
      .first();
    return row;
  }
}
