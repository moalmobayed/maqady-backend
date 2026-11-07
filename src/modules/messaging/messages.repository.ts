import { Inject, Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { KNEX } from '../../common/database/database.constants';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { ClaimedMessage, NewMessageRow } from './types';

/**
 * `messages`, the outbox (design §13.1).
 *
 * - Queueing (`nextId`, `insert`) runs on the current executor, so a message commits or rolls
 *   back with the change that caused it.
 * - The drain (`claimDue` and the `mark…` methods) always runs on the pool, one autocommit
 *   statement at a time and outside any transaction, so no connection is held while a provider
 *   is called.
 */
@Injectable()
export class MessagesRepository {
  constructor(
    private readonly db: TransactionContext,
    @Inject(KNEX) private readonly knex: Knex,
  ) {}

  /** Reserves the next id, so the payload can be encrypted bound to it before the insert. */
  async nextId(): Promise<number> {
    const { rows } = await this.db
      .executor()
      .raw<{ rows: { id: number }[] }>(
        "SELECT nextval(pg_get_serial_sequence('messages', 'id'))::bigint AS id",
      );
    const id = rows[0]?.id;
    if (id === undefined) throw new AppError('INTERNAL', 'No message id was reserved.');
    return id;
  }

  /** Reserves `count` ids from the same sequence in one query, for `queueMany()`. */
  async nextIds(count: number): Promise<number[]> {
    if (!Number.isInteger(count) || count < 1) {
      throw new AppError('INTERNAL', 'nextIds() reserves at least one id.');
    }
    const { rows } = await this.db
      .executor()
      .raw<{ rows: { id: number }[] }>(
        "SELECT nextval(pg_get_serial_sequence('messages', 'id'))::bigint AS id FROM generate_series(1, ?)",
        [count],
      );
    if (rows.length !== count) throw new AppError('INTERNAL', 'Too few message ids were reserved.');
    return rows.map((row) => row.id).sort((a, b) => a - b);
  }

  async insert(row: NewMessageRow): Promise<void> {
    await this.db.executor()('messages').insert(row);
  }

  /** Inserts several messages in one multi-row statement. */
  async insertMany(rows: readonly NewMessageRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .executor()('messages')
      .insert([...rows]);
  }

  /** Deletes the customer's messages in the current transaction (`idx_messages_related_customer_id`). */
  async deleteRelatedToCustomer(customerId: number): Promise<number> {
    return this.db.executor()('messages').where({ related_customer_id: customerId }).delete();
  }

  /**
   * Claims up to `limit` due queued messages: their `next_attempt_at` moves to `leaseUntil`, so
   * no other drain claims them while they are sent. `SKIP LOCKED` lets concurrent drains take
   * disjoint rows instead of waiting for each other.
   */
  async claimDue(now: Date, leaseUntil: Date, limit: number): Promise<ClaimedMessage[]> {
    const { rows } = await this.knex.raw<{ rows: ClaimedMessage[] }>(
      `WITH due AS (
         SELECT id FROM messages
         WHERE status = 'queued' AND next_attempt_at <= ?
         ORDER BY next_attempt_at, id
         LIMIT ?
         FOR UPDATE SKIP LOCKED
       )
       UPDATE messages
       SET next_attempt_at = ?, updated_at = ?
       FROM due
       WHERE messages.id = due.id
       RETURNING messages.id, messages.channel, messages.template, messages.recipient,
                 messages.attempts, messages.payload_ciphertext`,
      [now, limit, leaseUntil, now],
    );
    return [...rows].sort((a, b) => a.id - b.id);
  }

  /** Records a delivery and clears the encrypted parameters: nothing secret stays stored. */
  async markSent(id: number, providerMessageId: string, now: Date): Promise<void> {
    await this.knex('messages')
      .where({ id, status: 'queued' })
      .update({
        status: 'sent',
        attempts: this.knex.raw('attempts + 1'),
        provider_message_id: providerMessageId,
        sent_at: now,
        next_attempt_at: null,
        payload_ciphertext: null,
        last_error_code: null,
        updated_at: now,
      });
  }

  /** Records a counted failed attempt; the message stays queued until `nextAttemptAt`. */
  async markRetry(
    id: number,
    attempts: number,
    nextAttemptAt: Date,
    errorCode: string,
    now: Date,
  ): Promise<void> {
    await this.knex('messages').where({ id, status: 'queued' }).update({
      attempts,
      next_attempt_at: nextAttemptAt,
      last_error_code: errorCode,
      updated_at: now,
    });
  }

  /** A rate or quota refusal: not an attempt, the messages wait until `retryAt`. */
  async markThrottled(
    ids: readonly number[],
    retryAt: Date,
    errorCode: string,
    now: Date,
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.knex('messages')
      .whereIn('id', ids)
      .andWhere({ status: 'queued' })
      .update({ next_attempt_at: retryAt, last_error_code: errorCode, updated_at: now });
  }

  /** Terminal: the provider refused the message, or every attempt was used. */
  async markFailed(id: number, attempts: number, errorCode: string, now: Date): Promise<void> {
    await this.knex('messages').where({ id, status: 'queued' }).update({
      status: 'failed',
      attempts,
      next_attempt_at: null,
      last_error_code: errorCode,
      updated_at: now,
    });
  }
}
