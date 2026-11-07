import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor } from '../../common/audit/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { toPage, toPageRequest } from '../../common/pagination/cursor';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import type { Page, PageQueryInput, PageRequest } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { ONE_TIME_TOKEN_LIFETIME_SECONDS } from '../auth/auth.constants';
import { OneTimeTokenService } from '../auth/one-time-token.service';
import { SessionService } from '../auth/session.service';
import { MessagingService } from '../messaging/messaging.service';
import { toCustomer } from './customer.mapper';
import { CustomersRepository } from './customers.repository';
import { customerPasswordResetTemplate } from './templates/customer-password-reset.template';
import type {
  AdminCustomerFilter,
  Customer,
  CustomerDetailsChanges,
  CustomerDetailsUpdate,
  CustomerStatus,
} from './types';

/**
 * Customer accounts as other modules use them (design §5): reading a customer, locking one (the
 * booking lock order, §7.1), blocking and unblocking (U15's admin route), sending a password
 * reset link (forgot password here, the admin's "send a reset email" in U15), and for the admin
 * Customers screen (U15) the list, an edit of the account and the anonymisation of the row.
 *
 * Every method joins the open transaction, so the change, its revocations, its audit event and
 * its email commit or roll back together.
 */
@Injectable()
export class CustomerService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly sessions: SessionService,
    private readonly oneTimeTokens: OneTimeTokenService,
    private readonly messaging: MessagingService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Live or anonymised (`deletedAt` set, no personal fields); null when there is no such id. */
  async findById(id: number): Promise<Customer | null> {
    const row = await this.customers.findById(id);
    return row ? toCustomer(row) : null;
  }

  /**
   * The customer, locked (`FOR NO KEY UPDATE`) until the open transaction ends; null when there is
   * no such id. Call it inside a transaction.
   */
  async findByIdForUpdate(id: number): Promise<Customer | null> {
    const row = await this.customers.findByIdForUpdate(id);
    return row ? toCustomer(row) : null;
  }

  /**
   * Blocks or unblocks a customer (PRD Accounts 5).
   *
   * - Missing or anonymised: `NOT_FOUND`. The same status again changes nothing.
   * - Blocking revokes every session (`account_blocked`) in the same transaction, so the customer
   *   is signed out everywhere on their next request; a sign-in in flight waits for the row lock
   *   and is then refused.
   * - Audited as `customer.status_changed`, with the new status and no personal data.
   */
  async setStatus(actor: AuditActor, id: number, status: CustomerStatus): Promise<Customer> {
    return this.transactions.run(async () => {
      const row = await this.customers.findByIdForUpdate(id);
      if (!row || row.deleted_at !== null) throw new AppError('NOT_FOUND');
      if (row.status === status) return toCustomer(row);

      const updated = await this.customers.setStatus(id, status, this.clock.now());
      if (status === 'blocked') {
        await this.sessions.revokeAllFor({ audience: 'customer', id }, 'account_blocked');
      }
      await this.audit.record({
        actor,
        action: 'customer.status_changed',
        entity: { type: 'customer', id },
        changedFields: ['status'],
        metadata: { status },
      });
      return toCustomer(updated);
    });
  }

  /**
   * `GET /admin/customers` (U15): live customers, newest account first, cursor-paginated, with
   * `total` under the same filters. Anonymised customers are never listed.
   */
  async list(filter: AdminCustomerFilter, query: PageQueryInput): Promise<Page<Customer>> {
    const request = toPageRequest(query, 'instant');
    if (request.after !== null && request.after.sortKey === null) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
      });
    }
    // One after the other: inside a transaction they would share one connection.
    const rows = await this.customers.pageForAdmin(filter, request);
    const total = await this.customers.countForAdmin(filter);
    return toPage(
      rows,
      request,
      total,
      (row) => ({ sortKey: row.created_at.toISOString(), id: row.id }),
      toCustomer,
    );
  }

  /**
   * U19 (the customers CSV): up to `request.limit + 1` live customers after `request.after`, in
   * `list()`'s order and under its filters, with no total: one page query of the list, for a
   * caller that reads the whole list in batches (`keysetBatches()`).
   */
  async rowsForAdmin(filter: AdminCustomerFilter, request: PageRequest): Promise<Customer[]> {
    const rows = await this.customers.pageForAdmin(filter, request);
    return rows.map(toCustomer);
  }

  /**
   * An admin edit of the account (PRD A7 "edit details"): the fields sent and different from the
   * stored ones change; nothing else is written, and nothing at all when nothing differs.
   *
   * - Missing or anonymised: `NOT_FOUND`.
   * - A new address (not only a change of letter case) must be free among live accounts
   *   (`EMAIL_TAKEN`). It is unverified from now on, and the customer's unused one-time links are
   *   deleted: a verification link sent to the old address must not verify the new one, nor a
   *   reset link hand the account back to the old mailbox.
   * - Audited as `customer.updated` with the names of the changed fields, never their values.
   */
  async updateDetails(
    actor: AuditActor,
    id: number,
    changes: CustomerDetailsChanges,
  ): Promise<Customer> {
    return this.transactions.run(async () => {
      const row = await this.customers.findByIdForUpdate(id);
      if (!row || row.deleted_at !== null || row.email === null) throw new AppError('NOT_FOUND');

      const changedFields: string[] = [];
      let update: CustomerDetailsUpdate = { updated_at: this.clock.now() };
      if (changes.fullName !== undefined && changes.fullName !== row.full_name) {
        update = { ...update, full_name: changes.fullName };
        changedFields.push('fullName');
      }
      const newAddress =
        changes.email !== undefined && changes.email.toLowerCase() !== row.email.toLowerCase();
      if (changes.email !== undefined && changes.email !== row.email) {
        if (newAddress) {
          const holder = await this.customers.findLiveByEmail(changes.email);
          if (holder && holder.id !== row.id) throw new AppError('EMAIL_TAKEN');
          update = { ...update, email_verified_at: null };
        }
        update = { ...update, email: changes.email };
        changedFields.push('email');
      }
      if (changes.phone !== undefined && changes.phone !== row.phone) {
        update = { ...update, phone: changes.phone };
        changedFields.push('phone');
      }
      if (changedFields.length === 0) return toCustomer(row);

      const updated = await this.customers.updateDetails(id, update);
      if (newAddress) await this.oneTimeTokens.invalidateAllFor({ kind: 'customer', id });
      await this.audit.record({
        actor,
        action: 'customer.updated',
        entity: { type: 'customer', id },
        changedFields,
      });
      return toCustomer(updated);
    });
  }

  /**
   * Clears the row of a live customer (design §21): no email, name, phone or password hash, and
   * `deleted_at` set. Only the row: the caller has locked it (`findByIdForUpdate`) in the open
   * transaction and removes what points at it first (U15's `CustomerAnonymisationService`).
   */
  async anonymise(id: number): Promise<Customer> {
    return this.transactions.run(async () =>
      toCustomer(await this.customers.anonymise(id, this.clock.now())),
    );
  }

  /**
   * Issues a 1-hour password reset link and queues the email (design §10.5); an earlier unused
   * link stops working. Missing or anonymised: `NOT_FOUND`. It sends whatever the status: the
   * forgot-password route calls it only for active customers, and a blocked customer's link
   * answers `ACCOUNT_BLOCKED` when used.
   */
  async issuePasswordReset(customerId: number): Promise<void> {
    await this.transactions.run(async () => {
      const row = await this.customers.findById(customerId);
      if (!row || row.email === null || row.full_name === null) throw new AppError('NOT_FOUND');
      const issued = await this.oneTimeTokens.issue({
        purpose: 'customer_password_reset',
        owner: { kind: 'customer', id: row.id },
        lifetimeSeconds: ONE_TIME_TOKEN_LIFETIME_SECONDS.customer_password_reset,
      });
      await this.messaging.queue({
        template: customerPasswordResetTemplate,
        recipient: row.email,
        params: { fullName: row.full_name, token: issued.token },
        related: { customerId: row.id },
      });
    });
  }
}
