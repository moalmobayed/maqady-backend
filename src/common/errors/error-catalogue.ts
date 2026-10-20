import type { ErrorDefinition } from './types';

/**
 * Every error code the API can return, with its one HTTP status. This is the starter catalogue;
 * U1 completes it from design §14.3, and each unit adds the codes it introduces.
 *
 * Codes are part of the public contract: never rename or reuse one.
 */
export const ERROR_CATALOGUE = {
  VALIDATION_FAILED: {
    status: 400,
    message: 'The request is not valid.',
    description:
      'The body, query or path failed validation. When the request could be parsed, `details.fields` lists each problem as `{ field, messages }`, with dotted paths such as `seats.0.label`. `details` is null when the body could not be read, for example malformed JSON.',
  },
  UNAUTHENTICATED: {
    status: 401,
    message: 'Sign in to continue.',
    description: 'No valid access token was sent. Sign in, or refresh the tokens, and retry.',
  },
  FORBIDDEN: {
    status: 403,
    message: 'You do not have access to this.',
    description: 'The signed-in account may not perform this action.',
  },
  NOT_FOUND: {
    status: 404,
    message: 'The requested resource was not found.',
    description:
      "The route or the resource doesn't exist. Another customer's resource also answers NOT_FOUND.",
  },
  CONFLICT: {
    status: 409,
    message: 'The request conflicts with existing data.',
    description:
      'A database constraint refused the change. `details.constraint` names the constraint.',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    message: 'The request body is too large.',
    description: 'JSON bodies are limited to 1 MB.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Too many requests. Try again shortly.',
    description:
      'A rate limit was reached. Wait for the number of seconds in the `Retry-After` header, then retry.',
  },
  INTERNAL: {
    status: 500,
    message: 'Something went wrong on our side.',
    description: 'An unexpected error. Quote `correlationId` when reporting it.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: 'The service is temporarily unavailable.',
    description:
      "The database can't be reached right now. Retry after a short wait; the free host may also be waking up.",
  },
} as const satisfies Record<string, ErrorDefinition>;
