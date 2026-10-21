import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { KNEX } from './database.constants';
import type { TransactionState } from './types';

/**
 * Where repositories get their executor (design §14.1). While a transaction is open in the
 * current async context, `executor()` is that transaction (or the innermost savepoint);
 * otherwise it is the shared pool. Repositories call `this.db.executor()` for every query and
 * never pass a transaction around.
 *
 * Only `TransactionRepository` opens the context; nothing else calls `enter()`.
 */
@Injectable()
export class TransactionContext {
  private readonly storage = new AsyncLocalStorage<TransactionState>();

  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  /** The open transaction, or the pool when none is open. */
  executor(): Knex {
    return this.storage.getStore()?.executor ?? this.knex;
  }

  /** True while a transaction is open in this async context. */
  isActive(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /** The state of the innermost open transaction or savepoint, if any. */
  current(): TransactionState | undefined {
    return this.storage.getStore();
  }

  /** Runs `fn` with `state` as the current transaction. */
  enter<T>(state: TransactionState, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(state, fn);
  }
}
