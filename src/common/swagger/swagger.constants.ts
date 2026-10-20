/** Swagger UI, and the document it reads (design §19). Served outside the `/api/v1` prefix. */
export const API_DOCS_PATH = 'api/docs';
export const API_DOCS_JSON_PATH = 'api/docs/openapi.json';
export const API_DOCS_YAML_PATH = 'api/docs/openapi.yaml';

export const API_TITLE = 'Maqady API';

/** Security scheme names. Customer routes use `@ApiBearerAuth(SECURITY_SCHEMES.customer)`. */
export const SECURITY_SCHEMES = {
  customer: 'customer',
  staff: 'staff',
} as const;

/** Tags in display order. Each unit adds the tags of the routes it introduces. */
export const API_TAGS = [
  { name: 'Health', description: 'Liveness and readiness' },
  {
    name: 'Admin: auth',
    description:
      'Staff sign-in, token refresh, sign-out, the signed-in member, "Forgot password" and the set-password page',
  },
  {
    name: 'Admin: staff',
    description: 'Staff accounts: list, invites, roles and status (admins only)',
  },
  {
    name: 'Admin: messages',
    description: 'The Message log: every email and SMS with its delivery status (admins only)',
  },
  {
    name: 'Admin: movies',
    description:
      'Movies: details, genres, poster, photos, YouTube videos, cast and crew, publishing and the home carousel (admins only)',
  },
  {
    name: 'Admin: people',
    description: 'Actors and crew, their photos and filmographies (admins only)',
  },
  {
    name: 'Auth',
    description:
      'Customer sign-up, sign-in, token refresh and sign-out, email verification and password reset',
  },
  { name: 'Profile', description: 'The signed-in customer: details and password' },
] as const;

/** Relative first, so Swagger UI's "Try it out" calls whichever host serves the docs. */
export const API_SERVERS = [
  { url: '/api/v1', description: 'The server hosting these docs' },
  { url: 'http://localhost:3000/api/v1', description: 'Local development' },
] as const;

export const API_DESCRIPTION = `The Maqady cinema seat-booking API, behind the customer website and the admin dashboard.

Conventions that apply to every endpoint:

- Base path \`/api/v1\`. JSON with camelCase fields.
- Times are ISO 8601 in Cairo time with their offset, for example \`2026-10-16T19:30:00+03:00\`. A cinema day runs from 06:00 to 06:00, so a 00:30 show belongs to the previous day's \`cinemaDate\`.
- Ids are integers. Money is \`{ "amount": <piastres>, "currency": "EGP" }\`.
- Lists are cursor-paginated and return \`{ "items", "nextCursor", "total" }\`.
- Every error has the same shape (\`ErrorResponse\`): \`{ "error": { "code", "message", "details", "correlationId" } }\`. Branch on \`code\`, never on \`message\`. Each operation lists the codes it can return.
- Every response carries an \`X-Request-Id\` header. Send your own UUID in \`X-Request-Id\` to correlate a request; any other value is replaced with a new UUID.
- Writes accept an \`Idempotency-Key\` header: a new UUID per user action, reused when retrying that same action.
- Signed-in routes take \`Authorization: Bearer <access token>\`: the \`customer\` scheme on the customer website, \`staff\` on the admin dashboard.
- The free server sleeps when idle, so the first request after a pause can take much longer. Show a "waking up" state rather than an error; \`GET /health\` is a cheap way to wake it.`;
