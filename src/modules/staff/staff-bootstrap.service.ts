import { Injectable } from '@nestjs/common';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { StaffRepository } from './staff.repository';
import { StaffService } from './staff.service';
import type { BootstrapAdminInput, BootstrapAdminResult } from './types';

/**
 * `npm run admin:create` (design §10.1): creates the first admin, once. Concurrent runs queue on
 * an advisory lock, and a run that finds an active admin changes nothing, so the command is safe
 * to repeat.
 */
@Injectable()
export class StaffBootstrapService {
  constructor(
    private readonly staff: StaffRepository,
    private readonly staffService: StaffService,
    private readonly transactions: TransactionRepository,
  ) {}

  async ensureFirstAdmin(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
    return this.transactions.run(async () => {
      await this.staff.takeAdminCreateLock();
      if (await this.staff.anyActiveAdminExists()) return { created: false };
      const admin = await this.staffService.createActiveMember({ ...input, role: 'admin' });
      return { created: true, id: admin.id };
    });
  }
}
