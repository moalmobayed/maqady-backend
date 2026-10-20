import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { defer, lastValueFrom, type Observable } from 'rxjs';
import type { Principal } from '../auth/types';
import { isRetryableTransactionError } from '../database/postgres-errors';
import { TransactionRepository } from '../database/transaction.repository';
import { AppError } from '../errors/app-error';
import {
  ANONYMOUS_SCOPE,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENT_REPLAYED_HEADER,
  MAX_TRANSACTION_ATTEMPTS,
  NO_IDEMPOTENCY_STORAGE_METADATA,
  NO_REQUEST_TRANSACTION_METADATA,
  STRICT_METADATA,
  WRITE_METHODS,
} from './idempotency.constants';
import { IdempotencyService } from './idempotency.service';
import { hashedPartsOf, hashRequest } from './request-hash';
import type { IdempotencyKeyInput, WriteRouteOptions } from './types';

/**
 * The one global write interceptor (design §14.1). Every `POST`, `PUT`, `PATCH` and `DELETE`
 * runs in one database transaction, and a sent `Idempotency-Key` makes it safe to retry:
 *
 * 1. Open the request transaction (`TransactionRepository.run()`).
 * 2. With a key, claim it in that transaction; replay the stored response of an identical
 *    earlier request (`Idempotent-Replayed: true`), refuse a different one.
 * 3. Run the handler, store its status and encrypted body, commit, run the post-commit hooks.
 * 4. A handler that throws rolls back its writes and its key, so a retry runs again. A deadlock
 *    or serialization failure re-runs the whole transaction once.
 *
 * Reads, and contexts other than HTTP (the WebSocket gateway), pass straight through.
 */
@Injectable()
export class WriteInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly transactions: TransactionRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (!WRITE_METHODS.has(request.method)) return next.handle();

    const options = this.optionsOf(context);
    const response = http.getResponse<Response>();
    return defer(() => this.handleWrite(request, response, next, options));
  }

  private async handleWrite(
    request: Request,
    response: Response,
    next: CallHandler,
    options: WriteRouteOptions,
  ): Promise<unknown> {
    const key = idempotencyKeyOf(request, options.strict);
    if (!options.requestTransaction) return runHandler(next);

    const input: IdempotencyKeyInput | undefined =
      key !== undefined && options.storeResponses
        ? {
            scope: scopeOf(request.principal),
            key,
            requestHash: hashRequest(hashedPartsOf(request)),
          }
        : undefined;

    for (let attempt = 1; ; attempt += 1) {
      try {
        // `next.handle()` must be called inside `run()`, so the handler inherits the context.
        return await this.transactions.run(() => this.runOnce(response, next, input));
      } catch (error) {
        if (attempt < MAX_TRANSACTION_ATTEMPTS && isRetryableTransactionError(error)) continue;
        throw error;
      }
    }
  }

  private async runOnce(
    response: Response,
    next: CallHandler,
    input: IdempotencyKeyInput | undefined,
  ): Promise<unknown> {
    if (input === undefined) return runHandler(next);

    const claim = await this.idempotency.claim(input);
    if (claim.kind === 'replay') {
      response.status(claim.status);
      response.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
      return claim.body;
    }
    const result = await runHandler(next);
    await this.idempotency.complete(claim.id, input, response.statusCode, result);
    return result;
  }

  private optionsOf(context: ExecutionContext): WriteRouteOptions {
    const targets = [context.getHandler(), context.getClass()];
    const flag = (key: string): boolean =>
      this.reflector.getAllAndOverride<boolean | undefined>(key, targets) === true;
    return {
      strict: flag(STRICT_METADATA),
      storeResponses: !flag(NO_IDEMPOTENCY_STORAGE_METADATA),
      requestTransaction: !flag(NO_REQUEST_TRANSACTION_METADATA),
    };
  }
}

function runHandler(next: CallHandler): Promise<unknown> {
  return lastValueFrom(next.handle(), { defaultValue: undefined });
}

/** The scope a key belongs to: the principal, or `anonymous` for guests (design §14.1). */
export function scopeOf(principal: Principal | undefined): string {
  return principal ? `${principal.kind}:${principal.id}` : ANONYMOUS_SCOPE;
}

/**
 * The request's key: undefined when none was sent; `IDEMPOTENCY_KEY_REQUIRED` when a strict
 * route has none; `VALIDATION_FAILED` when it is malformed (or sent twice).
 */
export function idempotencyKeyOf(request: Request, strict: boolean): string | undefined {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
  if (raw === undefined || raw === '') {
    if (strict) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
    return undefined;
  }
  if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(raw)) {
    throw new AppError('VALIDATION_FAILED', undefined, {
      fields: [
        {
          field: IDEMPOTENCY_KEY_HEADER,
          messages: [
            'Idempotency-Key must be 1 to 128 letters, digits, "_" or "-", such as a UUID',
          ],
        },
      ],
    });
  }
  return raw;
}
