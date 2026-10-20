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
    const result = await this.knex.transaction((executor) =>
      this.context.enter({ executor, hooks }, fn),
    );
    await this.runHooks(hooks);
    return result;
  }

  async savepoint<T>(fn: () => Promise<T>): Promise<T> {
    const parent = this.context.current();
    if (!parent) {
      throw new AppError('INTERNAL', 'A savepoint needs an open transaction.');
    }
    const hooks: PostCommitHook[] = [];
    const result = await parent.executor.transaction((executor) =>
      this.context.enter({ executor, hooks }, fn),
    );
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

  private async runHooks(hooks: readonly PostCommitHook[]): Promise<void> {
    for (const hook of hooks) {
      try {
        await hook();
      } catch (error) {
        this.logger.error({ err: error }, 'A post-commit hook failed');
      }
    }
  }
}
