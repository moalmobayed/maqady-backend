import type { Request } from 'express';
import {
  canonicalJson,
  hashedPartsOf,
  hashRequest,
} from '../../../../src/common/idempotency/request-hash';

const base = {
  method: 'POST',
  route: '/api/v1/showtimes/:id/holds',
  params: { id: '12' },
  body: { seats: ['C4', 'C5'], contact: { name: 'Mona', phone: '010' } },
};

describe('canonicalJson', () => {
  it('sorts object keys at every level and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,1]},"b":1}',
    );
  });

  it('drops undefined properties, as JSON does, and writes a missing value as null', () => {
    expect(canonicalJson({ a: undefined, b: 'x' })).toBe('{"b":"x"}');
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('hashRequest', () => {
  it('is SHA-256 hex, the same for the same request with keys in another order', () => {
    const reordered = {
      ...base,
      body: { contact: { phone: '010', name: 'Mona' }, seats: ['C4', 'C5'] },
    };
    expect(hashRequest(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRequest(reordered)).toBe(hashRequest(base));
  });

  it.each([
    ['method', { method: 'PUT' }],
    ['route template', { route: '/api/v1/holds/:id' }],
    ['path parameter', { params: { id: '13' } }],
    ['body', { body: { seats: ['C5', 'C4'], contact: { name: 'Mona', phone: '010' } } }],
    ['missing body', { body: undefined }],
  ])('changes with the %s', (_part, change) => {
    expect(hashRequest({ ...base, ...change })).not.toBe(hashRequest(base));
  });

  it('reads the route template, the path parameters and the raw body of an Express request', () => {
    const request = {
      method: 'POST',
      path: '/api/v1/showtimes/12/holds',
      route: { path: '/showtimes/:id/holds' },
      baseUrl: '/api/v1',
      params: { id: '12' },
      body: base.body,
    } as unknown as Request;
    expect(hashedPartsOf(request)).toEqual(base);
  });
});
