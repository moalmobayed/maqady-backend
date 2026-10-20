import type { CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import {
  NoIdempotencyStorage,
  NoRequestTransaction,
  Strict,
} from '../../../../src/common/idempotency/idempotency.decorators';
import type { IdempotencyService } from '../../../../src/common/idempotency/idempotency.service';
import { scopeOf, WriteInterceptor } from '../../../../src/common/idempotency/write.interceptor';
import { fakeContext } from '../../../support/execution-context';
import { postgresError } from '../../../support/errors';

class Routes {
  @Strict()
  strict(): void {}

  @NoIdempotencyStorage()
  auth(): void {}

  @Strict()
  @NoRequestTransaction()
  upload(): void {}

  plain(): void {}
}

const KEY = '5f0c8a8e-2f3b-4d8e-9a51-3c2b7d1e9f40';

function request(method: string, headers: Record<string, string> = {}) {
  return {
    method,
    headers,
    path: '/api/v1/things',
    params: {},
    body: { name: 'x' },
    principal: undefined,
  };
}

function response() {
  return {
    statusCode: 201,
    headers: {} as Record<string, string>,
    status: jest.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    setHeader: jest.fn(function (
      this: { headers: Record<string, string> },
      name: string,
      value: string,
    ) {
      this.headers[name] = value;
    }),
  };
}

describe('WriteInterceptor', () => {
  let transactions: jest.Mocked<TransactionRepository>;
  let idempotency: jest.Mocked<IdempotencyService>;
  let interceptor: WriteInterceptor;

  beforeEach(() => {
    transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as jest.Mocked<TransactionRepository>;
    idempotency = {
      claim: jest.fn().mockResolvedValue({ kind: 'claimed', id: 3 }),
      complete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IdempotencyService>;
    interceptor = new WriteInterceptor(new Reflector(), transactions, idempotency);
  });

  const handlerReturning = (value: unknown): CallHandler & { handle: jest.Mock } => ({
    handle: jest.fn(() => of(value)),
  });
  const run = (
    route: keyof Routes,
    req: ReturnType<typeof request>,
    next: CallHandler,
    res = response(),
  ): Promise<unknown> =>
    lastValueFrom(
      interceptor.intercept(
        fakeContext({
          request: req,
          response: res,
          handler: Routes.prototype[route],
          controller: Routes,
        }),
        next,
      ),
      { defaultValue: undefined },
    );

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'passes %s straight through, with no transaction',
    async (method) => {
      const next = handlerReturning({ ok: true });
      await expect(run('strict', request(method), next)).resolves.toEqual({ ok: true });
      expect(transactions.run).not.toHaveBeenCalled();
    },
  );

  it('passes WebSocket contexts straight through', async () => {
    const next = handlerReturning('ws');
    const result = await lastValueFrom(interceptor.intercept(fakeContext({ type: 'ws' }), next));
    expect(result).toBe('ws');
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it('runs a write without a key in a transaction, claiming nothing', async () => {
    await expect(run('plain', request('POST'), handlerReturning({ id: 1 }))).resolves.toEqual({
      id: 1,
    });
    expect(transactions.run).toHaveBeenCalledTimes(1);
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('claims a sent key in the anonymous scope, then stores the status and body', async () => {
    const res = response();
    await run(
      'plain',
      request('PATCH', { 'idempotency-key': KEY }),
      handlerReturning({ id: 1 }),
      res,
    );
    expect(idempotency.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'anonymous',
        key: KEY,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(idempotency.complete).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ key: KEY }),
      201,
      { id: 1 },
    );
  });

  it('replays a stored response without running the handler', async () => {
    idempotency.claim.mockResolvedValue({ kind: 'replay', status: 200, body: { id: 9 } });
    const next = handlerReturning({ id: 1 });
    const res = response();
    await expect(
      run('plain', request('POST', { 'idempotency-key': KEY }), next, res),
    ).resolves.toEqual({ id: 9 });
    expect(next.handle).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.headers['Idempotent-Replayed']).toBe('true');
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('answers IDEMPOTENCY_KEY_REQUIRED on a strict route without a key, before any transaction', async () => {
    await expect(run('strict', request('POST'), handlerReturning(null))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it.each(['has spaces', 'x'.repeat(129), 'ключ'])(
    'answers VALIDATION_FAILED for the key %p',
    async (key) => {
      await expect(
        run('plain', request('POST', { 'idempotency-key': key }), handlerReturning(null)),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [expect.objectContaining({ field: 'Idempotency-Key' })] },
      });
    },
  );

  it('stores nothing on @NoIdempotencyStorage routes, which still run in a transaction', async () => {
    await run(
      'auth',
      request('POST', { 'idempotency-key': KEY }),
      handlerReturning({ token: 't' }),
    );
    expect(transactions.run).toHaveBeenCalledTimes(1);
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('opens no transaction on @NoRequestTransaction routes, but a strict one still needs a key', async () => {
    await expect(run('upload', request('POST'), handlerReturning(null))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    await expect(
      run('upload', request('POST', { 'idempotency-key': KEY }), handlerReturning({ ok: 1 })),
    ).resolves.toEqual({ ok: 1 });
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it.each(['40P01', '40001'])('retries the whole transaction once on %s', async (code) => {
    const next: CallHandler = { handle: jest.fn() };
    (next.handle as jest.Mock)
      .mockReturnValueOnce(throwError(() => postgresError({ code })))
      .mockReturnValueOnce(of({ id: 2 }));
    await expect(run('plain', request('POST', { 'idempotency-key': KEY }), next)).resolves.toEqual({
      id: 2,
    });
    expect(transactions.run).toHaveBeenCalledTimes(2);
    expect(idempotency.claim).toHaveBeenCalledTimes(2);
  });

  it('recognises a deadlock wrapped as the cause of an AppError', async () => {
    const wrapped = new AppError('INTERNAL', undefined, null, {
      cause: postgresError({ code: '40P01' }),
    });
    const next: CallHandler = { handle: jest.fn() };
    (next.handle as jest.Mock)
      .mockReturnValueOnce(throwError(() => wrapped))
      .mockReturnValueOnce(of('ok'));
    await expect(run('plain', request('POST'), next)).resolves.toBe('ok');
  });

  it('gives up after the second attempt fails the same way', async () => {
    const deadlock = postgresError({ code: '40P01' });
    const next: CallHandler = { handle: jest.fn(() => throwError(() => deadlock)) };
    await expect(run('plain', request('POST'), next)).rejects.toBe(deadlock);
    expect(transactions.run).toHaveBeenCalledTimes(2);
  });

  it('never retries other errors', async () => {
    const conflict = new AppError('SEAT_TAKEN');
    const next: CallHandler = { handle: jest.fn(() => throwError(() => conflict)) };
    await expect(run('plain', request('POST'), next)).rejects.toBe(conflict);
    expect(transactions.run).toHaveBeenCalledTimes(1);
  });
});

describe('scopeOf', () => {
  it('is the principal kind and id, or anonymous', () => {
    expect(scopeOf(undefined)).toBe('anonymous');
    expect(scopeOf({ kind: 'customer', id: 4, sessionId: 1 })).toBe('customer:4');
    expect(scopeOf({ kind: 'staff', id: 2, sessionId: 1, role: 'admin' })).toBe('staff:2');
  });
});
