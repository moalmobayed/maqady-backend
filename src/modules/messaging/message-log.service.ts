import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { toPage } from '../../common/pagination/cursor';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import type { Page, PageRequest } from '../../common/pagination/types';
import { isIsoInstant } from '../../common/time/time';
import { MessageLogRepository } from './message-log.repository';
import type {
  MessageLogDetail,
  MessageLogDetailRow,
  MessageLogEntry,
  MessageLogFilter,
  MessageLogRow,
} from './types';

/**
 * The admin Message log (PRD "Message log", design §13.1): every email and SMS with its delivery
 * status, newest first, and each message as it was stored. Read-only. One-time links were
 * redacted when the message was queued, and the encrypted parameters are never read, so the log
 * can't reveal a usable link.
 */
@Injectable()
export class MessageLogService {
  constructor(private readonly messages: MessageLogRepository) {}

  /**
   * One page of the log, newest first, with the same filters for `total`. `from` must be
   * before `to`, else `VALIDATION_FAILED` on `to`.
   */
  async list(filter: MessageLogFilter, page: PageRequest): Promise<Page<MessageLogEntry>> {
    if (
      page.after &&
      (typeof page.after.sortKey !== 'string' || !isIsoInstant(page.after.sortKey))
    ) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
      });
    }
    if (filter.from && filter.to && filter.from.getTime() >= filter.to.getTime()) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'to', messages: ['to must be later than from'] }],
      });
    }
    const [rows, total] = await Promise.all([
      this.messages.list(filter, page),
      this.messages.count(filter),
    ]);
    return toPage(
      rows,
      page,
      total,
      (row) => ({ sortKey: row.created_at.toISOString(), id: row.id }),
      toEntry,
    );
  }

  /** One message with its stored, redacted subject and bodies; `NOT_FOUND` when there is none. */
  async get(id: number): Promise<MessageLogDetail> {
    const row = await this.messages.findById(id);
    if (!row) throw new AppError('NOT_FOUND');
    return toDetail(row);
  }
}

function toEntry(row: MessageLogRow): MessageLogEntry {
  return {
    id: row.id,
    channel: row.channel,
    template: row.template,
    recipient: row.recipient,
    subject: row.subject,
    status: row.status,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    nextAttemptAt: row.next_attempt_at,
    sentAt: row.sent_at,
    related: {
      customerId: row.related_customer_id,
      staffUserId: row.related_staff_user_id,
      bookingId: row.related_booking_id,
    },
    createdAt: row.created_at,
  };
}

function toDetail(row: MessageLogDetailRow): MessageLogDetail {
  return {
    ...toEntry(row),
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    providerMessageId: row.provider_message_id,
    updatedAt: row.updated_at,
  };
}
