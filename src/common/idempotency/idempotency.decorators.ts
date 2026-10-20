import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import {
  IDEMPOTENCY_OPENAPI_EXTENSION,
  NO_IDEMPOTENCY_STORAGE_METADATA,
  NO_REQUEST_TRANSACTION_METADATA,
  STRICT_METADATA,
} from './idempotency.constants';
import type { IdempotencyMode } from './types';

/**
 * The route requires an `Idempotency-Key` (design §11 "S"): every `POST` that creates or changes
 * something, except auth routes, scans and read-like checks. Without one it answers
 * `IDEMPOTENCY_KEY_REQUIRED`.
 */
export const Strict = (): MethodDecorator =>
  applyDecorators(
    SetMetadata(STRICT_METADATA, true),
    ApiExtension(IDEMPOTENCY_OPENAPI_EXTENSION, 'required' satisfies IdempotencyMode),
  );

/**
 * Auth routes (design §10.2): they run in the request transaction, but their responses carry
 * credentials, so no key is claimed and nothing is stored.
 */
export const NoIdempotencyStorage = (): MethodDecorator =>
  applyDecorators(
    SetMetadata(NO_IDEMPOTENCY_STORAGE_METADATA, true),
    ApiExtension(IDEMPOTENCY_OPENAPI_EXTENSION, 'ignored' satisfies IdempotencyMode),
  );

/**
 * Upload routes (design §9): slow image work must not hold a connection, so no request
 * transaction is opened and the service opens its own short ones. A `@Strict()` upload still
 * requires the key; recording it is the upload service's job (U4).
 */
export const NoRequestTransaction = (): MethodDecorator =>
  SetMetadata(NO_REQUEST_TRANSACTION_METADATA, true);
