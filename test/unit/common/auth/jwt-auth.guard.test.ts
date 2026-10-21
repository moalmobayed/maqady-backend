import { Reflector } from '@nestjs/core';
import {
  Admin,
  Customer,
  Guest,
  Public,
  Staff,
} from '../../../../src/common/auth/access.decorators';
import type { AccessTokenService } from '../../../../src/common/auth/access-token.service';
import { JwtAuthGuard } from '../../../../src/common/auth/jwt-auth.guard';
import { PrincipalResolverRegistry } from '../../../../src/common/auth/principal-resolver.registry';
import type { Principal, PrincipalResolver } from '../../../../src/common/auth/types';
import { AppError } from '../../../../src/common/errors/app-error';
import { fakeContext } from '../../../support/execution-context';

class Routes {
  @Public() open(): void {}
  @Guest() guest(): void {}
  @Customer() customer(): void {}
  @Staff() staff(): void {}
  @Admin() admin(): void {}
  undeclared(): void {}
}

const TOKEN = 'aaa.bbb.ccc';
const CUSTOMER: Principal = { kind: 'customer', id: 7, sessionId: 70 };

describe('JwtAuthGuard', () => {
  let tokens: jest.Mocked<AccessTokenService>;
  let resolver: jest.Mocked<PrincipalResolver>;
  let registry: PrincipalResolverRegistry;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    tokens = {
      verify: jest.fn((_token: string, audience: 'customer' | 'staff') => ({
        audience,
        subjectId: 7,
        sessionId: 70,
      })),
    } as unknown as jest.Mocked<AccessTokenService>;
    resolver = { resolve: jest.fn().mockResolvedValue(CUSTOMER) };
    registry = new PrincipalResolverRegistry();
    registry.register('customer', resolver);
    guard = new JwtAuthGuard(new Reflector(), tokens, registry);
  });

  const check = (route: keyof Routes, authorization?: string) => {
    const request: { headers: Record<string, string>; principal?: Principal } = {
      headers: authorization === undefined ? {} : { authorization },
    };
    const context = fakeContext({ request, handler: Routes.prototype[route], controller: Routes });
    return { result: guard.canActivate(context), request };
  };

  it('passes non-HTTP contexts through', async () => {
    await expect(guard.canActivate(fakeContext({ type: 'ws' }))).resolves.toBe(true);
  });

  it('ignores any token on public routes and on undeclared ones (AccessGuard refuses those)', async () => {
    await expect(check('open', 'Bearer broken').result).resolves.toBe(true);
    await expect(check('undeclared', 'Bearer broken').result).resolves.toBe(true);
    expect(tokens.verify).not.toHaveBeenCalled();
  });

  it('lets a guest without a token through, with no principal', async () => {
    const { result, request } = check('guest');
    await expect(result).resolves.toBe(true);
    expect(request.principal).toBeUndefined();
  });

  it('verifies the token for the audience the route implies and puts the principal on the request', async () => {
    const { result, request } = check('customer', `Bearer ${TOKEN}`);
    await expect(result).resolves.toBe(true);
    expect(tokens.verify).toHaveBeenCalledWith(TOKEN, 'customer');
    expect(resolver.resolve).toHaveBeenCalledWith({
      audience: 'customer',
      subjectId: 7,
      sessionId: 70,
    });
    expect(request.principal).toEqual(CUSTOMER);
  });

  it.each([undefined, '', 'Bearer', 'Basic abc', `bearer ${TOKEN}`, 'Bearer not-a-jwt'])(
    'answers UNAUTHENTICATED for the Authorization header %p',
    async (header) => {
      await expect(check('customer', header).result).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    },
  );

  it('answers UNAUTHENTICATED when the audience has no resolver', async () => {
    await expect(check('staff', `Bearer ${TOKEN}`).result).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(check('admin', `Bearer ${TOKEN}`).result).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it.each<[string, Principal | null]>([
    ['nothing', null],
    ['a principal of another subject', { kind: 'customer', id: 8, sessionId: 70 }],
    ['a principal of another session', { kind: 'customer', id: 7, sessionId: 71 }],
    ['a principal of another kind', { kind: 'staff', id: 7, sessionId: 70, role: 'admin' }],
  ])('answers UNAUTHENTICATED when the resolver returns %s', async (_case, principal) => {
    resolver.resolve.mockResolvedValue(principal);
    await expect(check('customer', `Bearer ${TOKEN}`).result).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it("passes the resolver's own error on", async () => {
    resolver.resolve.mockRejectedValue(new AppError('ACCOUNT_BLOCKED'));
    await expect(check('guest', `Bearer ${TOKEN}`).result).rejects.toMatchObject({
      code: 'ACCOUNT_BLOCKED',
    });
  });
});

describe('PrincipalResolverRegistry', () => {
  it('refuses a second resolver for the same audience', () => {
    const registry = new PrincipalResolverRegistry();
    const resolver = { resolve: () => Promise.resolve(null) };
    registry.register('staff', resolver);
    expect(registry.resolverFor('staff')).toBe(resolver);
    expect(registry.resolverFor('customer')).toBeUndefined();
    expect(() => registry.register('staff', resolver)).toThrow('already registered');
  });
});
