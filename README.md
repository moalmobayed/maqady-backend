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
| `FRONTEND_BASE_URL` | yes | Where email links point, for example `https://maqady.example`; no query, a trailing `/` is dropped |
| `EMAIL_DRIVER` | yes | `simulated` (every email recorded as sent, nothing leaves; local runs and CI) or `resend` ([ADR 0004](docs/adr/0004-email-through-resend.md)) |
| `RESEND_API_KEY`, `EMAIL_FROM` | with `resend` | The Resend API key (never logged) and the sender on the verified domain, `tickets@maqady.example` or `Maqady <tickets@maqady.example>` |
| `STORAGE_DRIVER` | yes | Where uploaded images go: `supabase` (every deployed environment) or `local` (development and tests). Required, no default |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | for `supabase` | The project URL (`https://<ref>.supabase.co`, no trailing slash) and the service role key, which never leaves the server |
| `STORAGE_BUCKET` | yes, optional | The public-read Supabase bucket. Default `media` |
| `LOCAL_STORAGE_DIR`, `LOCAL_STORAGE_PUBLIC_URL` | for `local`, optional | The directory the files go to (default `.media`, created on the first upload) and its public URL (default `http://localhost:<PORT>/media`) |
| `WS_CONNECTIONS_PER_IP`, `WS_SUBSCRIPTIONS_PER_CONNECTION` | yes, optional | The live seat map's limits: open WebSocket connections per client address (default 20) and showtimes one connection may subscribe to (default 3) |
| `RATE_LIMIT_DEFAULT`, `RATE_LIMIT_SIGN_IN_EMAIL`, … | yes, optional | `<count>/<window>` (window in `s`, `m` or `h`), for example `300/1m`. Unset means the design §10.6 default; `.env.example` lists all twelve |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` | `npm run admin:create` only | The first admin. The password must be 8 to 128 characters with a digit. Set them for the one run, then remove them; the service never reads them |
| `SEED_ADMIN_PASSWORD` | `npm run seed` only, optional | The seed admin's password (default `Maqady-seed-2026`, development only); it must meet the password policy |
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
- Admins read every message at `GET /api/v1/admin/messages` (the Message log); it shows the
  stored, redacted copies only.
- **Staff onboarding.** After the first admin, admins invite staff from the Staff screen
  (`POST /api/v1/admin/staff`): the invite email links to `FRONTEND_BASE_URL` +
  `/admin/set-password?token=…`, valid 72 hours. Staff "Forgot password" sends the same page a
  1-hour link. The link exists only in the email itself (never in the Message log), so with
  `EMAIL_DRIVER=simulated` an invite can't be completed by hand; tests read it from the recording
  sender.

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
| `npm run admin:create` | Migrates, then creates the first active admin from `BOOTSTRAP_ADMIN_*` unless an active admin exists. Safe to repeat; never prints the email or password |
| `npm run media:orphans` | Lists stored image files that no `images` row points to (older than an hour); `npm run media:orphans -- --delete` removes them. It only tidies up |
| `npm run seed` | Fills a development database with Cairo and Giza theaters, people and movies through the real admin API (see "Development seed"). Refuses production. Safe to repeat |
| `npm run db:local` | Starts a local PostgreSQL 16 cluster and creates `maqady_dev` and `maqady_test` |

## Development seed

`npm run seed` gives a local database something to show: the home page, the Movies and Theaters
pages and the admin dashboard.

- It refuses `NODE_ENV=production`, a `DATABASE_URL` that is not on this machine (localhost,
  `127.0.0.1`, `::1`, a Unix socket or a Docker Compose service name), `STORAGE_DRIVER` other
  than `local` and `EMAIL_DRIVER` other than `simulated`, so it never leaves an admin with a
  known password on a hosted database, writes to real storage or sends email.
- It boots the real app on `127.0.0.1` at a free port (migrating first), creates the seed admin
  `seed-admin@maqady.local` through `StaffService` if missing, signs in through
  `POST /api/v1/admin/auth/sessions` and drives the admin routes: validation, transactions,
  idempotency, audit rows and the image pipeline all apply. Sign in to the dashboard with the
  same account (password `SEED_ADMIN_PASSWORD`, default `Maqady-seed-2026`).
- What it adds: 6 theaters (5 published, Dokki left a draft) with weekly hours, some past
  midnight, a special date, prices, phones, facilities, a cover and gallery photos; 18 people with
  photos; 12 movies (7 Now showing, 4 Coming soon, 1 draft) with posters, stills (the first is the
  backdrop), two YouTube videos each and credits; 5 of them in the home carousel. Names, phones
  and emails are invented; release dates are relative to the day you run it. Pictures are
  generated placeholders that go through the real image pipeline into `LOCAL_STORAGE_DIR`; the
  videos are Blender Foundation open movies on YouTube, so the embeds play.
- It is idempotent: each step finds what exists by name or title and adds only what is missing,
  and prints `<step>: <n> created, <m> already there`. Run it again after a failure to finish.
- Steps live in `src/modules/seed/seed.steps.ts` (`SEED_STEPS`). Each published theater gets an
  active `Hall 1` (the standard layout) before `publish-theaters`, since a theater is published
  only with an active hall; showtimes go at the end, when that unit adds them.

## Dependencies

- Versions are pinned exactly (`.npmrc` sets `save-exact`), and `package-lock.json` is committed;
  CI and the image install with `npm ci`.
- NestJS stays on 11 (CommonJS) for now: NestJS 12 ships only as ES modules, which Jest loads
  from CommonJS only on Node 24.9+, and the suite must also run on Node 22 (design D-23).
- `overrides` moves `@nestjs/swagger`'s pinned `js-yaml` to 5.4.2, which fixes a YAML-parsing
  advisory. Drop the override once the Swagger version in use depends on a fixed `js-yaml`.
- The seat map runs on `@nestjs/websockets` and `@nestjs/platform-ws` (11.2.7, like the other
  Nest packages) with `ws` pinned to the version `platform-ws` itself depends on (8.21.2).
- `npm audit` reports a moderate advisory in `sprintf-js`, reached only through Jest's coverage
  tooling (dev only, no fix upstream). `npm audit --omit=dev` is clean.

## Tests

- **Unit** (`test/unit/`, mirroring `src/`): one unit at a time, collaborators mocked.
- **Integration** (`test/integration/`, mirroring `src/`): the real app through supertest, against
  the real `maqady_test` database. Nothing of ours is mocked; only genuinely external services
  (Resend, Supabase Storage) are replaced, at their adapter boundary: the suites store images
  with the local driver in a temporary directory, and the Supabase adapter is unit-tested with
  `fetch` mocked.
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
- `test/support/staff-auth.ts` gives admin-route tests real staff tokens: `staffSession(testApp,
  'admin')` creates an active member through `StaffService` and signs them in through
  `StaffAuthService`, returning `authorization` (`Bearer …`), the tokens and the ids;
  `createStaffMember()` and `signInStaff()` do one half each.
- `test/support/catalog.ts` builds catalog data through the real admin routes:
  `createPublishedMovie(testApp, admin, { status, genres, featuredPosition })`,
  `createDraftMovie()`, `createPerson()` and `genreId('drama')` (genres are seeded by migration
  and survive the per-suite reset).
- `test/support/theaters.ts` creates, prepares (hours and prices) and publishes theaters through
  the admin routes.
- `test/support/halls.ts` adds halls through the admin routes: `createHall()`,
  `setHallStatus()`, and `addActiveHall()`, which a theater needs before it can be published;
  `test/support/halls-probe.module.ts` adds a scripted layout participant beside the real ones
  (`HallLifecycleRegistry`).
- `test/support/showtimes.ts` schedules through the admin routes: `createSchedulingFixture()`
  (a theater open 12:00–01:00 with prices, an active hall, a Now showing movie) and
  `scheduleShowtime(testApp, admin, fixture, '2026-10-16', '19:30')`, plus `cancelShowtime()`.
  `test/support/showtimes/` holds our own implementations of the booking seams
  (`ScriptedTicketHolders`, `RecordingCancellation`) for `createTestApp({ overrides })`.
- `test/support/discovery.ts` reads the home-page draft as data: `schemaStructure()` compares a
  generated schema with the draft's, and `draftValidator('HomeResponse')` validates a real
  response against it (ajv).
- `test/support/messaging/one-time-link.ts`: `oneTimeTokenFrom(email.text, '/admin/set-password')`
  reads the token of a one-time link from an email the recording sender captured.
- `test/support/customer-auth.ts` does the same for customer routes: `registerCustomer(testApp)`
  registers a customer through `CustomerAuthService` (signed in, a verification email queued),
  `signInCustomer()` opens another session, `blockCustomer()` blocks through `CustomerService`,
  and `customerLinkToken(text, '/verify-email')` reads a link's token from an email the
  recording sender caught.
- `test/support/holds.ts` (U10) builds holds through the real routes:
  `bookableShowtime(testApp, admin)` (a published theater, its active hall with `SMALL_LAYOUT`,
  4 × 8 with `A1` a wheelchair space and `D8` a gap, a Now showing movie, a showtime on
  2026-10-11 at 19:30, so the suite's clock must be earlier), `holdSeats()` / `expectHold()`
  (`POST /showtimes/{id}/holds` as a guest, a customer, with a hold code or a key),
  `heldBookingIds()` (real booking ids for seams that take them), and `seatMapClient(testApp)`, a
  `ws` client on the listening app that waits for messages (`next()`, `closed()`), never for
  time. `test/support/seat-map-probe.module.ts` publishes a seat event in a transaction that
  rolls back.
- `test/support/routes.ts` lists every HTTP route with its declared access
  (`listHttpRoutes(testApp)`), so "every Admin route" tests cover new routes by themselves.
- Suites that stand in their own principal resolvers pass `overrides: REAL_RESOLVERS_OFF`
  (`foundations-probe.module.ts`): the registry takes one resolver per audience.
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
- **Credentials** (`modules/auth`, `CredentialsModule`): `PasswordService` (scrypt),
  `@IsAllowedPassword()`, `SessionService` (refresh-token sessions with rotation; call `refresh()`
  from a `@NoRequestTransaction()` route) and `OneTimeTokenService` (single-use links). Staff
  and customers (U9) pass their own lifetime and account check.
- **Staff** (`modules/staff`): `StaffService` reads members (`findById`, `findByEmail`, `list`).
  Invites, staff "Forgot password" and the set-password page are `StaffOnboardingService`'s,
  inside the module. `OneTimeTokenService.findLive()` reads a live link without using it, so a
  caller can lock the owner first and then `consume()` it (the staff lock order).
- **Images** (`modules/media`, `docs/gh-5-media/spec.md`). Import `MediaModule`. An upload route
  is `@Admin()`, `@Strict()` if it is a `POST`, and `@ImageUpload({ fields })`; it takes
  `@UploadedImage()` and returns `MediaService.upload({ kind, upload, actor, link })`, where
  `link(image)` writes the owner's row inside the upload's short transaction. Responses build
  pictures with `findByIds()` (one query) and `toImageResponse(image, alt)`; `delete()` removes
  the row now and the files after commit. Kinds: `poster` (2:3), `backdrop` (16:9, cropped),
  `person` (square, 600 × 600), `gallery` (any shape).
- **Customers** (`modules/customers`): `CustomerService` reads a customer (`findById`, or
  `findByIdForUpdate` to lock the row), blocks or unblocks one (`setStatus`, which signs a blocked
  customer out everywhere) and sends a password reset link (`issuePasswordReset`).
- **Catalog** (`modules/catalog`, `docs/gh-7-catalog/spec.md`). Import `CatalogModule` and read
  movies, genres, people and the carousel through `CatalogReadService` (public reads for
  discovery; `lockMovieForShare()` and `findMoviesByIds()` for scheduling); never query catalog
  tables. Refuse a movie's deletion by registering a blocker with
  `MovieLifecycleRegistry.addDeletionBlocker()` in `onModuleInit()`. Public responses reuse
  `GenreRefResponse` (`GenreRef`) and `VideoResponse` (`Video`, with `toVideoResponse()`).
- **Halls** (`modules/halls`, `docs/gh-6-halls/spec.md`). Import `HallsModule` and read halls and
  seat layouts through `HallReadService` (`findById`, `findLayout(s)`, `listByTheaters`, and
  `lockForShare()` after the showtime lock when scheduling or holding seats); never query hall
  tables. `hall-layout.ts` gives the seat list (`layoutSeats()`) and seat labels. Plug showtime
  rules in through `HallLifecycleRegistry` from `onModuleInit()`: deletion and retirement
  blockers, and layout participants (`beforeLock`, `blockingShowtimes` for `HALL_IN_USE`,
  `afterSave`). Seat maps reuse `HallLayoutResponse` (`HallLayout`, with
  `toHallLayoutResponse()`).
- **Showtimes** (`modules/showtimes`, `docs/gh-8-showtimes/spec.md`). Import `ShowtimesModule`
  and read showtimes through `ShowtimeReadService` (`findById(s)` in any status; `listScheduled`
  by movie or theater over up to 31 cinema dates; `nextScheduledPerMovie` for the ticker;
  `movieIdsScheduled`; `listUnendedInHall`), each a fixed number of queries; never query
  `showtimes`; `lockForShare(id)` locks one in a hold's transaction. Bookings plug in by
  replacing, in `ShowtimesModule`'s own `providers` (a binding made only in the bookings module
  has no effect: the module's own provider wins), the seams it binds to no-bookings defaults:
  `ShowtimeCancellationService` (refunds on cancel, U14) and `ShowtimeTicketHolderService` (whom
  a move notifies, U11). `ShowtimeSeatClaimService` (live claims behind `HALL_IN_USE`) is bound
  to seating's `SeatAvailabilityService` (U10).
  Public responses reuse `ShowtimePricesResponse` (`ShowtimePrices`, with
  `toShowtimePricesResponse()`).
- **Discovery** (`modules/discovery`, `docs/gh-9-home-and-browse/spec.md`): the public reads
  (`GET /home`, `/genres`, `/movies`, `/movies/{id}`, `/movies/{id}/similar`, `/people`,
  `/theaters`, `/theaters/{id}`) through the catalog and theater read services. The home ticker
  and the cards' `hallCount` come from `HomeTickerSource` and `TheaterHallCountSource`, whose
  defaults answer nothing until showtimes and halls exist; replace the provider in
  `DiscoveryModule` to fill them. `DiscoveryResponseMapper` builds `MovieCard` and
  `TheaterCard` for other public reads.

- **Seats and holds** (`modules/seating`, `modules/bookings`, `docs/gh-11-holds/spec.md`).
  Seating owns `seat_claims` and `hold_refusals` and depends on no feature module:
  `SeatClaimService.write({ now, claim?, release })` is the only way to claim or free seats (one
  `INSERT … ON CONFLICT` per showtime, showtime then label order, inside the open transaction,
  after the showtime, hall, principal and bookings are locked, design §7.1);
  `SeatAvailabilityService` answers the snapshot, taken counts and live-claim checks from the
  `Clock`; `SeatEventPublisher.publishAfterCommit()` is how a seat event reaches the map. Bookings
  owns `bookings` and `booking_seats`: `HoldsService` (create, claim, release),
  `BookingReadService.get(ref, access)` (owner, or a hold code while held; `NOT_FOUND` for anyone
  else), and `booking-status.sql.ts`, the one place the clock-derived statuses (§7.4) live, as
  code (`bookingStatusOf()`) and as SQL (`bookingStatusPredicate()`). A hold ends from its stored
  `hold_expires_at`; nothing runs when it does. `TransactionRepository.afterRollback()` runs work
  once a transaction rolled back (the refusal row of a refused hold).

## Live seat map

`ws://<host>/ws` (plain WebSocket, `@nestjs/platform-ws`, outside `/api/v1`), JSON messages
`{ "event", "data" }`, no sign-in: seat labels only, never who holds a seat (design §12).

