import type { AdminBookingListItem, CustomerBookingStats } from '../bookings/types';
import type { Customer, CustomerStatus } from '../customers/types';

/** A customer as the admin Customers list shows them: the account and their booking numbers. */
export interface AdminCustomerListItem {
  readonly customer: Customer;
  readonly stats: CustomerBookingStats;
}

/** The Customers drawer (PRD A7): the list item plus the customer's newest bookings. */
export interface AdminCustomerDetail extends AdminCustomerListItem {
  readonly recentBookings: readonly AdminBookingListItem[];
}

/** What `PATCH /admin/customers/{id}` asks to change; `phone: null` clears it. */
export interface AdminCustomerChanges {
  readonly fullName?: string;
  readonly email?: string;
  readonly phone?: string | null;
  readonly status?: CustomerStatus;
}

/** What anonymising a customer removed, counted (design §21). */
export interface AnonymisationRemovals {
  readonly sessions: number;
  readonly oneTimeTokens: number;
  readonly idempotencyKeys: number;
  readonly messages: number;
  readonly bookingNotes: number;
  /** Bookings whose contact name, email or phone was cleared. */
  readonly bookingContacts: number;
}

/** `DELETE /admin/customers/{id}`: what was kept and what was removed. */
export interface CustomerAnonymisationResult {
  readonly customerId: number;
  readonly anonymisedAt: Date;
  /** Every booking of the customer, kept for accounting without their contact. */
  readonly bookingsKept: number;
  readonly removed: AnonymisationRemovals;
}

/** `POST /admin/customers/{id}/password-reset-requests`: the reset email was queued. */
export interface CustomerPasswordResetResult {
  readonly channel: 'email';
  readonly queuedAt: Date;
}
