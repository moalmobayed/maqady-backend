import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { PageRequest } from '../../common/pagination/types';
import { ADMIN_CREATE_LOCK_KEY } from './staff.constants';
import type {
  NewStaffUserRow,
  StaffListFilter,
  StaffPrincipalRow,
  StaffUserRow,
  StaffUserUpdate,
} from './types';

const STAFF_COLUMNS = [
  'id',
  'email',
  'full_name',
  'role',
  'status',
  'password_hash',
  'last_sign_in_at',
  'created_at',
  'updated_at',
] as const;

/** `staff_users` (design §6.2). */
@Injectable()
export class StaffRepository {
  constructor(private readonly db: TransactionContext) {}

  async findById(id: number): Promise<StaffUserRow | undefined> {
    return this.staff().select<StaffUserRow[]>(STAFF_COLUMNS).where({ id }).first();
  }

  /** The member's row, locked until the transaction ends. */
  async findByIdForUpdate(id: number): Promise<StaffUserRow | undefined> {
    return this.staff().select<StaffUserRow[]>(STAFF_COLUMNS).where({ id }).forUpdate().first();
  }

  /** By email, case-insensitively (`CITEXT`). */
  async findByEmail(email: string): Promise<StaffUserRow | undefined> {
    return this.staff().select<StaffUserRow[]>(STAFF_COLUMNS).where({ email }).first();
  }

  /**
   * Locks every active admin row, in id order, until the transaction ends, and returns their ids
   * (the last-admin rule, design §10.1). Every staff change takes this lock first, so concurrent
   * changes queue here and each sees the set as the previous one left it.
   */
  async lockActiveAdmins(): Promise<number[]> {
    const rows = await this.staff()
      .select<{ id: number }[]>('id')
      .where({ role: 'admin', status: 'active' })
      .orderBy('id')
      .forUpdate();
    return rows.map((row) => row.id);
  }

  async anyActiveAdminExists(): Promise<boolean> {
    const row = await this.staff()
      .select<{ id: number }[]>('id')
      .where({ role: 'admin', status: 'active' })
      .first();
    return row !== undefined;
  }

  /** Up to `limit + 1` members after the cursor, by full name then id. */
  async list(filter: StaffListFilter, page: PageRequest): Promise<StaffUserRow[]> {
    const query = this.filtered(filter)
      .select<StaffUserRow[]>(STAFF_COLUMNS)
      .orderBy([
        { column: 'full_name', order: 'asc' },
        { column: 'id', order: 'asc' },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.whereRaw('(full_name, id) > (?, ?)', [page.after.sortKey, page.after.id]);
    }
    return query;
  }

  async count(filter: StaffListFilter): Promise<number> {
    const row = await this.filtered(filter).count<{ count: number }[]>({ count: 'id' }).first();
    return row?.count ?? 0;
  }

  /** Inserts a member; undefined when the email is taken (no error, so the transaction lives on). */
  async insert(row: NewStaffUserRow): Promise<StaffUserRow | undefined> {
    const [inserted] = await this.staff()
      .insert(row)
      .onConflict('email')
      .ignore()
      .returning<StaffUserRow[]>(STAFF_COLUMNS);
    return inserted;
  }

  async update(id: number, changes: StaffUserUpdate): Promise<StaffUserRow> {
    const [updated] = await this.staff()
      .update(changes)
      .where({ id })
      .returning<StaffUserRow[]>(STAFF_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The staff member to update is gone.');
    return updated;
  }

  async recordSignIn(id: number, signedInAt: Date): Promise<void> {
    await this.staff()
      .update({ last_sign_in_at: signedInAt, updated_at: signedInAt })
      .where({ id });
  }

  /**
   * The per-request check (design §10.3): the `sid` session and its staff member, by the session's
   * primary key and the member's. Undefined when the session is gone or isn't a staff session.
   */
  async findPrincipalBySession(sessionId: number): Promise<StaffPrincipalRow | undefined> {
    return this.db
      .executor()('sessions as s')
      .join('staff_users as u', 'u.id', 's.staff_user_id')
      .select<StaffPrincipalRow[]>(
        's.staff_user_id',
        's.revoked_at',
        's.expires_at',
        'u.role',
        'u.status',
      )
      .where('s.id', sessionId)
      .first();
  }

  /** Serializes `npm run admin:create` runs until the transaction ends. */
  async takeAdminCreateLock(): Promise<void> {
    await this.db
      .executor()
      .raw('SELECT pg_advisory_xact_lock(hashtext(?))', [ADMIN_CREATE_LOCK_KEY]);
  }

  private staff(): Knex.QueryBuilder {
    return this.db.executor()('staff_users');
  }

  private filtered(filter: StaffListFilter): Knex.QueryBuilder {
    const query = this.staff();
    if (filter.role !== undefined) query.where({ role: filter.role });
    if (filter.status !== undefined) query.where({ status: filter.status });
    return query;
  }
}
