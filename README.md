# maqady-backend

The API behind **Maqady**, a cinema seat-booking platform for Cairo cinemas: the customer
website (browse movies and theaters, hold seats, pay, tickets) and the admin dashboard
(catalog, theaters and halls, showtimes, bookings, box office, analytics).

One NestJS service serves a REST API under `/api/v1`, and later a WebSocket for the live seat
map. PostgreSQL is the single source of truth. The design is in
[`docs/system-design.md`](docs/system-design.md), the product rules in
[`docs/reference/prd-v2.md`](docs/reference/prd-v2.md), and the working rules for this repository
in [`CLAUDE.md`](CLAUDE.md).

**Stack:** TypeScript · NestJS 11 on Express · Knex with raw SQL migrations · PostgreSQL 16 ·
pino · Jest · Docker. Hosted on Render, with Postgres and storage on Supabase.

## Prerequisites

- **Node.js 22 or later** (CI and the Docker image use Node 24) and npm 10.
- **PostgreSQL 16**: through Docker Compose (the default), or a local cluster.

## Setup

```bash
npm ci
cp .env.example .env          # local defaults; then fill in the three secrets:
#   JWT_SECRET_CUSTOMER, JWT_SECRET_STAFF and DATA_ENCRYPTION_KEY, each from
#   openssl rand -base64 32   (the two JWT secrets must differ)

# Postgres, either:
docker compose up -d          # postgres:16 with maqady_dev and maqady_test
# or, in a container with PostgreSQL 16 installed as a cluster (pg_ctlcluster):
npm run db:local              # starts it, sets the postgres password, creates both databases

npm run dev                   # migrates, then serves http://localhost:3000 and reloads on change
curl http://localhost:3000/api/v1/health      # {"status":"ok"}
```

The service migrates the database every time it starts, before it listens.

## API documentation

| URL | What |
|---|---|
| <http://localhost:3000/api/docs> | Swagger UI: every route, its rules, request and response shapes, error codes |
| <http://localhost:3000/api/docs/openapi.json> | The OpenAPI 3.0.3 document (`openapi.yaml` next to it) |
| [`contracts/openapi.yaml`](contracts/openapi.yaml) | The same document, committed. The frontend can generate a typed client from it |

The document is generated from the controllers and DTOs. After changing the API, run
`npm run contract` and commit `contracts/openapi.yaml`; CI fails when the committed copy is stale.
Paths are relative to the server `/api/v1`, and operation ids are the controller method names.

Every error has one shape, and its `correlationId` equals the `X-Request-Id` response header:

```json
{ "error": { "code": "NOT_FOUND", "message": "…", "details": null, "correlationId": "…" } }
```

## Environment variables

Validated at boot: a missing or malformed value stops the start, and the error names the variable
but never prints its value. `.env` is for local runs only; real environment variables win.

| Variable | Read today | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://` URL. On Supabase, the session pooler URL (port 5432) |
| `DB_SCHEMA` | yes | Schema holding every table: `maqady` |
| `CORS_ORIGINS` | yes | Comma-separated frontend origins, for example `https://maqady.example` |
| `PORT` | yes | Default `3000`; Render sets it |
| `LOG_LEVEL` | yes | `fatal` … `trace`, or `silent`. Default `info` |
| `JWT_SECRET_CUSTOMER`, `JWT_SECRET_STAFF` | yes | Access-token secrets, one per audience: base64 of at least 32 bytes, and different from each other. Generate with `openssl rand -base64 32` |
| `DATA_ENCRYPTION_KEY` | yes | Encrypts stored idempotency responses (AES-256-GCM): base64 of exactly 32 bytes |
| `DATA_ENCRYPTION_PREVIOUS_KEY` | yes, optional | After a key rotation, the old key; it only decrypts |
| `QR_SIGNING_KEY` | later units | Ticket QR signatures; generate with `openssl rand -base64 32` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET` | later units | Image storage; the key never leaves the server |
| `FRONTEND_BASE_URL` | yes | Where email links point, for example `https://maqady.example`; no query, a trailing `/` is dropped |
| `EMAIL_DRIVER` | yes | `simulated` (every email recorded as sent, nothing leaves; local runs and CI) or `resend` ([ADR 0004](docs/adr/0004-email-through-resend.md)) |
| `RESEND_API_KEY`, `EMAIL_FROM` | with `resend` | The Resend API key (never logged) and the sender on the verified domain, `tickets@maqady.example` or `Maqady <tickets@maqady.example>` |
| `RATE_LIMIT_DEFAULT`, `RATE_LIMIT_SIGN_IN_EMAIL`, … | yes, optional | `<count>/<window>` (window in `s`, `m` or `h`), for example `300/1m`. Unset means the design §10.6 default; `.env.example` lists all eleven |
| `TEST_DATABASE_URL` | tests | Default `postgres://postgres:postgres@localhost:5432/maqady_test` |

