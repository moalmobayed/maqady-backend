---
title: U1 — Foundations - transactions, idempotency, access, time and pagination
owner: Mohamed Tarek
status: In progress — 2026-10-20
last_verified: 2026-10-20
tags: [foundations, transactions, idempotency, auth, rate-limit, time, money, pagination, audit, errors]
---

# U1 — Foundations: transactions, idempotency, access, time and pagination

Issue: #2. Design: `docs/system-design.md` §5, §7.1, §8, §10.2, §10.3, §10.6, §13.5, §14 (14.1,
14.3, 14.6) and §15. Builds on U0 (`docs/gh-1-scaffold/spec.md`).

## Goal

Every later unit gets the same shared machinery instead of re-deciding it: one request
transaction per write with Postgres-backed idempotency, deny-by-default access checked at boot,
rate limits, a replaceable clock with summer-time-safe Cairo helpers, money, cursor pagination,
the audit writer and the full error catalogue. The unit adds **no product route**: everything is
exercised through test-only controllers registered by the integration tests.

## Scope

- `common/database`: `TransactionContext` (AsyncLocalStorage executor), `TransactionRepository`
  (`run`, `savepoint`, `afterCommit`), retryable SQLSTATEs.
- `common/idempotency`: `idempotency_keys`, `IdempotencyRepository`, `IdempotencyService`, the
  global `WriteInterceptor`, `@Strict()`, `@NoIdempotencyStorage()`, `@NoRequestTransaction()`.
- `common/crypto`: AES-256-GCM `DataEncryptionService`, `sha256Hex`, `hmacSha256`,
  `randomToken`, `safeEqual`.
- `common/time`: `Clock` (`SystemClock`), `CAIRO_TIME_ZONE`, Luxon helpers.
- `common/money`: `Money`, helpers, `MoneyResponse`.
- `common/pagination`: cursor codec, `PageQuery`, `toPage()`, `PageResponseOf()`.
- `common/auth`: access decorators, `AccessTokenService`, `PrincipalResolverRegistry`,
  `JwtAuthGuard`, `AccessGuard`, the boot-time access check.
- `common/rate-limit`: `@nestjs/throttler` with named limits from configuration.
- `common/audit`: `audit_events`, `AuditService.record()`.
- `common/errors`: the full catalogue of design §14.3.
- `common/swagger`: cross-cutting documentation (access, idempotency, `429`) applied to every
  operation from the decorators.
- Health routes become `@Public()`.

## Out of scope

- Real principal resolvers: staff (U2) and customer (U9). Until one is registered, a route that
  needs that audience answers `UNAUTHENTICATED`.
- Sessions, sign-in and token issuing routes (U2, U9). `AccessTokenService.sign()` exists for
  them and for tests.
- The WebSocket limits of §10.6 (U10), and idempotency for upload routes, which skip the request
  transaction (U4).
- U0 review finding R4 (preflights and Swagger routes without `X-Request-Id`): a logging change,
  left as a follow-up.

## Decisions taken here

