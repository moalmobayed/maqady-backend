import { Injectable } from '@nestjs/common';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { SeatEventBus } from './seat-event.bus';
import type { SeatEvent } from './types';

/**
 * Publishes a seat event once the transaction that caused it commits, and never when it rolls
 * back (design §4, §12, §14.1). Outside a transaction the event goes out at once.
 */
@Injectable()
export class SeatEventPublisher {
  constructor(
    private readonly bus: SeatEventBus,
    private readonly transactions: TransactionRepository,
  ) {}

  async publishAfterCommit(event: SeatEvent): Promise<void> {
    if (event.labels.length === 0) return;
    await this.transactions.afterCommit(() => this.bus.publish(event));
  }
}
