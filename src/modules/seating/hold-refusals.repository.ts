import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import type { HoldRefusalRow } from './types';

/** `hold_refusals` (design §6.2): one row per hold refused with `SEAT_TAKEN`. */
@Injectable()
export class HoldRefusalsRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: HoldRefusalRow): Promise<void> {
    await this.db.executor()('hold_refusals').insert(row);
  }
}
