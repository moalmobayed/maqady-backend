import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  ResponseObject,
  SecurityRequirementObject,
} from '@nestjs/swagger';
import { ACCESS_OPENAPI_EXTENSION } from '../auth/auth.constants';
import type { AccessLevel } from '../auth/types';
import { ERROR_CATALOGUE } from '../errors/error-catalogue';
import type { ErrorCode } from '../errors/types';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_OPENAPI_EXTENSION,
  IDEMPOTENT_REPLAYED_HEADER,
} from '../idempotency/idempotency.constants';
import type { IdempotencyMode } from '../idempotency/types';
import { errorResponseFor, exampleErrorBody } from './error-responses';
import { SECURITY_SCHEMES } from './swagger.constants';

const WRITE_OPERATIONS = new Set(['post', 'put', 'patch', 'delete']);

/** The security requirement each access level publishes. */
const SECURITY_OF_ACCESS: Readonly<Record<AccessLevel, SecurityRequirementObject[]>> = {
  public: [],
  guest: [{}, { [SECURITY_SCHEMES.customer]: [] }],
  customer: [{ [SECURITY_SCHEMES.customer]: [] }],
  staff: [{ [SECURITY_SCHEMES.staff]: [] }],
  admin: [{ [SECURITY_SCHEMES.staff]: [] }],
};

/**
 * The errors the guards can answer for each access level (design §10.3): a missing or invalid
 * token, an ended session, and an account that is no longer live.
 */
const ERRORS_OF_ACCESS: Readonly<Record<AccessLevel, readonly ErrorCode[]>> = {
  public: [],
  guest: ['UNAUTHENTICATED', 'SESSION_REVOKED', 'ACCOUNT_BLOCKED'],
  customer: ['UNAUTHENTICATED', 'SESSION_REVOKED', 'ACCOUNT_BLOCKED'],
  staff: ['UNAUTHENTICATED', 'SESSION_REVOKED', 'ACCOUNT_DEACTIVATED'],
  admin: ['UNAUTHENTICATED', 'SESSION_REVOKED', 'ACCOUNT_DEACTIVATED', 'FORBIDDEN'],
};

const IDEMPOTENCY_KEY_PARAMETER_DESCRIPTION =
  'A new UUID per user action, reused unchanged when retrying that same action. Within 24 hours, a retry with the same key and the same request replays the first response (with `Idempotent-Replayed: true`) instead of running again; the same key with a different request is `IDEMPOTENCY_KEY_REUSED`.';

/**
 * Documents what every route gets from the global guards and the write interceptor, from the
 * markers the access and idempotency decorators leave (`x-maqady-*`), then removes the markers:
 *
 * - the security requirement and the guards' error codes, per access level;
 * - `429 RATE_LIMITED` on every operation, since every route has at least the default limit;
 * - `413 PAYLOAD_TOO_LARGE` on writes, since every JSON body is limited to 1 MB;
 * - on writes, the `Idempotency-Key` header (required on `@Strict()` routes), its error codes
 *   and the `Idempotent-Replayed` response header. `@NoIdempotencyStorage()` routes get none.
 *
 * Error codes merge into the responses the route declared, one example per code, so a route's
 * own `@ApiErrorResponses()` and these never overwrite each other.
 */
export function applyCrossCuttingDocs(document: OpenAPIObject): void {
  for (const item of Object.values(document.paths)) {
    for (const [method, value] of Object.entries(item)) {
      if (!isOperation(value)) continue;
      const operation = value as OperationObject & Record<string, unknown>;
      const access = operation[ACCESS_OPENAPI_EXTENSION] as AccessLevel | undefined;
      const idempotency = operation[IDEMPOTENCY_OPENAPI_EXTENSION] as IdempotencyMode | undefined;
      delete operation[ACCESS_OPENAPI_EXTENSION];
      delete operation[IDEMPOTENCY_OPENAPI_EXTENSION];

      if (access !== undefined) {
        operation.security = SECURITY_OF_ACCESS[access];
        for (const code of ERRORS_OF_ACCESS[access]) mergeErrorCode(operation, code);
      }
      if (WRITE_OPERATIONS.has(method)) {
        documentIdempotency(operation, idempotency ?? 'optional');
        // The one JSON parser refuses any body over 1 MB, before the route runs.
        mergeErrorCode(operation, 'PAYLOAD_TOO_LARGE');
      }
      mergeErrorCode(operation, 'RATE_LIMITED');
      operation.responses = sortedByStatus(operation.responses);
    }
  }
}

function documentIdempotency(operation: OperationObject, mode: IdempotencyMode): void {
  if (mode === 'ignored') return;
  const parameters = (operation.parameters ??= []);
  const declared = parameters.some(
    (parameter) => 'name' in parameter && parameter.name === IDEMPOTENCY_KEY_HEADER,
  );
  if (!declared) {
    const parameter: ParameterObject = {
      name: IDEMPOTENCY_KEY_HEADER,
      in: 'header',
      required: mode === 'required',
      description: IDEMPOTENCY_KEY_PARAMETER_DESCRIPTION,
      schema: {
        type: 'string',
        maxLength: 128,
        pattern: '^[A-Za-z0-9_-]{1,128}$',
        example: '5f0c8a8e-2f3b-4d8e-9a51-3c2b7d1e9f40',
      },
    };
    parameters.push(parameter);
  }
  mergeErrorCode(operation, 'VALIDATION_FAILED');
  if (mode === 'required') mergeErrorCode(operation, 'IDEMPOTENCY_KEY_REQUIRED');
  mergeErrorCode(operation, 'IDEMPOTENCY_KEY_REUSED');

  for (const [status, response] of Object.entries(operation.responses)) {
    if (!status.startsWith('2') || !response || '$ref' in response) continue;
    response.headers = {
      ...response.headers,
      [IDEMPOTENT_REPLAYED_HEADER]: {
        description:
          '`true` when this is the stored response of an earlier request with the same `Idempotency-Key`; absent otherwise.',
        schema: { type: 'string', enum: ['true'] },
      },
    };
  }
}

/** Adds one error code to the operation's response for its status, creating it if needed. */
export function mergeErrorCode(operation: OperationObject, code: ErrorCode): void {
  const { status, description } = ERROR_CATALOGUE[code];
  const key = String(status);
  const existing = operation.responses[key];
  if (!existing || '$ref' in existing) {
    const { status: _status, ...response } = errorResponseFor(status, [code]);
    operation.responses[key] = response as ResponseObject;
    return;
  }
  const media = existing.content?.['application/json'];
  if (!media) return;
  const examples = (media.examples ??= {}) as Record<string, ReferenceObject | object>;
  if (code in examples) return;
  examples[code] = { summary: code, value: exampleErrorBody(code) };
  existing.description = [existing.description, `\`${code}\`: ${description}`]
    .filter((part) => part !== undefined && part !== '')
    .join('\n\n');
}

/** Responses in status order (`200`, `400`, …, `500`), whatever order they were added in. */
function sortedByStatus(responses: OperationObject['responses']): OperationObject['responses'] {
  return Object.fromEntries(
    Object.entries(responses).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function isOperation(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'responses' in value;
}
