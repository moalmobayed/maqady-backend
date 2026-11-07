import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { isPostgresError, SQLSTATE } from '../../common/database/postgres-errors';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { PageRequest } from '../../common/pagination/types';
import { customerListConditions } from './customer-search';
import { LIVE_EMAIL_UNIQUE_INDEX } from './customers.constants';
import type {
  AdminCustomerFilter,
  CustomerDetailsUpdate,
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
   * Records a sign-in of a live, active customer whose hash is still the one the password was
   * checked against, and returns the row as it now is; undefined otherwise. The update waits for a
   * block, password change or reset in flight and re-checks its result, so no session opens beside
   * one of them and escapes its revocation.
   */
  async recordSignIn(
    id: number,
    checkedPasswordHash: string,
    signedInAt: Date,
  ): Promise<CustomerRow | undefined> {
    const [row] = await this.customers()
      .update({ last_sign_in_at: signedInAt })
      .where({ id, status: 'active', password_hash: checkedPasswordHash })
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

  // --- Admin customers (U15) ----------------------------------------------------------------

  /**
   * One page of the admin customers list (PRD A7), `limit + 1` live rows, newest account first
   * (`created_at DESC, id DESC`, `idx_customers_created_at`). The cursor's sort key is the
   * account's `created_at` as an ISO instant, bound as a `Date`.
   */
  async pageForAdmin(filter: AdminCustomerFilter, page: PageRequest): Promise<CustomerRow[]> {
    const query = this.adminCustomers(filter)
      .select<CustomerRow[]>(CUSTOMER_COLUMNS)
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.andWhereRaw('(created_at, id) < (?, ?)', [
        new Date(String(page.after.sortKey)),
        page.after.id,
      ]);
    }
    return query;
  }

  /** How many live customers the admin list has with these filters. */
  async countForAdmin(filter: AdminCustomerFilter): Promise<number> {
    const row = await this.adminCustomers(filter)
      .count<{ count: number }[]>({ count: 'id' })
      .first();
    return row?.count ?? 0;
  }

  /**
   * An admin edit of a live row (U15). A new email that a concurrent edit or registration took
   * first meets `uq_customers_email_live`, which is answered `EMAIL_TAKEN`; the transaction is
   * rolled back with it.
   */
  async updateDetails(id: number, changes: CustomerDetailsUpdate): Promise<CustomerRow> {
    try {
      return await this.updateOne(id, changes);
    } catch (error) {
      if (
        isPostgresError(error) &&
        error.code === SQLSTATE.UNIQUE_VIOLATION &&
        error.constraint === LIVE_EMAIL_UNIQUE_INDEX
      ) {
        throw new AppError('EMAIL_TAKEN');
      }
      throw error;
    }
  }

  /**
   * Anonymises a live row (design §21): nulls the email, name, phone and password hash and sets
   * `deleted_at`; `chk_customers_live_or_anonymised` holds the row to exactly that.
   */
  async anonymise(id: number, at: Date): Promise<CustomerRow> {
    const [updated] = await this.customers()
      .update({
        email: null,
        full_name: null,
        phone: null,
        password_hash: null,
        deleted_at: at,
        updated_at: at,
      })
      .where({ id })
      .whereNull('deleted_at')
      .returning<CustomerRow[]>(CUSTOMER_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The customer to anonymise is gone.');
    return updated;
  }

  private adminCustomers(filter: AdminCustomerFilter): Knex.QueryBuilder {
    const query = this.customers().whereNull('deleted_at');
    for (const condition of customerListConditions(filter)) {
      query.andWhereRaw(condition.sql, [...condition.bindings]);
    }
    return query;
  }

  private async updateOne(
    id: number,
    changes: CustomerRowChanges | CustomerDetailsUpdate,
  ): Promise<CustomerRow> {
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
