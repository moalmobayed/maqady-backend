import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrincipalResolverRegistry } from '../../common/auth/principal-resolver.registry';
import type {
  PrincipalResolver,
  StaffPrincipal,
  VerifiedAccessToken,
} from '../../common/auth/types';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { StaffRepository } from './staff.repository';

/**
 * The staff audience's per-request check (design §10.3), registered with U1's
 * `PrincipalResolverRegistry`. One indexed query reads the `sid` session and its member:
 *
 * - no such staff session, or one of another member: null (`UNAUTHENTICATED`);
 * - a member who is not active: `ACCOUNT_DEACTIVATED`;
 * - a revoked session (sign-out, demotion, reuse): `SESSION_REVOKED`;
 * - a session past its 12 hours: `SESSION_EXPIRED`.
 *
 * The role comes from the database, never the token, so a demotion applies on the next request.
 */
@Injectable()
export class StaffPrincipalResolver implements PrincipalResolver, OnModuleInit {
  constructor(
    private readonly registry: PrincipalResolverRegistry,
    private readonly staff: StaffRepository,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.registry.register('staff', this);
  }

  async resolve(token: VerifiedAccessToken): Promise<StaffPrincipal | null> {
    const row = await this.staff.findPrincipalBySession(token.sessionId);
    if (!row || row.staff_user_id !== token.subjectId) return null;
    if (row.status !== 'active') throw new AppError('ACCOUNT_DEACTIVATED');
    if (row.revoked_at !== null) throw new AppError('SESSION_REVOKED');
    if (row.expires_at.getTime() <= this.clock.now().getTime()) {
      throw new AppError('SESSION_EXPIRED');
    }
    return { kind: 'staff', id: row.staff_user_id, sessionId: token.sessionId, role: row.role };
  }
}
