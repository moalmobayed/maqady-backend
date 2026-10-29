import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditActor } from '../../common/audit/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ownerScope } from '../../common/idempotency/write.interceptor';
import { OneTimeTokenService } from '../auth/one-time-token.service';
import { SessionService } from '../auth/session.service';
import { BookingNotesService } from '../bookings/booking-notes.service';
import { CustomerBookingsService } from '../bookings/customer-bookings.service';
import { CustomerService } from '../customers/customer.service';
import { MessagingService } from '../messaging/messaging.service';
import { ANONYMISED_ACTION, ANONYMISED_FIELDS } from './admin-customers.constants';
import type { CustomerAnonymisationResult } from './types';

/**
 * "Delete account" (PRD Accounts 6, A7), exactly as design §21 defines it, in one transaction
 * (the request's): the customer
 *
 * - loses their name, email, phone and password hash, and gets `deleted_at`;
 * - loses the contact copied onto their bookings;
 * - loses their sessions, one-time tokens, idempotency rows and messages, and the internal notes
 *   on their bookings;
 * - keeps the bookings and payments themselves, for accounting.
 *
 * Each table is changed by the module that owns it. The customer row is locked first
 * (`FOR NO KEY UPDATE`, design §7.1 step 4), then their bookings in id order (step 5), so a
 * sign-in, refresh, hold or payment racing the deletion waits and is then refused.
 */
@Injectable()
export class CustomerAnonymisationService {
  constructor(
    private readonly customers: CustomerService,
    private readonly customerBookings: CustomerBookingsService,
    private readonly notes: BookingNotesService,
    private readonly sessions: SessionService,
    private readonly oneTimeTokens: OneTimeTokenService,
    private readonly idempotency: IdempotencyService,
    private readonly messaging: MessagingService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Anonymises the customer. Unknown or already anonymised: `NOT_FOUND`, and nothing changes.
   * Audited as `customer.anonymised` with the names of the cleared fields and the counts, never
   * a value.
   */
  async anonymise(actor: AuditActor, id: number): Promise<CustomerAnonymisationResult> {
    return this.transactions.run(async () => {
      const customer = await this.customers.findByIdForUpdate(id);
      if (!customer || customer.deletedAt !== null) throw new AppError('NOT_FOUND');

      const contacts = await this.customerBookings.clearContactsOf(id);
      const bookingNotes = await this.notes.deleteForCustomer(id);
      const sessions = await this.sessions.deleteAllFor({ audience: 'customer', id });
      const oneTimeTokens = await this.oneTimeTokens.deleteAllFor({ kind: 'customer', id });
      const idempotencyKeys = await this.idempotency.deleteForScope(ownerScope('customer', id));
      const messages = await this.messaging.deleteForCustomer(id);
      const anonymised = await this.customers.anonymise(id);

      const removed = {
        sessions,
        oneTimeTokens,
        idempotencyKeys,
        messages,
        bookingNotes,
        bookingContacts: contacts.cleared,
      };
      await this.audit.record({
        actor,
        action: ANONYMISED_ACTION,
        entity: { type: 'customer', id },
        changedFields: ANONYMISED_FIELDS,
        metadata: { bookingsKept: contacts.bookings, ...removed },
      });
      return {
        customerId: id,
        anonymisedAt: anonymised.deletedAt!,
        bookingsKept: contacts.bookings,
        removed,
      };
    });
  }
}
