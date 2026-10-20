import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ResponseObject,
} from '@nestjs/swagger';
import {
  applyCrossCuttingDocs,
  mergeErrorCode,
} from '../../../../src/common/swagger/cross-cutting-docs';
import { errorResponseFor } from '../../../../src/common/swagger/error-responses';

function operation(markers: Record<string, string> = {}): OperationObject {
  return {
    responses: { '201': { description: 'Created' } },
    ...markers,
  };
}

function documentWith(paths: Record<string, Record<string, OperationObject>>): OpenAPIObject {
  return { openapi: '3.0.3', info: { title: 't', version: '1' }, paths };
}

const codesOf = (op: OperationObject, status: string): string[] =>
  Object.keys(
    (op.responses[status] as ResponseObject).content?.['application/json']?.examples ?? {},
  );

describe('applyCrossCuttingDocs', () => {
  it('publishes the security and the guard errors of each access level, then drops the markers', () => {
    const document = documentWith({
      '/a': { get: operation({ 'x-maqady-access': 'public' }) },
      '/b': { get: operation({ 'x-maqady-access': 'guest' }) },
      '/c': { get: operation({ 'x-maqady-access': 'admin' }) },
    });
    applyCrossCuttingDocs(document);
    const [publicOp, guestOp, adminOp] = ['/a', '/b', '/c'].map(
      (path) => document.paths[path]!.get!,
    );

    expect(publicOp!.security).toEqual([]);
    expect(publicOp!.responses).not.toHaveProperty('401');
    expect(guestOp!.security).toEqual([{}, { customer: [] }]);
    expect(codesOf(guestOp!, '401')).toEqual(['UNAUTHENTICATED', 'SESSION_REVOKED']);
    expect(codesOf(guestOp!, '403')).toEqual(['ACCOUNT_BLOCKED']);
    expect(adminOp!.security).toEqual([{ staff: [] }]);
    expect(codesOf(adminOp!, '403')).toEqual(['ACCOUNT_DEACTIVATED', 'FORBIDDEN']);
    expect(JSON.stringify(document)).not.toContain('x-maqady');
  });

  it('documents 429 RATE_LIMITED on every operation, and orders responses by status', () => {
    const document = documentWith({ '/a': { get: operation({ 'x-maqady-access': 'customer' }) } });
    applyCrossCuttingDocs(document);
    const op = document.paths['/a']!.get!;
    expect(codesOf(op, '429')).toEqual(['RATE_LIMITED']);
    expect(Object.keys(op.responses)).toEqual(['201', '401', '403', '429']);
  });

  it('documents an optional Idempotency-Key on writes, required on strict ones, absent when ignored', () => {
    const document = documentWith({
      '/a': {
        post: operation({ 'x-maqady-access': 'public' }),
        put: operation({ 'x-maqady-access': 'public', 'x-maqady-idempotency': 'required' }),
        patch: operation({ 'x-maqady-access': 'public', 'x-maqady-idempotency': 'ignored' }),
        get: operation({ 'x-maqady-access': 'public' }),
      },
    });
    applyCrossCuttingDocs(document);
    const { post, put, patch, get } = document.paths['/a']!;
    const keyOf = (op: OperationObject) =>
      (op.parameters as ParameterObject[] | undefined)?.find((p) => p.name === 'Idempotency-Key');

    expect(keyOf(post!)).toMatchObject({ in: 'header', required: false });
    expect(codesOf(post!, '400')).toEqual(['VALIDATION_FAILED']);
    expect(codesOf(post!, '422')).toEqual(['IDEMPOTENCY_KEY_REUSED']);
    expect((post!.responses['201'] as ResponseObject).headers).toHaveProperty(
      'Idempotent-Replayed',
    );

    expect(keyOf(put!)).toMatchObject({ required: true });
    expect(codesOf(put!, '400')).toEqual(['VALIDATION_FAILED', 'IDEMPOTENCY_KEY_REQUIRED']);

    expect(keyOf(patch!)).toBeUndefined();
    expect(patch!.responses).not.toHaveProperty('422');
    expect(keyOf(get!)).toBeUndefined();
  });
});

describe('mergeErrorCode', () => {
  it('adds a code to a status the route already documents, once, without overwriting it', () => {
    const { status: _status, ...declared } = errorResponseFor(409, ['SEAT_TAKEN']);
    const op = { responses: { '409': declared as ResponseObject } } as OperationObject;
    mergeErrorCode(op, 'CONFLICT');
    mergeErrorCode(op, 'CONFLICT');
    expect(codesOf(op, '409')).toEqual(['SEAT_TAKEN', 'CONFLICT']);
    expect((op.responses['409'] as ResponseObject).description).toContain('`CONFLICT`');
  });
});
