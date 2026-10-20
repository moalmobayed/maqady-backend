import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { OWNER_COLUMN } from './auth.constants';
import type {
  ConsumedOneTimeTokenRow,
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
}
