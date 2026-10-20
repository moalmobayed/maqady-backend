import { Injectable } from '@nestjs/common';
import type { CustomerPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { toCustomer } from './customer.mapper';
import { CURRENT_PASSWORD_WRONG_MESSAGE } from './customers.constants';
import { CustomersRepository } from './customers.repository';
import type { ChangePasswordInput, Customer, CustomerRow, ProfileChanges } from './types';

/**
 * The signed-in customer's own account (PRD C12 Profile): reading it, editing the name and phone,
 * and changing the password. The email is read-only. Writes join the request transaction.
 */
@Injectable()
export class CustomerProfileService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly transactions: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  async get(principal: CustomerPrincipal): Promise<Customer> {
    return toCustomer(liveOrUnauthenticated(await this.customers.findById(principal.id)));
  }

  /**
   * Changes the fields sent: `fullName`, and `phone` (`null` clears it). Fields equal to the
   * stored ones are left alone, and a change to nothing writes nothing.
   */
  async update(principal: CustomerPrincipal, changes: ProfileChanges): Promise<Customer> {
    return this.transactions.run(async () => {
      const row = liveOrUnauthenticated(await this.customers.findByIdForUpdate(principal.id));
      const fullName =
        changes.fullName !== undefined && changes.fullName !== row.full_name
          ? { full_name: changes.fullName }
          : {};
      const phone =
        changes.phone !== undefined && changes.phone !== row.phone ? { phone: changes.phone } : {};
      if (Object.keys(fullName).length + Object.keys(phone).length === 0) return toCustomer(row);
      const updated = await this.customers.updateProfile(row.id, {
        ...fullName,
        ...phone,
        updated_at: this.clock.now(),
      });
      return toCustomer(updated);
    });
  }

  /**
   * Changes the password after checking the current one. A wrong current password is
   * `VALIDATION_FAILED` on `currentPassword` (a 401 would read as "signed out"), and nothing
   * changes. Success signs out every other device (`password_changed`) and keeps this one.
   */
  async changePassword(principal: CustomerPrincipal, input: ChangePasswordInput): Promise<void> {
    const newHash = await this.passwords.hash(input.newPassword);
    await this.transactions.run(async () => {
      const row = liveOrUnauthenticated(await this.customers.findByIdForUpdate(principal.id));
      if (!(await this.passwords.verify(input.currentPassword, row.password_hash))) {
        throw new AppError('VALIDATION_FAILED', undefined, {
          fields: [{ field: 'currentPassword', messages: [CURRENT_PASSWORD_WRONG_MESSAGE] }],
        });
      }
      await this.customers.setPasswordHash(row.id, newHash, this.clock.now());
      await this.sessions.revokeAllFor({ audience: 'customer', id: row.id }, 'password_changed', {
        exceptSessionId: principal.sessionId,
      });
    });
  }
}

/** The guard already refused a gone or anonymised customer; this covers a race with U15. */
function liveOrUnauthenticated(row: CustomerRow | undefined): CustomerRow {
  if (!row || row.deleted_at !== null) throw new AppError('UNAUTHENTICATED');
  return row;
}
