import { decode, sign } from 'jsonwebtoken';
import { AccessTokenService } from '../../../../src/common/auth/access-token.service';
import type { AppConfig } from '../../../../src/common/config/types';
import { TestClock } from '../../../support/clock';

const CUSTOMER_SECRET = Buffer.alloc(32, 0x11);
const STAFF_SECRET = Buffer.alloc(32, 0x22);
const config = {
  auth: {
    customerTokenSecret: CUSTOMER_SECRET.toString('base64'),
    staffTokenSecret: STAFF_SECRET.toString('base64url'),
  },
} as AppConfig;

describe('AccessTokenService', () => {
  const clock = new TestClock(new Date('2026-10-16T12:00:00Z'));
  const tokens = new AccessTokenService(config, clock);

  beforeEach(() => clock.set(new Date('2026-10-16T12:00:00Z')));

  it('signs HS256 tokens with sub, aud, sid and a 15-minute lifetime from the Clock', () => {
    const token = tokens.sign({ audience: 'staff', subjectId: 3, sessionId: 30 });
    const decoded = decode(token, { complete: true });
    expect(decoded?.header).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    const issuedAt = Date.parse('2026-10-16T12:00:00Z') / 1000;
    expect(decoded?.payload).toEqual({
      sub: '3',
      aud: 'staff',
      sid: '30',
      iat: issuedAt,
      exp: issuedAt + 900,
    });
  });

  it('verifies a token for its own audience', () => {
    const token = tokens.sign({ audience: 'customer', subjectId: 7, sessionId: 70 });
    expect(tokens.verify(token, 'customer')).toEqual({
      audience: 'customer',
      subjectId: 7,
      sessionId: 70,
    });
  });

  it('refuses a token for the other audience', () => {
    const staff = tokens.sign({ audience: 'staff', subjectId: 7, sessionId: 70 });
    expect(() => tokens.verify(staff, 'customer')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
    const customer = tokens.sign({ audience: 'customer', subjectId: 7, sessionId: 70 });
    expect(() => tokens.verify(customer, 'staff')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });

  it('refuses a token once it expires by the Clock', () => {
    const token = tokens.sign({ audience: 'customer', subjectId: 7, sessionId: 70 });
    clock.advance({ minutes: 14, seconds: 59 });
    expect(tokens.verify(token, 'customer').subjectId).toBe(7);
    clock.advance({ seconds: 1 });
    expect(() => tokens.verify(token, 'customer')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });

  it.each([
    [
      'another algorithm',
      () =>
        sign({ sub: '7', aud: 'customer', sid: '1' }, CUSTOMER_SECRET, {
          algorithm: 'HS512',
          expiresIn: 60,
        }),
    ],
    [
      'the none algorithm',
      () =>
        sign({ sub: '7', aud: 'customer', sid: '1' }, '', {
          algorithm: 'none',
          expiresIn: 60,
        } as never),
    ],
    [
      'a missing sid',
      () =>
        sign({ sub: '7', aud: 'customer' }, CUSTOMER_SECRET, { algorithm: 'HS256', expiresIn: 60 }),
    ],
    [
      'a numeric sub',
      () =>
        sign({ sub: 7, aud: 'customer', sid: '1' }, CUSTOMER_SECRET, {
          algorithm: 'HS256',
          expiresIn: 60,
        }),
    ],
    [
      'a zero sid',
      () =>
        sign({ sub: '7', aud: 'customer', sid: '0' }, CUSTOMER_SECRET, {
          algorithm: 'HS256',
          expiresIn: 60,
        }),
    ],
    [
      'no expiry',
      () => sign({ sub: '7', aud: 'customer', sid: '1' }, CUSTOMER_SECRET, { algorithm: 'HS256' }),
    ],
    ['garbage', () => 'a.b.c'],
  ])('refuses a token with %s', (_case, make) => {
    clock.set(new Date());
    expect(() => tokens.verify(make(), 'customer')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });
});
