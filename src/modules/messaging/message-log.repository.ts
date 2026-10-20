import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import type { PageRequest } from '../../common/pagination/types';
import type { MessageLogDetailRow, MessageLogFilter, MessageLogRow } from './types';

/** What the list shows. `payload_ciphertext` is never selected (design §13.1). */
const LIST_COLUMNS = [
  'id',
  'channel',
  'template',
  'recipient',
  'subject',
  'status',
  'attempts',
  'last_error_code',
  'next_attempt_at',
  'sent_at',
  'related_customer_id',
  'related_staff_user_id',
  'related_booking_id',
  'created_at',
] as const;

const DETAIL_COLUMNS = [
  ...LIST_COLUMNS,
  'body_text',
  'body_html',
  'provider_message_id',
  'updated_at',
] as const;

/**
 * The Message log's reads of `messages` (design §13.1, U2b). It only reads, and never the
 * encrypted template parameters: the stored subject and bodies already have one-time links
 * redacted, so nothing here can reveal one.
 */
@Injectable()
export class MessageLogRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * Up to `limit + 1` messages after the cursor, newest first (`idx_messages_created_at`). The
   * cursor's sort key is the row's `created_at` as an ISO instant (checked by the service); it is
   * bound as a `Date`, so Postgres never parses the client's text.
   */
  async list(filter: MessageLogFilter, page: PageRequest): Promise<MessageLogRow[]> {
    const query = this.filtered(filter)
      .select<MessageLogRow[]>(LIST_COLUMNS)
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.whereRaw('(created_at, id) < (?, ?)', [
        new Date(String(page.after.sortKey)),
        page.after.id,
      ]);
    }
    return query;
  }

  async count(filter: MessageLogFilter): Promise<number> {
    const row = await this.filtered(filter).count<{ count: number }[]>({ count: 'id' }).first();
    return row?.count ?? 0;
  }

  async findById(id: number): Promise<MessageLogDetailRow | undefined> {
    return this.messages().select<MessageLogDetailRow[]>(DETAIL_COLUMNS).where({ id }).first();
  }

  private messages(): Knex.QueryBuilder {
    return this.db.executor()('messages');
  }

  private filtered(filter: MessageLogFilter): Knex.QueryBuilder {
    const query = this.messages();
    if (filter.channel !== undefined) query.where({ channel: filter.channel });
    if (filter.status !== undefined) query.where({ status: filter.status });
    if (filter.from !== undefined) query.where('created_at', '>=', filter.from);
    if (filter.to !== undefined) query.where('created_at', '<', filter.to);
    return query;
  }
}