| Decision | Why |
|---|---|
| `TransactionRepository.run()` joins a transaction that is already open | Services can be called from a write (already in the request transaction) and from a GET path that opens its own. Hooks always attach to the outermost transaction. |
| `afterCommit()` outside any transaction runs the hook at once | There is no commit to wait for: the write already autocommitted. |
| Hook failures are logged (`err` serializer) and never fail the request | The data is committed; the response must say so. |
| Savepoints keep their own hook list: merged on release, dropped on rollback | A rolled-back savepoint must not publish events for rows that no longer exist. |
| Repositories take the executor from `TransactionContext.executor()` | One place decides "transaction or pool"; repositories never pass `trx` around. |
| Idempotency scope `customer:<id>`, `staff:<id>` or `anonymous` | Design §14.1. Staff and customers never share a scope. |
| Key format: 1–128 characters of `A–Z a–z 0–9 _ -` (a UUID fits) | Bounded column, nothing to escape. Anything else is `VALIDATION_FAILED`. |
| Only `2xx` responses are stored | An error rolls the key back with the write, so a retry runs again (§14.1). |
| Ciphertext `v1.<keyId>.<iv>.<data>.<tag>` (base64url), AAD `idempotency:<scope>:<key>` | Key id = first 8 hex of the key's SHA-256, so `DATA_ENCRYPTION_PREVIOUS_KEY` can still decrypt after a rotation. The AAD stops a ciphertext being replayed from another row. |
| `@NoRequestTransaction()` routes skip the interceptor, except that `@Strict()` still requires the key | U4 decides how an upload records its key in its short transaction. |
| Access tokens: HS256 via `jsonwebtoken`, claims `sub`, `aud`, `sid` (positive integers as strings), 15 minutes | Design §10.2. `exp` is checked against the `Clock`. |
| `@Guest()` routes accept no token, or a valid customer token; an invalid one is `UNAUTHENTICATED` | A signed-in customer whose token expired must refresh, not silently act as a guest. |
| Exactly one access declaration per route, on the method or the controller, counted across both | "Never both" keeps a route's access readable in one place. |
| Named rate limits apply only to routes that opt in with `@RateLimit(...)`; `default` applies to every route, per route | Design §10.6 "every other route". Named limits share one bucket across the routes that use them (both forgot-password routes, for example). |
| Weekdays are ISO: 1 = Monday … 7 = Sunday | Luxon's and Postgres's `ISODOW` numbering. |
| A stored opening minute in a skipped hour moves to the first valid minute after the gap (00:30 on 24 April 2026 → 01:00) | Design §8 "shifted forward to the next valid time". |
| Every operation documents `429 RATE_LIMITED` | Every route is rate-limited. |

## Configuration

| Variable | Rule | Default |
|---|---|---|
| `JWT_SECRET_CUSTOMER`, `JWT_SECRET_STAFF` | base64 or base64url, at least 32 bytes; the two must differ | required |
| `DATA_ENCRYPTION_KEY` | base64 or base64url, exactly 32 bytes | required |
| `DATA_ENCRYPTION_PREVIOUS_KEY` | as above; only decrypts | unset |
| `RATE_LIMIT_<NAME>` | `<count>/<window>`, window `<n>s`, `<n>m` or `<n>h`, for example `300/1m` | design §10.6, below |

| Limit name (env suffix) | Default | Keyed by |
|---|---|---|
| `default` (`DEFAULT`) | 300/1m, per route | signed-in customer, else IP |
| `signInEmail` (`SIGN_IN_EMAIL`) | 5/1m | IP plus `body.email` |
| `signInIp` (`SIGN_IN_IP`) | 20/1m | IP |
| `registrationIp` (`REGISTRATION_IP`) | 5/1h | IP |
| `emailRequestEmail` (`EMAIL_REQUEST_EMAIL`) | 3/1h | `body.email` |
| `emailRequestIp` (`EMAIL_REQUEST_IP`) | 20/1h | IP |
| `holdIp` (`HOLD_IP`) | 30/10m | IP |
| `holdCustomer` (`HOLD_CUSTOMER`) | 10/10m | signed-in customer (skipped for guests) |
| `payment` (`PAYMENT`) | 10/5m | `params.ref` |
| `ticketEmail` (`TICKET_EMAIL`) | 3/1h | `params.ref` |
| `search` (`SEARCH`) | 60/1m | IP |

Emails are hashed (SHA-256) before they become a throttler key.

## Migrations (prefix `0020`)

**`0020_01_create_idempotency_keys`**

```sql
CREATE TABLE idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(64) NOT NULL,
  key VARCHAR(128) NOT NULL,
  request_hash VARCHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status SMALLINT NULL CHECK (response_status BETWEEN 200 AND 299),
  response_ciphertext TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_idempotency_keys_scope_key UNIQUE (scope, key)
);
CREATE INDEX idx_idempotency_keys_created_at ON idempotency_keys (created_at);  -- the purge
```

**`0020_02_create_audit_events`**

`id`, `occurred_at TIMESTAMPTZ`, `actor_kind VARCHAR CHECK IN ('staff','customer','system')`,
`actor_staff_user_id BIGINT NULL`, `actor_customer_id BIGINT NULL` (CHECK: exactly the column
the kind names), `action VARCHAR(64)` (`noun.verb`, CHECK), `entity_type VARCHAR(32)`,
`entity_id BIGINT NULL`, `booking_id BIGINT NULL`, `changed_fields TEXT[]`, `metadata JSONB`
(CHECK object). Indexes: `(occurred_at DESC, id DESC)` for the Activity log,
`(actor_staff_user_id, occurred_at DESC)` for its staff filter, `(entity_type, occurred_at
DESC)` for its type filter, `(booking_id, occurred_at)` for a booking's History, and
`(actor_customer_id)` for anonymisation. The foreign keys to `staff_users`, `customers` and
`bookings` come with those tables (U2, U9, U10). Both tables get row-level security.

