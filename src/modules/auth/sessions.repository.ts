import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { OWNER_COLUMN } from './auth.constants';
import type { NewSessionRow, SessionRevokeReason, SessionRow, SessionScope } from './types';

const SESSION_COLUMNS = [
  'id',
  'family_id',
  'staff_user_id',
  'customer_id',
  'expires_at',
  'rotated_at',
  'revoked_at',
] as const;

/** `sessions`, for staff and customers alike (design §6.2, §10.2). */
@Injectable()
export class SessionsRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: NewSessionRow): Promise<number> {
    const [inserted] = await this.db
      .executor()('sessions')
      .insert(row)
      .returning<{ id: number }[]>('id');
    if (!inserted) throw new AppError('INTERNAL', 'The session insert returned no id.');
    return inserted.id;
  }

  /**
   * The row of a presented refresh token, locked until the transaction ends, so two refreshes of
   * one token run one after the other. Undefined when no row has that hash.
   */
  async findByTokenHashForUpdate(tokenHash: string): Promise<SessionRow | undefined> {
    const row = await this.db
      .executor()('sessions')
      .select<SessionRow[]>(SESSION_COLUMNS)
      .where({ token_hash: tokenHash })
      .forUpdate()
      .first();
    return row;
  }

  /** The family a session row belongs to, or undefined when there is no such row. */
  async familyOf(sessionId: number): Promise<string | undefined> {
    const row = await this.db
      .executor()('sessions')
      .select<{ family_id: string }[]>('family_id')
      .where({ id: sessionId })
      .first();
    return row?.family_id;
  }

  async markRotated(id: number, rotatedAt: Date, replacedById: number): Promise<void> {
    await this.db
      .executor()('sessions')
      .update({ rotated_at: rotatedAt, replaced_by_id: replacedById })
      .where({ id });
  }

  /**
   * Locks the live heads of the scope: the rows not yet rotated or revoked, which are the ones a
   * refresh locks. A refresh in flight therefore finishes first, and the revocation that follows
   * (a new statement, so a new snapshot) also sees the row it inserted.
   */
  async lockLiveHeads(scope: SessionScope): Promise<void> {
    await this.scoped(scope)
      .select('id')
      .whereNull('rotated_at')
      .whereNull('revoked_at')
      .orderBy('id')
      .forUpdate();
  }

  /** Revokes every unrevoked row of the scope; returns how many rows it revoked. */
  async revoke(scope: SessionScope, revokedAt: Date, reason: SessionRevokeReason): Promise<number> {
    return this.scoped(scope)
      .whereNull('revoked_at')
      .update({ revoked_at: revokedAt, revoked_reason: reason });
  }

  /**
   * Deletes every row of the scope in one statement; returns how many. Rows of one family point
   * at each other (`replaced_by_id`), so they go together.
   */
  async deleteScope(scope: SessionScope): Promise<number> {
    return this.scoped(scope).delete();
  }

  private scoped(scope: SessionScope) {
    const query = this.db.executor()('sessions');
    if (scope.kind === 'family') return query.where({ family_id: scope.familyId });
    query.where(OWNER_COLUMN[scope.owner.audience], scope.owner.id);
    if (scope.exceptFamilyId !== undefined) query.whereNot({ family_id: scope.exceptFamilyId });
    return query;
  }
}
