import { Reflector } from '@nestjs/core';
import { AccessGuard } from '../../../../src/common/auth/access.guard';
import {
  Admin,
  Customer,
  Guest,
  Public,
  Staff,
} from '../../../../src/common/auth/access.decorators';
import type { Principal } from '../../../../src/common/auth/types';
import { fakeContext } from '../../../support/execution-context';

@Staff()
class StaffRoutes {
  list(): void {}
}

class Routes {
  @Public() open(): void {}
  @Guest() guest(): void {}
  @Customer() customer(): void {}
  @Staff() staff(): void {}
  @Admin() admin(): void {}
  undeclared(): void {}
}

const CUSTOMER: Principal = { kind: 'customer', id: 1, sessionId: 1 };
const ADMIN: Principal = { kind: 'staff', id: 2, sessionId: 2, role: 'admin' };
const BOX_OFFICE: Principal = { kind: 'staff', id: 3, sessionId: 3, role: 'box_office' };

describe('AccessGuard', () => {
  const guard = new AccessGuard(new Reflector());
  const outcome = (route: keyof Routes, principal?: Principal): string => {
    try {
      guard.canActivate(
        fakeContext({
          request: { principal },
          handler: Routes.prototype[route],
          controller: Routes,
        }),
      );
      return 'allowed';
    } catch (error) {
      return (error as { code: string }).code;
    }
  };

  it.each<[keyof Routes, Principal | undefined, string]>([
    ['open', undefined, 'allowed'],
    ['open', BOX_OFFICE, 'allowed'],
    ['guest', undefined, 'allowed'],
    ['guest', CUSTOMER, 'allowed'],
    ['guest', ADMIN, 'UNAUTHENTICATED'],
    ['customer', undefined, 'UNAUTHENTICATED'],
    ['customer', CUSTOMER, 'allowed'],
    ['customer', ADMIN, 'UNAUTHENTICATED'],
    ['staff', undefined, 'UNAUTHENTICATED'],
    ['staff', CUSTOMER, 'UNAUTHENTICATED'],
    ['staff', ADMIN, 'allowed'],
    ['staff', BOX_OFFICE, 'allowed'],
    ['admin', undefined, 'UNAUTHENTICATED'],
    ['admin', CUSTOMER, 'UNAUTHENTICATED'],
    ['admin', BOX_OFFICE, 'FORBIDDEN'],
    ['admin', ADMIN, 'allowed'],
    ['undeclared', ADMIN, 'FORBIDDEN'],
  ])('%s with %p: %s', (route, principal, expected) => {
    expect(outcome(route, principal)).toBe(expected);
  });

  it('reads a declaration made on the controller', () => {
    const context = fakeContext({
      request: { principal: BOX_OFFICE },
      handler: StaffRoutes.prototype.list,
      controller: StaffRoutes,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('passes non-HTTP contexts through', () => {
    expect(guard.canActivate(fakeContext({ type: 'ws' }))).toBe(true);
  });
});