| Direction | Event | Data |
|---|---|---|
| Client → server | `subscribe` | `{ showtimeId }`: answered with a `snapshot`, then live events. Again for the same showtime: a fresh snapshot |
| Client → server | `unsubscribe` | `{ showtimeId }` |
| Server → client | `snapshot` | `{ showtimeId, serverTime, seats: [{ label, state: "held" \| "booked", heldUntil? }] }` (taken seats only, by label; `heldUntil` on held seats) |
| Server → client | `seat.held` | `{ showtimeId, labels, heldUntil }` |
| Server → client | `seat.released` | `{ showtimeId, labels }` (a released or replaced hold) |
| Server → client | `seat.booked` | `{ showtimeId, labels }` (from checkout and the box office, U11 and U13) |
| Server → client | `error` | `{ code }`: `VALIDATION_FAILED` (a `showtimeId` that is not a positive integer), `RATE_LIMITED` (a 4th subscription; the connection stays), `FORBIDDEN` (origin) |

- The `Origin` header must be one of `CORS_ORIGINS`; otherwise `error FORBIDDEN` and close
  `1008`. More than `WS_CONNECTIONS_PER_IP` open connections from one address: `error
  RATE_LIMITED` and close `1013`. A message over 4 KB closes the socket (`1009`); messages that
  are not JSON or name an unknown event are ignored.
