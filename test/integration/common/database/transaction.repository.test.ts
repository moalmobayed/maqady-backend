import type { Knex } from 'knex';
import { TransactionContext } from '../../../../src/common/database/transaction-context';
import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import { createTestApp } from '../../../support/test-app';
import { TEST_SCHEMA } from '../../../support/test-config';
import type { TestApp } from '../../../support/types';

const TABLE = 'zz_transaction_items';
const CONSTRAINT = 'uq_zz_transaction_items_code';

describe('TransactionRepository and TransactionContext (integration)', () => {
  let testApp: TestApp;
  let transactions: TransactionRepository;
  let context: TransactionContext;

  /** Inserts through whatever executor the context gives, as a repository does. */
  const insert = (code: string): Promise<unknown> => context.executor()(TABLE).insert({ code });
  const codes = async (): Promise<string[]> =>
    (await testApp.knex(TABLE).select('code').orderBy('id')).map(
      (row: { code: string }) => row.code,
    );
  /** The current backend's transaction id, or null outside a transaction. */
  const transactionId = async (executor: Knex): Promise<string | null> => {
    const { rows } = await executor.raw<{ rows: { id: string | null }[] }>(
      'SELECT pg_current_xact_id_if_assigned()::text AS id',
    );
    return rows[0]?.id ?? null;
  };

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.knex.raw(
      'CREATE TABLE IF NOT EXISTS ??.?? (id BIGSERIAL PRIMARY KEY, code TEXT NOT NULL, CONSTRAINT ?? UNIQUE (code))',
      [TEST_SCHEMA, TABLE, CONSTRAINT],
    );
    transactions = testApp.app.get(TransactionRepository);
    context = testApp.app.get(TransactionContext);
  });

  beforeEach(async () => {
    await testApp.knex(TABLE).truncate();
  });

  afterAll(async () => {
    await testApp.knex.raw('DROP TABLE IF EXISTS ??.??', [TEST_SCHEMA, TABLE]);
    await testApp.close();
  });

  it('commits what run() wrote', async () => {
    await transactions.run(async () => {
      await insert('a');
      await insert('b');
    });
    expect(await codes()).toEqual(['a', 'b']);
  });

  it('rolls back every write when the function throws, and rethrows the error', async () => {
    const failure = new AppError('CONFLICT');
    await expect(
      transactions.run(async () => {
        await insert('a');
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await codes()).toEqual([]);
  });

  it('gives repositories the transaction inside run(), and the pool outside it', async () => {
    expect(context.isActive()).toBe(false);
    expect(context.executor()).toBe(testApp.knex);
    await transactions.run(async () => {
      expect(context.isActive()).toBe(true);
      expect(context.executor()).not.toBe(testApp.knex);
      await insert('inside');
      // Another connection can't see the row before the commit.
      expect(await codes()).toEqual([]);
    });
    expect(context.isActive()).toBe(false);
  });

  it('keeps concurrent transactions apart: each async flow sees its own', async () => {
    const seen: (string | null)[] = [];
    await Promise.all(
      ['x', 'y'].map((code) =>
        transactions.run(async () => {
          await insert(code);
          seen.push(await transactionId(context.executor()));
        }),
      ),
    );
    expect(new Set(seen).size).toBe(2);
    expect((await codes()).sort()).toEqual(['x', 'y']);
  });

  it('joins the open transaction when run() is called inside run()', async () => {
    await expect(
      transactions.run(async () => {
        const outer = context.executor();
        await insert('outer');
        await transactions.run(async () => {
          expect(context.executor()).toBe(outer);
          await insert('inner');
        });
        throw new AppError('CONFLICT');
      }),
    ).rejects.toThrow(AppError);
    // The inner run committed nothing on its own: the outer rollback took both rows.
    expect(await codes()).toEqual([]);
  });

  it('lets a savepoint fail on a unique violation while the transaction carries on', async () => {
    await transactions.run(async () => {
      await insert('taken');
      const results: string[] = [];
      for (const code of ['new-1', 'taken', 'new-2']) {
        try {
          await transactions.savepoint(() => insert(code));
          results.push(`${code}: inserted`);
        } catch (error) {
          results.push(`${code}: ${(error as { code?: string }).code}`);
        }
      }
      expect(results).toEqual(['new-1: inserted', 'taken: 23505', 'new-2: inserted']);
    });
    expect(await codes()).toEqual(['taken', 'new-1', 'new-2']);
  });

  it('refuses a savepoint outside a transaction', async () => {
    await expect(transactions.savepoint(() => insert('a'))).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(await codes()).toEqual([]);
  });

  describe('post-commit hooks', () => {
    it('run after the commit, when the data is visible to everyone', async () => {
      const visibleToHook: string[][] = [];
      const order: string[] = [];
      await transactions.run(async () => {
        await insert('a');
        await transactions.afterCommit(async () => {
          order.push('hook');
          visibleToHook.push(await codes());
        });
        order.push('body done');
      });
      expect(order).toEqual(['body done', 'hook']);
      expect(visibleToHook).toEqual([['a']]);
    });

    it('never run when the transaction rolls back', async () => {
      const hook = jest.fn();
      await expect(
        transactions.run(async () => {
          await transactions.afterCommit(hook);
          throw new AppError('CONFLICT');
        }),
      ).rejects.toThrow(AppError);
      expect(hook).not.toHaveBeenCalled();
    });

    it('wait for the outermost commit when registered in a joined run', async () => {
      const hook = jest.fn();
      await transactions.run(async () => {
        await transactions.run(() => transactions.afterCommit(hook));
        expect(hook).not.toHaveBeenCalled();
      });
      expect(hook).toHaveBeenCalledTimes(1);
    });

    it('of a released savepoint run after the outer commit; of a rolled-back one, never', async () => {
      const kept = jest.fn();
      const dropped = jest.fn();
      await transactions.run(async () => {
        await transactions.savepoint(() => transactions.afterCommit(kept));
        await transactions
          .savepoint(async () => {
            await transactions.afterCommit(dropped);
            throw new AppError('CONFLICT');
          })
          .catch(() => undefined);
        expect(kept).not.toHaveBeenCalled();
      });
      expect(kept).toHaveBeenCalledTimes(1);
      expect(dropped).not.toHaveBeenCalled();
    });

    it('run at once outside a transaction, where the write already committed', async () => {
      const hook = jest.fn();
      await transactions.afterCommit(hook);
      expect(hook).toHaveBeenCalledTimes(1);
    });

    it('that fail do not fail the committed transaction or the hooks after them', async () => {
      const later = jest.fn();
      const result = await transactions.run(async () => {
        await insert('a');
        await transactions.afterCommit(() => {
          throw new Error('hook failure');
        });
        await transactions.afterCommit(later);
        return 'done';
      });
      expect(result).toBe('done');
      expect(later).toHaveBeenCalledTimes(1);
      expect(await codes()).toEqual(['a']);
    });
  });

  describe('post-rollback hooks', () => {
    it('run once the outermost transaction rolled back, outside it, and never after a commit', async () => {
      const seen: { active: boolean; codes: string[] }[] = [];
      const failure = new AppError('SEAT_TAKEN');
      await expect(
        transactions.run(async () => {
          await insert('lost');
          await transactions.run(() =>
            transactions.afterRollback(async () => {
              seen.push({ active: context.isActive(), codes: await codes() });
              // A hook may open its own transaction, which commits.
              await transactions.run(() => insert('recorded'));
            }),
          );
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(seen).toEqual([{ active: false, codes: [] }]);
      expect(await codes()).toEqual(['recorded']);

      const unused = jest.fn();
      await transactions.run(() => transactions.afterRollback(unused));
      expect(unused).not.toHaveBeenCalled();
    });

    it('of a savepoint wait for the outermost transaction, released or rolled back', async () => {
      const released = jest.fn();
      const rolledBack = jest.fn();
      await transactions.run(async () => {
        await transactions.savepoint(() => transactions.afterRollback(released));
        await transactions
          .savepoint(async () => {
            await transactions.afterRollback(rolledBack);
            throw new AppError('CONFLICT');
          })
          .catch(() => undefined);
      });
      expect(released).not.toHaveBeenCalled();
      expect(rolledBack).not.toHaveBeenCalled();

      await expect(
        transactions.run(async () => {
          await transactions
            .savepoint(async () => {
              await transactions.afterRollback(rolledBack);
              throw new AppError('CONFLICT');
            })
            .catch(() => undefined);
          throw new AppError('CONFLICT');
        }),
      ).rejects.toThrow(AppError);
      expect(rolledBack).toHaveBeenCalledTimes(1);
    });

    it('that fail are logged, and the original error is still thrown', async () => {
      const failure = new AppError('CONFLICT');
      const later = jest.fn();
      await expect(
        transactions.run(async () => {
          await transactions.afterRollback(() => {
            throw new Error('hook failure');
          });
          await transactions.afterRollback(later);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(later).toHaveBeenCalledTimes(1);
    });

    it('are refused outside a transaction', async () => {
      await expect(transactions.afterRollback(jest.fn())).rejects.toEqual(
        new AppError('INTERNAL', 'afterRollback() needs an open transaction.'),
      );
    });
  });
});
