import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../database/transaction-context';
import type { StoredIdempotencyKey } from './types';

/**
 * `idempotency_keys` (design §14.1, ADR 0003). Every statement runs on the request transaction,
 * so a key commits or rolls back with the write it protects.
 */
@Injectable()
export class IdempotencyRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * Claims a key without ever raising a unique violation, which would abort the transaction:
   * inserts it, or takes over a row created before `expiredBefore`. Returns the row id, or
   * undefined when a live key already exists. A concurrent first request makes this statement
   * wait until that request commits or rolls back.
   */
  async claim(
    scope: string,
    key: string,
    requestHash: string,
    createdAt: Date,
    expiredBefore: Date,
  ): Promise<number | undefined> {
    const { rows } = await this.db.executor().raw<{ rows: { id: number }[] }>(
      `INSERT INTO idempotency_keys
         (scope, key, request_hash, response_status, response_ciphertext, created_at)
       VALUES (?, ?, ?, NULL, NULL, ?)
       ON CONFLICT (scope, key) DO UPDATE
         SET request_hash = EXCLUDED.request_hash,
             response_status = NULL,
             response_ciphertext = NULL,
             created_at = EXCLUDED.created_at
         WHERE idempotency_keys.created_at < ?
       RETURNING id`,
      [scope, key, requestHash, createdAt, expiredBefore],
    );
    return rows[0]?.id;
  }

  async find(scope: string, key: string): Promise<StoredIdempotencyKey | undefined> {
    return this.db
      .executor()('idempotency_keys')
      .select<StoredIdempotencyKey[]>(
        'id',
        'request_hash',
        'response_status',
        'response_ciphertext',
      )
      .where({ scope, key })
      .first();
  }

  async saveResponse(id: number, status: number, ciphertext: string | null): Promise<void> {
    await this.db
      .executor()('idempotency_keys')
      .where({ id })
      .update({ response_status: status, response_ciphertext: ciphertext });
  }

  /** Deletes every key of the scope (`uq_idempotency_keys_scope_key` leads with it). */
  async deleteScope(scope: string): Promise<number> {
    return this.db.executor()('idempotency_keys').where({ scope }).delete();
  }

  /**
   * Deletes up to `limit` keys created before `expiredBefore`, skipping rows another transaction
   * holds. Postgres `DELETE` has no `LIMIT`, hence the sub-select. This only tidies up: expiry is
   * always judged from `created_at` when a key is claimed.
   */
  async purgeExpired(expiredBefore: Date, limit: number): Promise<number> {
    const { rowCount } = await this.db.executor().raw<{ rowCount: number | null }>(
      `DELETE FROM idempotency_keys
       WHERE id IN (
         SELECT id FROM idempotency_keys
         WHERE created_at < ?
         LIMIT ?
         FOR UPDATE SKIP LOCKED
       )`,
      [expiredBefore, limit],
    );
    return rowCount ?? 0;
  }
}
