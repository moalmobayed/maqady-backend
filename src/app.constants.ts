/** Every route is served under `/api/v1` (design §11). */
export const API_PREFIX = 'api/v1';

/** Design §10.7: JSON bodies up to 1 MB. Upload routes add their own multipart limit. */
export const JSON_BODY_LIMIT = '1mb';

/** Render terminates HTTPS one proxy hop in front of the service (design §10.6). */
export const TRUSTED_PROXY_HOPS = 1;

/** Design §10.7. */
export const CORS_ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'Idempotency-Key',
  'X-Hold-Token',
  'X-Request-Id',
];

/**
 * Design §10.7, plus `Retry-After`: browsers hide non-safelisted response headers from a
 * cross-origin page, and the frontend needs it to say when to retry after a 429.
 */
export const CORS_EXPOSED_HEADERS = [
  'Idempotent-Replayed',
  'X-Request-Id',
  'Content-Disposition',
  'Retry-After',
];

export const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** How long a browser may cache a preflight answer. */
export const CORS_MAX_AGE_SECONDS = 600;
