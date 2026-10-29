import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor } from '../../common/audit/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import type { Page, PageQueryInput } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { AdminBookingsService } from '../bookings/admin-bookings.service';
import { CustomerBookingsService } from '../bookings/customer-bookings.service';
import { SettlementService } from '../bookings/settlement.service';
import { CustomerService } from '../customers/customer.service';
import type { AdminCustomerFilter, Customer } from '../customers/types';
import { PASSWORD_RESET_SENT_ACTION, RECENT_BOOKINGS_LIMIT } from './admin-customers.constants';
import type {
  AdminCustomerChanges,
  AdminCustomerDetail,
  AdminCustomerListItem,
  CustomerPasswordResetResult,
} from './types';

/**
 * The admin Customers screen (PRD A7; design §11): the list with search and the status filter,
 * a customer's drawer with their numbers and newest bookings (both staff roles), and for admins
 * the edit, block and unblock, and the password reset email. Anonymisation is
 * `CustomerAnonymisationService`.
 *
 * Reads settle due slow payments first (`settleAllDue()`, as the bookings screen does), so a
 * booking whose payment just completed counts; a page's numbers are one query (no N+1).
 */
@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly customers: CustomerService,
    private readonly customerBookings: CustomerBookingsService,
    private readonly adminBookings: AdminBookingsService,
    private readonly settlement: SettlementService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** `GET /admin/customers`: live customers newest first, each with their booking numbers. */
  async list(
    filter: AdminCustomerFilter,
    query: PageQueryInput,
  ): Promise<Page<AdminCustomerListItem>> {
    await this.settlement.settleAllDue();
    const page = await this.customers.list(filter, query);
    return { ...page, items: await this.withStats(page.items) };
  }

  /**
   * `GET /admin/customers/{id}`: the customer, their numbers and their newest bookings in any
   * status (U14's admin list, which settles first). Unknown or anonymised: `NOT_FOUND`.
   */
  async detail(id: number): Promise<AdminCustomerDetail> {
    const customer = await this.liveCustomer(id);
    const recent = await this.adminBookings.list(
      { customerId: id },
      { limit: RECENT_BOOKINGS_LIMIT },
    );
    const [item] = await this.withStats([customer]);
    return { ...item!, recentBookings: recent.items };
  }

  /**
   * `PATCH /admin/customers/{id}` (Admin): the account details, then the status, in one
   * transaction, so a refusal of either changes nothing. Blocking revokes every session at once;
   * unblocking lets the customer sign in again (U9's `setStatus()`). Answers the customer with
   * their numbers, read in the same transaction.
   */
  async update(
    actor: AuditActor,
    id: number,
    changes: AdminCustomerChanges,
  ): Promise<AdminCustomerListItem> {
    return this.transactions.run(async () => {
      let customer = await this.liveCustomer(id);
      const { status, ...details } = changes;
      if (Object.keys(details).length > 0) {
        customer = await this.customers.updateDetails(actor, id, details);
      }
      if (status !== undefined) customer = await this.customers.setStatus(actor, id, status);
      const [item] = await this.withStats([customer]);
      return item!;
    });
  }

  /**
   * `POST /admin/customers/{id}/password-reset-requests` (Admin; PRD "admin sends a reset"): a new
   * 1-hour reset link emailed to the customer (the stored copy hides it), the previous one void.
   *
   * - Unknown or anonymised: `NOT_FOUND`.
   * - Blocked: `CUSTOMER_BLOCKED`, nothing sent; the link would be refused when used.
   * - The customer row is locked first, so a block in flight is waited for.
   * - Audited as `customer.password_reset_sent`.
   */
  async sendPasswordReset(actor: AuditActor, id: number): Promise<CustomerPasswordResetResult> {
    return this.transactions.run(async () => {
      const customer = await this.customers.findByIdForUpdate(id);
      if (!customer || customer.deletedAt !== null) throw new AppError('NOT_FOUND');
      if (customer.status === 'blocked') throw new AppError('CUSTOMER_BLOCKED');
      await this.customers.issuePasswordReset(id);
      await this.audit.record({
        actor,
        action: PASSWORD_RESET_SENT_ACTION,
        entity: { type: 'customer', id },
      });
      return { channel: 'email', queuedAt: this.clock.now() };
    });
  }

  private async liveCustomer(id: number): Promise<Customer> {
    const customer = await this.customers.findById(id);
    if (!customer || customer.deletedAt !== null) throw new AppError('NOT_FOUND');
    return customer;
  }

  private async withStats(customers: readonly Customer[]): Promise<AdminCustomerListItem[]> {
    const stats = await this.customerBookings.statsOf(
      customers.map((customer) => customer.id),
      this.clock.now(),
    );
    return customers.map((customer) => ({ customer, stats: stats.get(customer.id)! }));
  }
}