## Behaviour

**Write interceptor** (global `APP_INTERCEPTOR`, design §14.1). HTTP only; `GET`, `HEAD`, `OPTIONS`
and WebSocket contexts pass straight through.

1. `@NoRequestTransaction()`: check the key if `@Strict()`, then run the handler as is.
2. Missing key on a `@Strict()` route → `400 IDEMPOTENCY_KEY_REQUIRED`; malformed key →
   `400 VALIDATION_FAILED` (`details.fields[0].field = "Idempotency-Key"`).
3. `TransactionRepository.run()`: with a key (and no `@NoIdempotencyStorage()`), claim it:
   `INSERT … ON CONFLICT (scope, key) DO UPDATE … WHERE created_at < now − 24h RETURNING id`, else
   `SELECT`. Purge up to 50 expired keys (`FOR UPDATE SKIP LOCKED` sub-select).
4. A live key with another `request_hash` → `422 IDEMPOTENCY_KEY_REUSED`; with the same hash →
   replay the stored status and body with `Idempotent-Replayed: true`, without the handler.
5. Otherwise run the handler, store its status and encrypted JSON body, commit, run the hooks.
6. On `40P01` or `40001` (on the error or its `cause` chain) the whole attempt is retried once.

`request_hash` = SHA-256 of canonical JSON (sorted keys) of `[method, route template, path
params, body]`. Times come from the `Clock`.

**Guards** (`APP_GUARD`, in order `JwtAuthGuard`, `RateLimitGuard`, `AccessGuard`; non-HTTP
contexts pass).

| Access | Token | Answer when it fails |
|---|---|---|
| `@Public()` | ignored | — |
| `@Guest()` | optional customer token | invalid token → `401 UNAUTHENTICATED` |
| `@Customer()` | customer token | `401 UNAUTHENTICATED` |
| `@Staff()` | staff token | `401 UNAUTHENTICATED` |
| `@Admin()` | staff token, role `admin` | `401 UNAUTHENTICATED`; box office → `403 FORBIDDEN` |

`JwtAuthGuard` verifies the token for the route's audience (wrong secret, wrong `aud`, expired by
the `Clock`, malformed claims → `UNAUTHENTICATED`), then asks the audience's registered
`PrincipalResolver`. No resolver, or `null` → `UNAUTHENTICATED`; a resolver may throw its own
`AppError` (`ACCOUNT_BLOCKED`, `ACCOUNT_DEACTIVATED`, `SESSION_REVOKED`). The principal is on
`request.principal` and `@CurrentPrincipal()`.

**Owner** (for U10–U12): declare the route `@Customer()` or `@Guest()`; the service loads the
resource by the principal's id (or the hold code) and answers `404 NOT_FOUND` for anyone else's.

**Boot check.** `app.init()` fails, naming every offending `Controller.method`, when a route has
no access declaration or more than one.

**Time.** `cinemaDateOf(instant)`, `cinemaDayBounds(date)`, `weekdayOfCinemaDate(date)`,
`addDays(date, n)`, `wallClockToInstant(date, "HH:mm")` (admin input: nonexistent →
`422 TIME_DOES_NOT_EXIST`, ambiguous → first occurrence), `cinemaMinuteToInstant(date, minute)`
(stored hours, 0–1800 from the cinema date's midnight: skipped → next valid minute, ambiguous →
first), `formatCairoIso(instant)` (`2026-10-16T19:30:00+03:00`), `addToInstant` and
`subtractFromInstant` (absolute durations).

**Pagination.** `PageQuery { cursor?, limit? }` (limit 1–100, default 20); the cursor is
base64url JSON `[sortKey, id]`; an unreadable one is `400 VALIDATION_FAILED` on `cursor`.
`PageResponseOf(Item)` documents `{ items, nextCursor, total }`.

