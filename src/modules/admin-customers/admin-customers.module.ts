import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { CredentialsModule } from '../auth/credentials.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CustomersModule } from '../customers/customers.module';
import { AdminCustomerResponseMapper } from './admin-customer-response.mapper';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomersService } from './admin-customers.service';
import { CustomerAnonymisationService } from './customer-anonymisation.service';

/**
 * The admin Customers screen (U15, `docs/gh-16-admin-customers/spec.md`; PRD A7): the list with
 * search and the status filter, a customer's drawer with their booking numbers and newest
 * bookings, the edit, block and unblock, the password reset email, and anonymisation (design §21).
 *
 * It owns no table: it sits on top of `customers` (the account), `bookings` (the numbers, the
 * booking contacts and notes), `auth` (sessions and one-time tokens), `idempotency` and the global
 * `messaging`, and changes each table through the module that owns it. `bookings` imports
 * `customers`, so these routes cannot live there.
 *
 * Exported for the customers CSV (U19) and search (U18): `AdminCustomersService`,
 * `CustomerAnonymisationService` and `AdminCustomerResponseMapper` (the CSV's rows are the list's).
 */
@Module({
  imports: [CustomersModule, BookingsModule, CredentialsModule, IdempotencyModule],
  controllers: [AdminCustomersController],
  providers: [AdminCustomersService, CustomerAnonymisationService, AdminCustomerResponseMapper],
  exports: [AdminCustomersService, CustomerAnonymisationService, AdminCustomerResponseMapper],
})
export class AdminCustomersModule {}
