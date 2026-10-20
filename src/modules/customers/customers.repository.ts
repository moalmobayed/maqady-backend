import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type {
  CustomerPrincipalRow,
  CustomerProfileUpdate,
  CustomerRow,
  CustomerRowChanges,
  CustomerStatus,
  NewCustomerRow,
} from './types';

const CUSTOMER_COLUMNS = [
  'id',
  'email',
  'full_name',
  'phone',
  'password_hash',
  'status',
  'email_verified_at',
  'last_sign_in_at',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

/** `customers` (design §6.2). Every query names its columns and joins the open transaction. */
@Injectable()
export class CustomersRepository {
  constructor(private readonly db: TransactionContext) {}

  /**
   * Inserts a live customer; undefined when a live customer already has the email (any case).
   * `ON CONFLICT … DO NOTHING` never raises, so the request transaction lives on (design §10.5);
   * a concurrent registration of the same email waits for the first to commit, then gets nothing.
   */
  async insertIfEmailFree(row: NewCustomerRow): Promise<CustomerRow | undefined> {
    const [inserted] = await this.customers()
      .insert(row)
      .onConflict(this.db.executor().raw('(email) WHERE deleted_at IS NULL'))
      .ignore()
      .returning<CustomerRow[]>(CUSTOMER_COLUMNS);
    return inserted;
  }

  /** Live or anonymised. */
  async findById(id: number): Promise<CustomerRow | undefined> {
    return this.customers().select<CustomerRow[]>(CUSTOMER_COLUMNS).where({ id }).first();
  }

  /**
   * The customer's row, locked until the transaction ends. `FOR NO KEY UPDATE`, not `FOR UPDATE`:
   * the foreign-key checks of rows that point at the customer (a refresh inserting the next session
   * row, a message naming them) take `FOR KEY SHARE`, which `FOR UPDATE` would block, deadlocking
   * with a revocation that waits on the session row that refresh holds (as for staff, U2a).
   */
  async findByIdForUpdate(id: number): Promise<CustomerRow | undefined> {
    return this.customers()
      .select<CustomerRow[]>(CUSTOMER_COLUMNS)
      .where({ id })
      .forNoKeyUpdate()
      .first();
  }

  /** The live customer with this email, case-insensitively (`CITEXT`, `uq_customers_email_live`). */
  async findLiveByEmail(email: string): Promise<CustomerRow | undefined> {
    return this.customers()
      .select<CustomerRow[]>(CUSTOMER_COLUMNS)
      .where({ email })
      .whereNull('deleted_at')
      .first();
  }

  /**
   * The per-request check (design §10.3): the `sid` session and its customer, by the session's
   * primary key. Undefined when the session is gone or isn't a customer session.
   */
  async findPrincipalBySession(sessionId: number): Promise<CustomerPrincipalRow | undefined> {
    return this.db
      .executor()('sessions as s')
      .join('customers as c', 'c.id', 's.customer_id')
      .select<CustomerPrincipalRow[]>(
        's.customer_id',
        's.revoked_at',
        's.expires_at',
        'c.status',
        'c.deleted_at',
      )
      .where('s.id', sessionId)
      .first();
  }

  /**
   * Records a sign-in of a live, active customer and returns the row as it now is; undefined when
   * the customer is no longer either. The update waits for a block in flight and re-checks the
   * status against its result, so no session opens beside a block and escapes its revocation.
   */
  async recordSignIn(id: number, signedInAt: Date): Promise<CustomerRow | undefined> {
    const [row] = await this.customers()
      .update({ last_sign_in_at: signedInAt })
      .where({ id, status: 'active' })
      .whereNull('deleted_at')
      .returning<CustomerRow[]>(CUSTOMER_COLUMNS);
    return row;
  }

  async updateProfile(id: number, changes: CustomerProfileUpdate): Promise<CustomerRow> {
    return this.updateOne(id, changes);
  }

  async setPasswordHash(id: number, passwordHash: string, at: Date): Promise<CustomerRow> {
    return this.updateOne(id, { password_hash: passwordHash, updated_at: at });
  }

  /** Sets `email_verified_at` on a live customer not yet verified; true when it did. */
  async markEmailVerified(id: number, at: Date): Promise<boolean> {
    const updated = await this.customers()
      .update({ email_verified_at: at, updated_at: at })
      .where({ id })
      .whereNull('email_verified_at')
      .whereNull('deleted_at');
    return updated > 0;
  }

  async setStatus(id: number, status: CustomerStatus, at: Date): Promise<CustomerRow> {
    return this.updateOne(id, { status, updated_at: at });
  }

  private async updateOne(id: number, changes: CustomerRowChanges): Promise<CustomerRow> {
    const [updated] = await this.customers()
      .update(changes)
      .where({ id })
      .whereNull('deleted_at')
      .returning<CustomerRow[]>(CUSTOMER_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The customer to update is gone.');
    return updated;
  }

  private customers(): Knex.QueryBuilder {
    return this.db.executor()('customers');
  }
}