**Audit.** `AuditService.record({ actor, action, entity, bookingId?, changedFields?, metadata? })`
writes through the current executor (inside the request transaction), with `occurred_at` from the
`Clock`. Changed fields are names only (validated identifiers, sorted, deduplicated). Metadata
values are scalars, and keys that suggest personal data (`email`, `phone`, `name`, `password`,
`token`, `secret`, `address`) are refused with `INTERNAL`.

## Error codes added

`INVALID_TOKEN` 400, `IDEMPOTENCY_KEY_REQUIRED` 400, `INVALID_CREDENTIALS` 401,
`SESSION_EXPIRED` 401, `SESSION_REVOKED` 401, `ACCOUNT_BLOCKED` 403, `ACCOUNT_DEACTIVATED` 403,
`REFRESH_CONFLICT` 409, `SEAT_TAKEN` 409, `HOLD_EXPIRED` 409, `HOLD_ALREADY_CLAIMED` 409,
`ALREADY_PAID` 409, `PAYMENT_IN_PROGRESS` 409, `SHOWTIME_NOT_BOOKABLE` 409, `SHOWTIME_CONFLICT`
409, `HALL_IN_USE` 409, `BOOKING_NOT_EDITABLE` 409, `LAST_ADMIN` 409, `EMAIL_TAKEN` 409,
`IDEMPOTENCY_KEY_REUSED` 422, `TIME_DOES_NOT_EXIST` 422, `OUTSIDE_OPENING_HOURS` 422. Unhandled
`23505`/`23P01` stay `409 CONFLICT` with `details.constraint` only (U0).

## Swagger

No new paths. Every operation now documents `429 RATE_LIMITED`. The access and idempotency
decorators record markers that the document builder turns into: the security requirement
(`[]`, `customer`, `staff`, or optional customer for `@Guest()`), the access errors
(`UNAUTHENTICATED`, `ACCOUNT_BLOCKED`/`ACCOUNT_DEACTIVATED`, `FORBIDDEN` for admin), the
`Idempotency-Key` header (required on `@Strict()`), `IDEMPOTENCY_KEY_REQUIRED`/`_REUSED` and the
`Idempotent-Replayed` response header. The markers are removed from the published document.

## Tests

**Unit**: config (secrets, rate limits); crypto (round trip, tamper, AAD, previous key, unknown
key id, helpers); time (cinema date by wall clock incl. 2026-10-17 00:30 → 2026-10-16 and
2026-04-24 06:30 → 2026-04-24, bounds, weekday, admin nonexistent → `TIME_DOES_NOT_EXIST`,
ambiguous → first, stored minute shifted, formatting); money; cursor round trip and invalid
cursors; page builder; request hash; error catalogue (every §14.3 code with its status);
`WriteInterceptor` (pass-through, key checks, retry once on `40P01`/`40001` and not twice);
`AccessTokenService`; `JwtAuthGuard`; `AccessGuard`; access check; rate-limit trackers and skip
rules; `AuditService` validation; Swagger cross-cutting post-processing.

**Integration** (real app, real Postgres, test-only controllers in `test/support/`):

- Transactions: commit, rollback, executor inside and outside, nested `run` joins, savepoint
  survives a unique violation, hooks after commit only, never after a rollback, dropped with a
  rolled-back savepoint.
- Idempotency: concurrent same-key requests run the handler once and the other replays with
  `Idempotent-Replayed: true`; same key, different body → `IDEMPOTENCY_KEY_REUSED`; strict route
  without a key → `IDEMPOTENCY_KEY_REQUIRED`; a throwing handler rolls back its rows and its key
  so a retry runs; a key older than 24 hours by the `Clock` is taken over; a real `40P01` is
  retried once; expired keys are purged; scope separates principals; the stored body is
  ciphertext; `@NoIdempotencyStorage()` stores nothing; GET runs without a transaction.
- Access: every access level with valid, missing, expired, wrong-audience and malformed tokens,
  box office on an admin route, no resolver registered, a resolver refusing; the boot check fails
  for an undecorated route and for a doubly decorated one.
- Rate limits: the default limit answers `429 RATE_LIMITED` with `Retry-After`; a named limit
  applies only where declared.
- Audit: a record commits with the request and disappears with its rollback.
- Swagger: health stays as agreed, now `@Public()`; the contract is current.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above exist and pass, including every acceptance case named in issue #2.
