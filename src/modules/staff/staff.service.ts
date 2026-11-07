import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { toPage } from '../../common/pagination/cursor';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import type { Page, PageRequest } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { OneTimeTokenService } from '../auth/one-time-token.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { toStaffMember } from './staff-member.mapper';
import { StaffRepository } from './staff.repository';
import type {
  CreateActiveStaffInput,
  StaffListFilter,
  StaffMember,
  StaffMemberChanges,
  StaffStatus,
  StaffUserRow,
} from './types';

/**
 * Staff accounts (design §10.1, PRD "Staff"): reading and listing members, changing a member's
 * role and status under the last-admin rule, and creating an active member (the bootstrap admin
 * and test fixtures). Invites and password setup are `StaffOnboardingService`'s.
 *
 * Every write joins the request transaction and records an audit event in it.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly staff: StaffRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly oneTimeTokens: OneTimeTokenService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async findById(id: number): Promise<StaffMember | null> {
    const row = await this.staff.findById(id);
    return row ? toStaffMember(row) : null;
  }

  /**
   * These members by id, in one query (U14: the authors of booking notes, the staff named in a
   * booking's activity log, the counter seller); unknown ids are absent.
   */
  async findByIds(ids: readonly number[]): Promise<ReadonlyMap<number, StaffMember>> {
    const rows = await this.staff.findByIds(ids);
    return new Map(rows.map((row) => [row.id, toStaffMember(row)]));
  }

  /**
   * The member, locked `FOR NO KEY UPDATE` until the open transaction ends (design §7.1 step 4,
   * §10.1): a counter hold (U13) locks its member to keep "one live counter hold per member" while
   * a staff change waits for it, and a sessions insert or an audit row naming the member does not.
   */
  async findByIdForUpdate(id: number): Promise<StaffMember | null> {
    const row = await this.staff.findByIdForUpdate(id);
    return row ? toStaffMember(row) : null;
  }

  async findByEmail(email: string): Promise<StaffMember | null> {
    const row = await this.staff.findByEmail(email.trim());
    return row ? toStaffMember(row) : null;
  }

  /** `GET /admin/staff`: by full name then id, with the same filters for `total`. */
  async list(filter: StaffListFilter, page: PageRequest): Promise<Page<StaffMember>> {
    if (page.after && typeof page.after.sortKey !== 'string') {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
      });
    }
    const [rows, total] = await Promise.all([
      this.staff.list(filter, page),
      this.staff.count(filter),
    ]);
    return toPage(
      rows,
      page,
      total,
      (row) => ({ sortKey: row.full_name, id: row.id }),
      toStaffMember,
    );
  }

  /**
   * Changes a member's role and status (design §10.1).
   *
   * - The last-admin rule: every active admin row is locked first, then the member; a change that
   *   would leave no active admin is `LAST_ADMIN`. Two concurrent demotions queue on the lock, and
   *   the second sees the first's result.
   * - Deactivating revokes every session and deletes every unused link of the member; demoting an
   *   admin revokes their sessions, so they sign in again as box office.
   * - Reactivating a member who never set a password returns them to `invited`; `active` on an
   *   invited member is refused (they become active by setting a password).
   * - A change to nothing writes nothing.
   */
  async updateMember(
    actor: StaffPrincipal,
    id: number,
    changes: StaffMemberChanges,
  ): Promise<StaffMember> {
    return this.transactions.run(async () => {
      const activeAdmins = await this.staff.lockActiveAdmins();
      const row = await this.staff.findByIdForUpdate(id);
      if (!row) throw new AppError('NOT_FOUND');

      const role = changes.role ?? row.role;
      const status = nextStatus(row, changes.status);
      const changedFields = [
        ...(role !== row.role ? ['role'] : []),
        ...(status !== row.status ? ['status'] : []),
      ];
      if (changedFields.length === 0) return toStaffMember(row);

      const wasActiveAdmin = row.role === 'admin' && row.status === 'active';
      const staysActiveAdmin = role === 'admin' && status === 'active';
      if (wasActiveAdmin && !staysActiveAdmin && activeAdmins.every((adminId) => adminId === id)) {
        throw new AppError('LAST_ADMIN');
      }

      const updated = await this.staff.update(id, {
        role,
        status,
        updated_at: this.clock.now(),
      });
      const owner = { audience: 'staff', id } as const;
      if (status === 'deactivated' && row.status !== 'deactivated') {
        await this.sessions.revokeAllFor(owner, 'account_deactivated');
        await this.oneTimeTokens.invalidateAllFor({ kind: 'staff', id });
      } else if (row.role === 'admin' && role === 'box_office') {
        await this.sessions.revokeAllFor(owner, 'role_changed');
      }
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'staff_user.updated',
        entity: { type: 'staff_user', id },
        changedFields,
        metadata: { role, status },
      });
      return toStaffMember(updated);
    });
  }

  /**
   * Creates an active member with a password: the bootstrap admin (`npm run admin:create`) and
   * test fixtures. Staff otherwise join through an invite (U2b). A taken email is `EMAIL_TAKEN`.
   */
  async createActiveMember(input: CreateActiveStaffInput): Promise<StaffMember> {
    const passwordHash = await this.passwords.hash(input.password);
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const row = await this.staff.insert({
        email: input.email.trim(),
        full_name: input.fullName.trim(),
        role: input.role,
        status: 'active',
        password_hash: passwordHash,
        created_at: now,
        updated_at: now,
      });
      if (!row) throw new AppError('EMAIL_TAKEN');
      await this.audit.record({
        actor: { kind: 'system' },
        action: 'staff_user.created',
        entity: { type: 'staff_user', id: row.id },
        metadata: { role: row.role, status: row.status },
      });
      return toStaffMember(row);
    });
  }
}

/** The status a requested change leads to (see `updateMember`). */
function nextStatus(row: StaffUserRow, requested: StaffMemberChanges['status']): StaffStatus {
  if (requested === undefined || requested === row.status) return row.status;
  if (requested === 'deactivated') return 'deactivated';
  if (row.status === 'invited') {
    throw new AppError('VALIDATION_FAILED', undefined, {
      fields: [
        {
          field: 'status',
          messages: ['an invited member becomes active by setting their password'],
        },
      ],
    });
  }
  return row.password_hash === null ? 'invited' : 'active';
}
