import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrincipalResolverRegistry } from '../../common/auth/principal-resolver.registry';
import type {
  CustomerPrincipal,
  PrincipalResolver,
  VerifiedAccessToken,
} from '../../common/auth/types';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { CustomersRepository } from './customers.repository';

/**
 * The customer audience's per-request check (design §10.3), registered with U1's
 * `PrincipalResolverRegistry`. One query by primary key reads the `sid` session and its customer:
 *
 * - no such customer session, one of another customer, or an anonymised customer: null
 *   (`UNAUTHENTICATED`);
 * - a blocked customer: `ACCOUNT_BLOCKED`, before the session checks, so the PRD's "Account
 *   blocked" screen shows rather than a plain sign-out (blocking also revoked the sessions);
 * - a revoked session (sign-out, password change, reuse): `SESSION_REVOKED`;
 * - a session past its 30 days: `SESSION_EXPIRED`.
 */
@Injectable()
export class CustomerPrincipalResolver implements PrincipalResolver, OnModuleInit {
  constructor(
    private readonly registry: PrincipalResolverRegistry,
    private readonly customers: CustomersRepository,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.registry.register('customer', this);
  }

  async resolve(token: VerifiedAccessToken): Promise<CustomerPrincipal | null> {
    const row = await this.customers.findPrincipalBySession(token.sessionId);
    if (!row || row.customer_id !== token.subjectId || row.deleted_at !== null) return null;
    if (row.status !== 'active') throw new AppError('ACCOUNT_BLOCKED');
    if (row.revoked_at !== null) throw new AppError('SESSION_REVOKED');
    if (row.expires_at.getTime() <= this.clock.now().getTime()) {
      throw new AppError('SESSION_EXPIRED');
    }
    return { kind: 'customer', id: row.customer_id, sessionId: token.sessionId };
  }
}