### Email and SMS

- Messages go through the `messages` outbox: queued in the transaction that caused them, sent
  right after commit, and retried on later activity (any write, or `GET /api/v1/health/ready`),
  never by a timer. One-time links are redacted in every stored copy.
- Locally keep `EMAIL_DRIVER=simulated`: emails are recorded as sent without leaving, and the
  stored copy is in `messages`.
- With `EMAIL_DRIVER=resend`, Resend needs a verified domain before it delivers to anyone but the
  account owner (design §16). The free plan sends 100 emails a day; the rest wait for the next
  00:00 UTC.
- **One sending environment per Resend team.** The message id is Resend's idempotency key, so two
  databases sending through the same team would collide. Only production uses `resend`.
- SMS is always simulated.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Builds, migrates and serves, reloading on change |
| `npm start` | Runs the compiled app (`dist/main.js`) |
| `npm run build` | Compiles to `dist/` |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/` |
| `npm run lint` | ESLint (with the `CLAUDE.md` rules it can check), then Prettier's check |
| `npm run format` | Formats with Prettier |
| `npm test` | Unit tests, then integration tests |
| `npm run test:unit` / `npm run test:integration` | One project only |
| `npm run migrate` | Applies pending migrations to `DATABASE_URL`, without serving |
| `npm run contract` | Writes `contracts/openapi.yaml` from the code, with no database and no listener |
| `npm run db:local` | Starts a local PostgreSQL 16 cluster and creates `maqady_dev` and `maqady_test` |

## Dependencies

- Versions are pinned exactly (`.npmrc` sets `save-exact`), and `package-lock.json` is committed;
  CI and the image install with `npm ci`.
- NestJS stays on 11 (CommonJS) for now: NestJS 12 ships only as ES modules, which Jest loads
  from CommonJS only on Node 24.9+, and the suite must also run on Node 22 (design D-23).
- `overrides` moves `@nestjs/swagger`'s pinned `js-yaml` to 5.4.2, which fixes a YAML-parsing
  advisory. Drop the override once the Swagger version in use depends on a fixed `js-yaml`.
- `npm audit` reports a moderate advisory in `sprintf-js`, reached only through Jest's coverage
  tooling (dev only, no fix upstream). `npm audit --omit=dev` is clean.

## Tests

- **Unit** (`test/unit/`, mirroring `src/`): one unit at a time, collaborators mocked.
- **Integration** (`test/integration/`, mirroring `src/`): the real app through supertest, against
  the real `maqady_test` database. Nothing of ours is mocked; only genuinely external services
  (Resend, Supabase Storage) will be replaced, at their adapter boundary.
  - Once per run, the schema and extensions are dropped and every migration runs from zero.
  - Each suite starts and ends with empty tables (`test/support/database.ts`).
  - The suite refuses a database whose name doesn't end in `_test`.

```bash
npm test                                         # both projects
npx jest --selectProjects unit -t "loadConfig"   # one test by name
```

`test/support/test-app.ts` boots the whole app for a suite: `createTestApp()`, then
`testApp.http().get('/api/v1/…')`, and `testApp.close()` in `afterAll`.

- `createTestApp({ clock })` replaces the `Clock` with a `TestClock` (`test/support/clock.ts`),
  which a test sets or advances to test expiry and summer-time rules without sleeping.
- The test configuration supplies fixed secrets and raises every rate limit, so concurrency tests
  aren't throttled; `buildTestConfig({}, { RATE_LIMIT_DEFAULT: '3/1m' })` lowers one.
- `test/support/foundations-probe.module.ts` holds test-only routes and principal resolvers for
  exercising the guards and the write interceptor. They are registered by the suites, never by
  the app.
- `createTestApp({ overrides })` replaces a genuinely external service at its boundary:
  `test/support/messaging/recording-email-sender.ts` stands in for Resend (it records, answers a
  scripted outcome, and can hold sends), and `OutboxDrainService.whenIdle()` waits for the
  background drains before asserting.
- Point `TEST_DATABASE_URL` at your own `*_test` database when other runs share the server.

## Writing a feature (the shared foundations)

- **Access.** Every route declares exactly one of `@Public()`, `@Guest()`, `@Customer()`,
  `@Staff()` or `@Admin()` (`common/auth`), on the method or on the controller. The app refuses
  to start otherwise. The principal is `@CurrentPrincipal()`. An owner-only route is
  `@Customer()` (or `@Guest()` with a hold code) and its service answers `NOT_FOUND` for anyone
  else's resource.
- **Writes.** Every `POST`, `PUT`, `PATCH` and `DELETE` runs in one transaction opened by the
  global `WriteInterceptor`. Mark creating `POST`s `@Strict()` (the `Idempotency-Key` header is
  then required); auth routes `@NoIdempotencyStorage()`; uploads `@NoRequestTransaction()`.
- **Repositories** take their executor from `TransactionContext.executor()`, never inject Knex,
  so they join the request transaction. `TransactionRepository.run()` opens one elsewhere (a GET
  that writes), `savepoint()` isolates per-item inserts, and `afterCommit()` defers side effects
  until the commit.
- **Time** comes from the injected `Clock`; conversions go through `common/time` only.
  **Money** is `common/money`; lists use `PageQuery`, `toPageRequest()`, `toPage()` and
  `PageResponseOf()` from `common/pagination`; audit records go through `AuditService.record()`.
- **Rate limits.** Every route has the default limit; opt into a named one with
  `@RateLimit('search')`.
- **Messages.** Define a template (`MessageTemplate<P>`, with `renderSimpleHtml()` and
  `links.oneTime()` for single-use links) in `src/modules/<owner>/templates/`, register it with
  `MessageTemplateRegistry` in the module's `onModuleInit()`, and call
  `MessagingService.queue({ template, recipient, params, related })` inside the write. List
  tokens in `secretParams`; `queue()` refuses a stored copy that would contain one.

## Database and migrations

- Every table lives in the `maqady` schema (`DB_SCHEMA`). Each connection sets
  `search_path` to `maqady, extensions, public`, `statement_timeout` to 10 s,
  `idle_in_transaction_session_timeout` to 15 s and the time zone to UTC. The pool holds at most
  5 connections.
- **Where the extensions live.** `citext`, `pg_trgm` and `btree_gist` are created by the first
  migration:
  - **on Supabase**, in Supabase's `extensions` schema, which already exists there;
  - **locally** (Docker Compose, `db:local`, CI), in `public`, because there is no `extensions`
    schema.

  Both are on the search path, so SQL never names the extension schema.
- Migrations are raw SQL in `src/migrations/`, named `<unit prefix>_<nn>_<what>.ts` so they sort in
  build order, for example `0010_01_create_schema.ts`. They are append-only: never edit one that
  has shipped. Each gets `(knex, { schema })`; table names stay unqualified and resolve through
  the search path. Knex's bookkeeping tables live in the schema too, with row-level security on.
- BIGINT comes back as a number, NUMERIC as a float, and DATE as a `YYYY-MM-DD` string.

## Deploying (Render and Supabase)

- Render builds the `Dockerfile`. The container runs `node dist/main.js`, which migrates under
  an advisory lock, then listens on `PORT`. Set the health check path to `/api/v1/health`.
- Set the environment variables above in Render; secrets live only there.
- `DATABASE_URL` is Supabase's **session pooler** URL (port 5432): the direct connection is IPv6
  only. Supabase requires TLS. With `sslmode=require`, node-pg also verifies the certificate, so
  give it Supabase's CA certificate (`sslrootcert`), or the connection is refused.
- Keep the `maqady` schema out of the Supabase Data API's exposed schemas.
- The service trusts one proxy hop for the client address; confirm on the first deploy that
  Render's `X-Forwarded-For` gives the real client.

## Layout

```
src/
  main.ts, app.module.ts, app.setup.ts   boot, root module, HTTP settings
  cli/                                   migrate and contract commands
  common/                                config, database, errors, logging, swagger, auth,
                                         idempotency, crypto, time, money, pagination,
                                         rate-limit, audit
  modules/<feature>/                     one Nest module per feature (health, messaging)
  migrations/                            raw SQL migrations
test/unit, test/integration, test/support
contracts/                               the generated OpenAPI contract (and the agreed drafts)
docs/                                    design, ADRs, per-unit specs and QA
```
