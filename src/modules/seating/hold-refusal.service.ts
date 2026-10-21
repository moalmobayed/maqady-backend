import { Injectable } from '@nestjs/common';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { Clock } from '../../common/time/clock';
import { HoldRefusalsRepository } from './hold-refusals.repository';

/**
 * Records a hold refused with `SEAT_TAKEN` (design §6.2, §7.2), for the seat conflict rate. The
 * refused request rolls back, so the row is written once it has: `recordAfterRollback()`
 * registers the write on the open transaction, and it runs in a short transaction of its own
 * after the rollback, never inside the request (a second connection per refused hold could
 * starve the 5-connection pool during a burst).
 */
@Injectable()
export class HoldRefusalService {
  constructor(
    private readonly refusals: HoldRefusalsRepository,
    private readonly transactions: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  async recordAfterRollback(showtimeId: number, seatCount: number): Promise<void> {
    const refusedAt = this.clock.now();
    await this.transactions.afterRollback(() =>
      this.transactions.run(() =>
        this.refusals.insert({
          showtime_id: showtimeId,
          refused_at: refusedAt,
          seat_count: seatCount,
        }),
      ),
    );
  }
}
