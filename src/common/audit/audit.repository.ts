import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { TransactionContext } from '../database/transaction-context';
import type { AuditEventRow } from './types';

/**
 * Writes `audit_events` through the current executor, so a record commits with its request.
 * node-pg sends `changed_fields` as a text array and `metadata` as JSON.
 */
@Injectable()
export class AuditRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: AuditEventRow): Promise<number> {
    const [inserted] = await this.db
      .executor()('audit_events')
      .insert(row)
      .returning<{ id: number }[]>('id');
    if (!inserted) throw new AppError('INTERNAL', 'The audit event insert returned no id.');
    return inserted.id;
  }
}
