import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Knex } from 'knex';
import { AppError } from '../errors/app-error';
import { KNEX } from './database.constants';
import { TransactionContext } from './transaction-context';
import type { PostCommitHook, TransactionState } from './types';

/**
 * The only place outside feature repositories that opens a Knex transaction (design §5, §14.1).
 *
 * - `run(fn)` runs `fn` in a transaction that repositories pick up through `TransactionContext`.
 *   When one is already open (a service called from a write request), `fn` joins it.
 * - `savepoint(fn)` runs `fn` in a savepoint of the open transaction: when `fn` throws, only its
 *   own writes roll back, and the caller may catch the error and carry on (batch inserts).
 * - `afterCommit(hook)` runs `hook` once the outermost transaction commits, and never when it
 *   rolls back. Outside a transaction the hook runs at once. A failing hook is logged and does
 *   not fail the request: the data is already committed.
 * - `afterRollback(hook)` runs `hook` once the outermost transaction has rolled back, and never
 *   when it commits (U10: a refused hold records its refusal in a transaction of its own once
 *   its own writes are gone). The hook runs outside any transaction, after the connection is
 *   back in the pool. A failing hook is logged and the original error is still thrown. Outside a
 *   transaction it is a bug (`INTERNAL`): there is nothing to roll back.
 */
@Injectable()
export class TransactionRepository {
  private readonly logger = new Logger(TransactionRepository.name);

  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly context: TransactionContext,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.context.isActive()) return fn();

    const hooks: PostCommitHook[] = [];
    const rollbackHooks: PostCommitHook[] = [];
    let result: T;
    try {
      result = await this.knex.transaction((executor) =>
        this.context.enter({ executor, hooks, rollbackHooks }, fn),
      );
    } catch (error) {
      await this.runHooks(rollbackHooks, 'A post-rollback hook failed');
      throw error;
    }
    await this.runHooks(hooks);
    return result;
  }

  async savepoint<T>(fn: () => Promise<T>): Promise<T> {
    const parent = this.context.current();
    if (!parent) {
      throw new AppError('INTERNAL', 'A savepoint needs an open transaction.');
    }
    const hooks: PostCommitHook[] = [];
    const rollbackHooks: PostCommitHook[] = [];
    let result: T;
    try {
      result = await parent.executor.transaction((executor) =>
        this.context.enter({ executor, hooks, rollbackHooks }, fn),
      );
    } finally {
      // Rollback hooks wait for the outermost transaction, whether the savepoint was released
      // or rolled back: they run only if the whole transaction rolls back.
      parent.rollbackHooks.push(...rollbackHooks);
    }
    // Released: the savepoint's hooks now belong to the enclosing transaction.
    parent.hooks.push(...hooks);
    return result;
  }

  async afterCommit(hook: PostCommitHook): Promise<void> {
    const state: TransactionState | undefined = this.context.current();
    if (state) {
      state.hooks.push(hook);
      return;
    }
    await this.runHooks([hook]);
  }

  async afterRollback(hook: PostCommitHook): Promise<void> {
    const state: TransactionState | undefined = this.context.current();
    if (!state) {
      throw new AppError('INTERNAL', 'afterRollback() needs an open transaction.');
    }
    state.rollbackHooks.push(hook);
    return Promise.resolve();
  }

  private async runHooks(
    hooks: readonly PostCommitHook[],
    failure = 'A post-commit hook failed',
  ): Promise<void> {
    for (const hook of hooks) {
      try {
        await hook();
      } catch (error) {
        this.logger.error({ err: error }, failure);
      }
    }
  }
}
