import { sign } from 'jsonwebtoken';
import { AccessTokenService } from '../../../../src/common/auth/access-token.service';
import type { TokenAudience } from '../../../../src/common/auth/types';
import { AppError } from '../../../../src/common/errors/app-error';
import { TestClock } from '../../../support/clock';
import {
  AccessProbeModule,
  REAL_RESOLVERS_OFF,
  TestPrincipalResolvers,
  TestPrincipalResolversModule,
} from '../../../support/foundations-probe.module';
import { createTestApp } from '../../../support/test-app';
import { TEST_CUSTOMER_TOKEN_SECRET } from '../../../support/test-config';
import type { TestApp } from '../../../support/types';

const route = (level: string): string => `/api/v1/test-access/${level}`;

const CUSTOMER = { kind: 'customer', id: 7, sessionId: 70 } as const;
const ADMIN = { kind: 'staff', id: 3, sessionId: 30, role: 'admin' } as const;
const BOX_OFFICE = { kind: 'staff', id: 4, sessionId: 40, role: 'box_office' } as const;

describe('Access guards (integration)', () => {
  let testApp: TestApp;
  let tokens: AccessTokenService;
  const clock = new TestClock();

  const tokenFor = (audience: TokenAudience, subjectId: number, sessionId: number): string =>
    tokens.sign({ audience, subjectId, sessionId });
  const customerToken = (): string => tokenFor('customer', CUSTOMER.id, CUSTOMER.sessionId);
  const adminToken = (): string => tokenFor('staff', ADMIN.id, ADMIN.sessionId);
  const boxOfficeToken = (): string => tokenFor('staff', BOX_OFFICE.id, BOX_OFFICE.sessionId);
  const get = (level: string, token?: string) => {
    const request = testApp.http().get(route(level));
    return token === undefined ? request : request.set('Authorization', `Bearer ${token}`);
  };

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      resetData: false,
      imports: [AccessProbeModule, TestPrincipalResolversModule],
      overrides: REAL_RESOLVERS_OFF,
    });
    tokens = testApp.app.get(AccessTokenService);
    const resolvers = testApp.app.get(TestPrincipalResolvers);
    resolvers.set('customer', CUSTOMER.sessionId, CUSTOMER);
    resolvers.set('staff', ADMIN.sessionId, ADMIN);
    resolvers.set('staff', BOX_OFFICE.sessionId, BOX_OFFICE);
    resolvers.set('customer', 71, null);
    resolvers.set('customer', 72, new AppError('ACCOUNT_BLOCKED'));
    resolvers.set('staff', 41, new AppError('ACCOUNT_DEACTIVATED'));
    resolvers.set('customer', 73, new AppError('SESSION_REVOKED'));
  });

  beforeEach(() => clock.set(new Date()));

  afterAll(async () => {
    await testApp.close();
  });

  const expectError = (
    response: { status: number; body: { error?: { code?: string } } },
    status: number,
    code: string,
  ): void => {
    expect(response.status).toBe(status);
    expect(response.body.error?.code).toBe(code);
  };

  describe('@Public()', () => {
    it('lets anyone in, and ignores any token, even a broken one', async () => {
      expect((await get('public')).body).toEqual({ principal: null });
      expect((await get('public', 'not.a.token')).body).toEqual({ principal: null });
      expect((await get('public', customerToken())).body).toEqual({ principal: null });
    });
  });

  describe('@Guest()', () => {
    it('lets a guest in without a token', async () => {
      const response = await get('guest');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ principal: null });
    });

    it('resolves a signed-in customer', async () => {
      expect((await get('guest', customerToken())).body).toEqual({ principal: CUSTOMER });
    });

    it('refuses an invalid or expired customer token instead of acting as a guest', async () => {
      expectError(await get('guest', 'abc'), 401, 'UNAUTHENTICATED');
      const token = customerToken();
      clock.advance({ minutes: 16 });
      expectError(await get('guest', token), 401, 'UNAUTHENTICATED');
    });

    it('refuses a staff token', async () => {
      expectError(await get('guest', adminToken()), 401, 'UNAUTHENTICATED');
    });
  });

  describe('@Customer()', () => {
    it('resolves the customer of a valid token', async () => {
      const response = await get('customer', customerToken());
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ principal: CUSTOMER });
    });

    it('answers UNAUTHENTICATED without a token, or with a malformed header', async () => {
      expectError(await get('customer'), 401, 'UNAUTHENTICATED');
      expectError(await get('customer', 'not-a-jwt'), 401, 'UNAUTHENTICATED');
      const basic = await testApp.http().get(route('customer')).set('Authorization', 'Basic abc');
      expectError(basic, 401, 'UNAUTHENTICATED');
    });

    it('accepts a token until it expires by the Clock, 15 minutes after issue', async () => {
      const token = customerToken();
      clock.advance({ minutes: 14, seconds: 59 });
      expect((await get('customer', token)).status).toBe(200);
      clock.advance({ seconds: 2 });
      expectError(await get('customer', token), 401, 'UNAUTHENTICATED');
    });

    it('answers UNAUTHENTICATED for a staff token (the wrong audience)', async () => {
      expectError(await get('customer', adminToken()), 401, 'UNAUTHENTICATED');
    });

    it('answers UNAUTHENTICATED for a token claiming aud=customer but signed with another secret', async () => {
      const forged = sign({ sub: '7', aud: 'customer', sid: '70' }, Buffer.alloc(32, 0x77), {
        algorithm: 'HS256',
        expiresIn: 900,
      });
      expectError(await get('customer', forged), 401, 'UNAUTHENTICATED');
    });

    it('answers UNAUTHENTICATED for a token signed with the customer secret for aud=staff', async () => {
      const wrongAudience = sign(
        { sub: '7', aud: 'staff', sid: '70' },
        Buffer.from(TEST_CUSTOMER_TOKEN_SECRET, 'base64'),
        { algorithm: 'HS256', expiresIn: 900 },
      );
      expectError(await get('customer', wrongAudience), 401, 'UNAUTHENTICATED');
    });

    it('answers UNAUTHENTICATED when the session no longer resolves to a principal', async () => {
      expectError(await get('customer', tokenFor('customer', 7, 71)), 401, 'UNAUTHENTICATED');
      expectError(await get('customer', tokenFor('customer', 7, 999)), 401, 'UNAUTHENTICATED');
    });

    it('answers UNAUTHENTICATED when the session belongs to another customer than sub', async () => {
      expectError(await get('customer', tokenFor('customer', 8, 70)), 401, 'UNAUTHENTICATED');
    });

    it("passes on the resolver's own refusal", async () => {
      expectError(await get('customer', tokenFor('customer', 7, 72)), 403, 'ACCOUNT_BLOCKED');
      expectError(await get('customer', tokenFor('customer', 7, 73)), 401, 'SESSION_REVOKED');
    });
  });

  describe('@Staff()', () => {
    it('lets either staff role in', async () => {
      expect((await get('staff', adminToken())).body).toEqual({ principal: ADMIN });
      expect((await get('staff', boxOfficeToken())).body).toEqual({ principal: BOX_OFFICE });
    });

    it('answers UNAUTHENTICATED for a customer token, and passes on a deactivation', async () => {
      expectError(await get('staff', customerToken()), 401, 'UNAUTHENTICATED');
      expectError(await get('staff', tokenFor('staff', 4, 41)), 403, 'ACCOUNT_DEACTIVATED');
    });
  });

  describe('@Admin()', () => {
    it('lets an admin in', async () => {
      expect((await get('admin', adminToken())).body).toEqual({ principal: ADMIN });
    });

    it('answers FORBIDDEN to box office staff', async () => {
      expectError(await get('admin', boxOfficeToken()), 403, 'FORBIDDEN');
    });

    it('answers UNAUTHENTICATED without a token, with a customer token, or an expired one', async () => {
      expectError(await get('admin'), 401, 'UNAUTHENTICATED');
      expectError(await get('admin', customerToken()), 401, 'UNAUTHENTICATED');
      const token = adminToken();
      clock.advance({ minutes: 15, seconds: 1 });
      expectError(await get('admin', token), 401, 'UNAUTHENTICATED');
    });
  });
});

describe('Access guards with no principal resolver registered (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({
      resetData: false,
      imports: [AccessProbeModule],
      overrides: REAL_RESOLVERS_OFF,
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('never makes a principal from a token alone: valid tokens answer UNAUTHENTICATED', async () => {
    const tokens = testApp.app.get(AccessTokenService);
    const customer = tokens.sign({ audience: 'customer', subjectId: 1, sessionId: 1 });
    const staff = tokens.sign({ audience: 'staff', subjectId: 1, sessionId: 1 });

    for (const [level, token] of [
      ['customer', customer],
      ['guest', customer],
      ['staff', staff],
      ['admin', staff],
    ] as const) {
      const response = await testApp
        .http()
        .get(route(level))
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect((await testApp.http().get(route('guest'))).status).toBe(200);
  });
});