- An expiry is never announced: free a held seat when its `heldUntil` passes, correcting the
  client's clock with `serverTime`. Events are sent only after the transaction that caused them
  commits; a reconnect must subscribe again and gets a fresh snapshot.
- The server pings every 30 seconds and drops a client that did not answer the previous ping.

```bash
npx wscat -c ws://localhost:3000/ws -H 'Origin: http://localhost:5173'
> {"event":"subscribe","data":{"showtimeId":81}}
```

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
- **First admin.** Once, from a Render shell (or any machine that reaches the database), with
  `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` and `BOOTSTRAP_ADMIN_PASSWORD` set for that
  command only: `npm run admin:create`. It prints `Created admin #<id>` or that an active admin
  already exists. Sign in at `/admin/login`; the admin can change the password later through
  "Forgot password".
- `DATABASE_URL` is Supabase's **session pooler** URL (port 5432): the direct connection is IPv6
  only. Supabase requires TLS. With `sslmode=require`, node-pg also verifies the certificate, so
  give it Supabase's CA certificate (`sslrootcert`), or the connection is refused.
- Keep the `maqady` schema out of the Supabase Data API's exposed schemas.
- **Image storage.** Set `STORAGE_DRIVER=supabase`, `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API keys; keep it secret). Create the bucket
  (`STORAGE_BUCKET`, default `media`) once, as a **public** bucket, in Storage → New bucket; the
  API returns its public URLs and the browser loads images from them. Never use `local` on
  Render: its disk is wiped on every deploy.
- The service trusts one proxy hop for the client address; confirm on the first deploy that
  Render's `X-Forwarded-For` gives the real client.

## Layout

```
src/
  main.ts, app.module.ts, app.setup.ts   boot, root module, HTTP settings
  cli/                                   migrate, contract, admin:create, media:orphans and
                                         seed commands
  common/                                config, database, errors, logging, swagger, auth,
                                         idempotency, crypto, time, money, pagination,
                                         rate-limit, audit
  modules/<feature>/                     one Nest module per feature: health, messaging, auth
                                         (credentials), staff, media, theaters, catalog,
                                         customers, halls, discovery, showtimes, seating (seat
                                         claims and the /ws seat map), bookings (holds), seed
                                         (the development seed)
  migrations/                            raw SQL migrations
test/unit, test/integration, test/support
contracts/                               the generated OpenAPI contract (and the agreed drafts)
docs/                                    design, ADRs, per-unit specs and QA
```
