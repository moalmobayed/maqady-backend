import type { Knex } from 'knex';

/** The fields of a node-pg `DatabaseError` this service reads. Postgres sets `severity` on every error. */
export interface PostgresError extends Error {
  readonly code: string;
  readonly severity: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly detail?: string;
}

/** What every migration receives besides Knex: the schema it creates its tables in. */
export interface MigrationContext {
  readonly schema: string;
}

/** The shape of a file in `src/migrations/`. */
export interface MigrationFile {
  up(knex: Knex, context: MigrationContext): Promise<void>;
  down(knex: Knex, context: MigrationContext): Promise<void>;
  /** Set `{ transaction: false }` for statements that can't run in a transaction. */
  config?: { transaction?: boolean };
}

/** A migration as handed to Knex: `up` and `down` already bound to their context. */
export interface BoundMigration {
  up(knex: Knex): Promise<void>;
  down(knex: Knex): Promise<void>;
  config?: { transaction?: boolean };
}

export interface MigrationResult {
  /** The batch number Knex recorded, or 0 when there was nothing to run. */
  readonly batch: number;
  /** Names of the migrations applied by this run, in order. */
  readonly applied: readonly string[];
}

/** Parses one element of a Postgres array from its text form. */
export type ElementParser = (value: string) => unknown;

/** Work to run once the transaction it was registered in has committed. */
export type PostCommitHook = () => void | Promise<void>;

/**
 * What the transaction context holds while a transaction (or a savepoint inside one) is open:
 * the executor repositories use, and the hooks to run after the outermost commit.
 */
export interface TransactionState {
  readonly executor: Knex.Transaction;
  readonly hooks: PostCommitHook[];
}
