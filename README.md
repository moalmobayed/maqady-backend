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
cp .env.example .env          # local defaults; then fill in the four secrets:
#   JWT_SECRET_CUSTOMER, JWT_SECRET_STAFF, DATA_ENCRYPTION_KEY and QR_SIGNING_KEY, each
#   from openssl rand -base64 32   (all four must differ)

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
| `QR_SIGNING_KEY` | yes | Signs ticket QR codes: base64 of at least 32 bytes, different from the JWT secrets and the encryption keys. Rotating it voids every issued QR code. Generate with `openssl rand -base64 32` |
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
| `SEED_DATASET` | `npm run seed` and `seed:remote`, optional | `demo` (default: invented data, generated pictures) or `egypt-2026` (real films, people and cinemas; pictures downloaded). See "Development seed" |
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
| `npm run seed` | Fills a development database with Cairo and Giza theaters, halls, people, movies and a week of showtimes through the real admin API (see "Development seed"). Refuses production. Safe to repeat |
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
- What the default `demo` dataset adds: 6 theaters (5 published, Dokki left a draft) with weekly
  hours, some past midnight, a special date, prices, phones, facilities, a cover and gallery photos;
  18 people with photos; 12 movies (7 Now showing, 4 Coming soon, 1 draft) with posters, stills (the
  first is the backdrop), two YouTube videos each and credits; 5 of them in the home carousel;
  showtimes over the 7 cinema days from today in each published theater's hall (13:30, 16:15, 19:00
  and 21:45, plus an after-midnight slot at Downtown and New Cairo on their late Thursday and Friday
  nights), so the ticker, the movie and theater showtime lists and the show-date filter have data.
  Names, phones and emails are invented; release dates are relative to the day you run it. Pictures
  are generated placeholders that go through the real image pipeline into `LOCAL_STORAGE_DIR`; the
  videos are Blender Foundation open movies on YouTube, so the embeds play.
- It is idempotent: each step finds what exists by name or title and adds only what is missing,
  and prints `<step>: <n> created, <m> already there`. Run it again after a failure to finish.
- Steps live in `src/modules/seed/seed.steps.ts` (`SEED_STEPS`). Each published theater gets an
  active `Hall 1` (the standard layout) before `publish-theaters`, since a theater is published
  only with an active hall. `showtimes` runs last: it reads each theater's admin timeline,
  keeps the slots already scheduled, dry-runs the missing dates and creates only the `available`
  ones, so a started slot or a night whose hours don't fit is simply skipped.

### The real dataset: `SEED_DATASET=egypt-2026`

```bash
SEED_DATASET=egypt-2026 npm run seed          # this machine
SEED_DATASET=egypt-2026 npm run seed:remote   # a deployed environment (below)
```

Real Egyptian cinema as it stood on 2026-10-29, instead of the invented demo. Seed it into an
empty database: the two datasets don't share names, so seeding one over the other mixes them.

- **13 Egyptian films of 2026**: 9 Now showing (Naseeb, Matloub Aaeleyan, Wala Kan Ala El-Bal,
  Saqr w Kanarya, El Gawahergy in the carousel; Mahmoud El Tany, Red Flag, Shish Doo, Khally
  Balak Min Nafsak) and 4 Coming soon (Hadoota, Leila Bazet Khales, Crypto, Mamsos), with their
  real synopsis, genres, censor rating, release date, official poster, stills, official YouTube
  trailers and teasers (checked by hand), cast and crew.
- **118 people** credited on them, with their photo, bio, birthplace and nationality where
  elCinema publishes them. It publishes no birth dates.
- **8 cinemas** in Cairo and Giza (VOX City Centre Almaza, City Stars, Cairo Festival Scene,
  Cosmos, Galaxy El Manyal, VOX Mall of Egypt, Galaxy Cineplex Mall of Arabia, Cairo Mall),
  with their address, map position, phones, standard ticket price, as many halls as they ran at
  once, and the 238 showtimes they actually ran that day, repeated on each of the 7 days.
- **Sources**: elCinema.com for the films, people, cinemas, showtimes and pictures; YouTube for
  the videos; The Numbers and Arabic Wikipedia for two runtimes; the Egyptian press for two
  release dates. Each movie's comment in `src/modules/seed/datasets/egypt-2026.ts` names its
  sources.
- **Estimates**: runtimes are mostly unpublished, so five are estimated from how often the
  cinemas repeat the film, and Shish Doo, El Gawahergy and the Coming soon films have a 110
  minute placeholder. Mamsos's release date is estimated (the press says December 2026).
  Opening hours run from each cinema's first show to its last; facilities are by venue type;
  zone prices all equal the standard ticket.
- **Pictures** are downloaded from their sources when the seed runs (allow a few minutes, and
  network access to `media0106.elcinema.com` and `i.ytimg.com`). Each is cropped to the
  pipeline's size around its most salient part. They belong to their owners: use this dataset
  for staging and demos, not for a public launch.
- To refresh it, add a dataset beside it in `src/modules/seed/datasets/` and register it in
  `SEED_DATASETS`. `test/unit/modules/seed/datasets/index.test.ts` checks every dataset against
  the catalog limits, its own references, the opening hours and the 20-minute cleaning gap.

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
- `test/support/discovery-showtimes.ts`: `buildShowtimeWorld(testApp, admin, clock)` sets up,
  through the admin routes, two active theaters, a draft and a paused one, and showtimes on
  Friday 16 October 2026 and after (ended, running, cancelled, after midnight, outside the
  7 days), then sets the clock to `WORLD_NOW` (18:00) for the discovery suites.
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
- `test/support/admin-bookings.ts` (U14): `paidOnline(testApp, showtimeId, seats)` (a new
  customer's booking paid by card), `listAdminBookings()`, `refundBooking()`, `payOutRefund()`,
  `previewEdit()` and `editBooking()` through the real admin routes.
- `test/support/admin-customers.ts` (U15): `listAdminCustomers()`, `getAdminCustomer()`,
  `updateAdminCustomer()`, `anonymiseCustomer()`, `requestCustomerReset()` through the real admin
  routes, and `paidBookingOf(testApp, customer, showtimeId, seats)` (an existing customer's
  booking paid by card).
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
- **Discovery** (`modules/discovery`, `docs/gh-9-home-and-browse/spec.md`,
  `docs/gh-9-discovery-showtimes/spec.md`): the public reads (`GET /home`, `/genres`, `/movies`
  with the `showDate` filter, `/movies/{id}` with its side panel, `/movies/{id}/showtimes`,
  `/movies/{id}/similar`, `/people`, `/theaters`, `/theaters/{id}` with its halls,
  `/theaters/{id}/showtimes`) through the catalog, theater, hall and showtime read services. The
  home ticker and the cards' `hallCount` come from `HomeTickerSource` (bound to
  `ShowtimesTickerSource`) and `TheaterHallCountSource` (`ActiveHallCountSource`).
  `ShowtimeBrowseService` answers a movie's and a theater's showtimes over 7 cinema days (only
  scheduled, of active theaters and Now showing movies, grouped by cinema date).
  `DiscoveryResponseMapper` builds `MovieCard`, `TheaterCard` and `PublicShowtime` for other
  public reads.

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
| Client → server | `subscribe` | `{ showtimeId }`: answered with a `snapshot`, then live events. Again for the same showtime: a fresh snapshot (one, however many arrive while it is read) |
| Client → server | `unsubscribe` | `{ showtimeId }` |
| Server → client | `snapshot` | `{ showtimeId, serverTime, seats: [{ label, state: "held" \| "booked", heldUntil? }] }` (taken seats only, by label; `heldUntil` on held seats) |
| Server → client | `seat.held` | `{ showtimeId, labels, heldUntil }` |
| Server → client | `seat.released` | `{ showtimeId, labels }` (a released or replaced hold) |
| Server → client | `seat.booked` | `{ showtimeId, labels }` (from checkout and the box office, U11 and U13) |
| Server → client | `error` | `{ code }`: `VALIDATION_FAILED` (a `showtimeId` that is not a positive integer), `RATE_LIMITED` (a 4th subscription, or more snapshots from one address than `RATE_LIMIT_DEFAULT` allows; the connection stays), `FORBIDDEN` (origin) |

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

## Checkout and tickets

A signed-in customer pays for their hold with `POST /api/v1/bookings/{ref}/payments`
(`Idempotency-Key` required: a new one per press of Pay), sending a **test token** and no card
data. The simulated provider decides the result from the token alone; no money moves.

| Token | Method | Result | Recorded |
|---|---|---|---|
| `sim_card_visa` | `card` | succeeded | Visa •••• 4242 |
| `sim_card_mastercard` | `card` | succeeded | Mastercard •••• 4444 |
| `sim_card_meeza` | `card` | succeeded | Meeza •••• 0011 |
| `sim_card_declined` | `card` | declined (a `201`; the hold stays payable) | Visa •••• 0002 |
| `sim_card_slow` | `card` | `processing`, succeeded 10 s later | Visa •••• 3184 |
| `sim_card_slow_declined` | `card` | `processing`, declined 10 s later | Visa •••• 0341 |
| `sim_wallet_apple_pay`, `sim_wallet_google_pay` | `wallet` | succeeded | the wallet |
| `sim_wallet_cancelled` | `wallet` | cancelled (the customer closed the wallet; not a decline) | Apple Pay |

- A success confirms the booking, sells its seats (`seat.booked` on the seat map) and queues the
  tickets email, plus an SMS when the customer has a phone. Pressing Pay again is `ALREADY_PAID`;
  the same key replays the first answer.
- A slow payment is settled from its stored `settles_at` by the next request that reads or writes
  the booking or its showtime (`@SettleFirst()` routes, `SettlementService`), never by a timer:
  poll `GET /bookings/{ref}` after `payment.settlesAt`. Until then the seats stay held, the hold
  cannot be released or replaced (`PAYMENT_IN_PROGRESS`), and the hold lasts at least until
  `settlesAt + 30 s`.
- `GET /bookings/{ref}` of a confirmed booking has `ticket.qrCode`, the signed payload to draw as
  a QR code. The tickets email links to `${FRONTEND_BASE_URL}/ticket?token=<payload>`, a frontend
  page that draws it; the Message log shows that link as `[one-time link hidden]`.
- `GET /bookings/{ref}/ticket.pdf` and `/calendar.ics` (owner, with the `Authorization` header)
  download the PDF ticket and the calendar file.

```bash
curl -s -X POST localhost:3000/api/v1/bookings/MQ-7K3P9Q/payments \
  -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' -d '{"method":"card","token":"sim_card_visa"}'
curl -s -o ticket.pdf localhost:3000/api/v1/bookings/MQ-7K3P9Q/ticket.pdf -H "Authorization: Bearer $TOKEN"
```

## My bookings

The signed-in customer's own bookings (U12, `docs/gh-13-customer-bookings/spec.md`):

- `GET /api/v1/me/bookings?tab=upcoming|past` pages a tab with `tabCounts` for the tab labels.
  Upcoming is every confirmed booking whose showtime has not ended; Past is completed, refunded
  and failed ones. Both are decided at read time against the `Clock` (no job), so a test moves a
  `TestClock` to see a booking change tab, and signs in again when it moves past the access
  token's life.
- `GET /api/v1/bookings/{ref}` also shows `seatLines`, `refund` and the theater's address and
  coordinates; `GET /api/v1/bookings/{ref}/history` is its History from the audit log.
- `POST /api/v1/bookings/{ref}/ticket-deliveries` ("Email again", `Idempotency-Key` required)
  queues the tickets email to the account email; `RATE_LIMIT_TICKET_EMAIL` (3 an hour) counts per
  booking and signed-in customer. `test/support/my-bookings.ts` has `paidBooking()`,
  `listMyBookings()`, `bookingHistory()` and `emailAgain()` for integration tests.

```bash
curl -s "localhost:3000/api/v1/me/bookings?tab=past&limit=5" -H "Authorization: Bearer $TOKEN"
curl -s -X POST localhost:3000/api/v1/bookings/MQ-7K3P9Q/ticket-deliveries \
  -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)"
```

## Box office and ticket scanning

Both staff roles sell at the counter and scan tickets (U13, `docs/gh-14-box-office/spec.md`).

- `POST /api/v1/admin/counter-holds` (`{ showtimeId, seats }`, `Idempotency-Key` required) holds
  seats for 5 minutes exactly like an online hold, through the same claim statement, so a seat is
  never sold twice across the website and the counter. A member has one live counter hold; a new
  one releases the previous one, and `DELETE /api/v1/admin/counter-holds/{ref}` releases it.
- `POST /api/v1/admin/bookings/{ref}/counter-payments` (`Idempotency-Key` required) records `cash`
  or `card_terminal` with the terminal's `receiptReference`, and the customer: `walk_in`,
  `existing` (`customerId`) or `contact` (`fullName`, optional `email` and `phone`). It confirms
  the booking at once and sends the tickets to any email or phone given. Only the member who made
  the hold can sell or release it.
- `GET /api/v1/admin/bookings/{ref}/ticket.pdf` gives staff any booking's PDF ticket (a walk-in
  has no email); each download is recorded in the activity log.
- `POST /api/v1/admin/scans` takes `{ theaterId, code }` (the QR text) or
  `{ theaterId, reference, confirm }` (typed by hand) and always answers `200` with a `result`:
  `VALID`, `ALREADY_USED` (with the first `checkedInAt`), `WRONG_SHOWTIME`, `NOT_VALID`,
  `NOT_FOUND` or `CONFIRM_REQUIRED`. Scanning opens 60 minutes before the start and closes at the
  end. A typed reference admits only on a second request with `confirm: true`.

```bash
curl -s -X POST localhost:3000/api/v1/admin/counter-holds -H "Authorization: Bearer $STAFF" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"showtimeId":81,"seats":["F7","F8"]}'
curl -s -X POST localhost:3000/api/v1/admin/bookings/MQ-7K3P9Q/counter-payments \
  -H "Authorization: Bearer $STAFF" -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"method":"card_terminal","receiptReference":"TRX-0042817","customer":{"kind":"walk_in"}}'
curl -s -X POST localhost:3000/api/v1/admin/scans -H "Authorization: Bearer $STAFF" \
  -H 'Content-Type: application/json' -d '{"theaterId":3,"code":"MQ1.MQ-7K3P9Q.1.…"}'
```

## Admin bookings

The admin Bookings page (U14, `docs/gh-15-admin-bookings/spec.md`). Both staff roles read and
annotate; refunds, payouts and edits are admin only.

- `GET /api/v1/admin/bookings` lists bookings newest first with `q` (a reference, or part of the
  contact name, email or phone), `theaterId`, `movieId`, `status`, `channel`, `method`,
  `dateFrom` and `dateTo` (cinema dates the booking was made on), and `customerId` (U15). `GET /admin/bookings/summary`
  gives the four cards; `GET /admin/bookings/{ref}` the detail with every payment and refund, the
  customer card and the activity log.
- `GET` / `POST /api/v1/admin/bookings/{ref}/notes` are internal notes (no customer route ever
  shows them); `POST /admin/bookings/{ref}/ticket-deliveries` resends the tickets by email and SMS.
- `POST /api/v1/admin/bookings/{ref}/refunds` cancels and refunds in full, each charge on its own
  rail: card and wallet through the simulated provider at once, cash and card terminal as a
  `pending` refund that `POST /admin/refunds/{id}/payouts` records as handed back.
- `POST /api/v1/admin/bookings/{ref}/edit-previews` and `/edits` move a booking to other seats or
  another showtime of the same movie, or change its contact, with a `reason`. A lower total is
  refunded automatically; a higher one needs `payment` (`cash` or `card_terminal`) in the same
  request. The old QR code stops working.
- `GET /api/v1/admin/showtimes/{id}/cancellation-preview` shows what cancelling a showtime would
  refund and send; `PATCH /admin/showtimes/{id}` with `status: cancelled` then refunds every
  booking, releases every hold and emails and texts every ticket holder.

```bash
curl -s "localhost:3000/api/v1/admin/bookings?q=nadia&status=confirmed" -H "Authorization: Bearer $STAFF"
curl -s -X POST localhost:3000/api/v1/admin/bookings/MQ-7K3P9Q/edit-previews -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"seats":["B5","B6"],"reason":"customer_request"}'
curl -s -X POST localhost:3000/api/v1/admin/bookings/MQ-7K3P9Q/refunds -H "Authorization: Bearer $ADMIN" \
  -H "Idempotency-Key: $(uuidgen)"
```

## Admin customers

The admin Customers page (U15, `docs/gh-16-admin-customers/spec.md`), in the `admin-customers`
module. Both staff roles read; edits, block and unblock, the reset email and "Delete account" are
admin only.

- `GET /api/v1/admin/customers` lists live customers newest first with `q` (part of the name,
  email or phone) and `status` (`active`, `blocked`). Each row has `stats`: Bookings (paid and not
  refunded), Spent, No-shows (a show that ended, never scanned at the entrance) and Last booking.
  `GET /admin/customers/{id}` adds the 4 newest bookings; `GET /admin/bookings?customerId=` pages
  all of them.
- `PATCH /api/v1/admin/customers/{id}` edits `fullName`, `email` (a new address is unverified and
  its old links stop working) and `phone`, and `status: blocked` signs the customer out everywhere
  (`ACCOUNT_BLOCKED` on sign-in and refresh); `status: active` unblocks.
- `POST /api/v1/admin/customers/{id}/password-reset-requests` (strict) emails a 1-hour reset link;
  a blocked customer is `CUSTOMER_BLOCKED`.
- `DELETE /api/v1/admin/customers/{id}` anonymises the customer in one transaction (design §21):
  name, email, phone and password gone, the contact on their bookings cleared, their sessions,
  links, idempotency keys, messages and the notes on their bookings deleted; bookings and payments
  stay. The answer counts what was kept and removed.

```bash
curl -s "localhost:3000/api/v1/admin/customers?q=layla&status=active" -H "Authorization: Bearer $STAFF"
curl -s -X PATCH localhost:3000/api/v1/admin/customers/42 -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"status":"blocked"}'
curl -s -X POST localhost:3000/api/v1/admin/customers/42/password-reset-requests \
  -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $(uuidgen)"
curl -s -X DELETE localhost:3000/api/v1/admin/customers/42 -H "Authorization: Bearer $ADMIN"
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

## Deploying to Vercel (staging, no card)

Staging runs on Vercel's free Hobby plan, which needs no payment card. `vercel.json` makes the
compiled `dist/main.js` the entrypoint (Vercel's NestJS runtime runs it as one function and
handles its `listen()`) and pins the function to Frankfurt (`fra1`), next to the database.

- Import the repository in Vercel, then set **Settings → Git → Production Branch** to the branch
  to deploy (today `main-jf8hqi`) and redeploy.
- Environment variables: the same as Render's (below), with these differences: Vercel has no
  generated secrets, so set the four secrets yourself (`openssl rand -base64 32` each); end
  `DATABASE_URL` with `?sslmode=no-verify` (the CA file in `certs/` is not part of a Vercel
  function, so the connection is encrypted but the server is not verified: a follow-up); and set
  `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` and `BOOTSTRAP_ADMIN_PASSWORD`, because there is
  no shell: on boot, after migrating, the app creates the first admin when none exists.
- Vercel ships only the files it traces from the entrypoint, which is why migrations run from the
  static list in `src/common/database/migration-list.ts`: add each new migration there too (a
  unit test fails when the list and `src/migrations/` differ).
- On Vercel (`VERCEL=1`), `src/main.ts` starts a plain HTTP server at once, which Vercel's launcher captures (it waits only a second for `listen()`), and boots the app on the first request of each instance. That first request migrates (a no-op when up to date) and checks the first admin, so it takes a few seconds. A boot that fails, or runs past 20 seconds, answers 503 and logs `Boot failed` or the step it is on; every step logs a `Boot: …` line.

## Deploying (Render and Supabase)

Staging is described by `render.yaml`, a Render Blueprint: Render → New → Blueprint → this
repository. Render builds the `Dockerfile`, generates the four secrets (`JWT_SECRET_CUSTOMER`,
`JWT_SECRET_STAFF`, `DATA_ENCRYPTION_KEY`, `QR_SIGNING_KEY`) itself, and asks for the values
marked `sync: false`:

- `DATABASE_URL`: Supabase → Connect → **Session pooler** URI (port 5432; the direct connection
  is IPv6 only), with the database password in place of `[YOUR-PASSWORD]` and this suffix, so
  node-pg verifies Supabase's certificate against the CA in `certs/`:
  `?sslmode=verify-full&sslrootcert=/app/certs/supabase-prod-ca-2021.crt`.
  If the first deploy logs a certificate error, use `?sslmode=no-verify` instead: still
  encrypted, but the server is not verified. Record that as a follow-up.
- `SUPABASE_URL` (`https://<ref>.supabase.co`) and `SUPABASE_SERVICE_ROLE_KEY` (Project
  Settings → API Keys → Legacy API keys → `service_role`; it never leaves the server).
- `BOOTSTRAP_ADMIN_PASSWORD`: the first admin's password (policy: 8+ characters with a digit).

Notes:

- The container migrates, creates the first admin from `BOOTSTRAP_ADMIN_*` when no active admin
  exists (`admin:create`, idempotent, so it is harmless on every boot), then listens on `PORT`.
  The health check path is `/api/v1/health`.
- **Image storage.** Create the bucket (`STORAGE_BUCKET`, default `media`) once, as a **public**
  bucket, in Supabase → Storage → New bucket; the API returns its public URLs and the browser
  loads images from them. Never use `local` on Render: its disk is wiped on every deploy.
- Keep the `maqady` schema out of the Supabase Data API's exposed schemas.
- Staging sends no email (`EMAIL_DRIVER=simulated`) until a domain is verified in Resend
  (ADR 0004). Add the frontend's origins to `CORS_ORIGINS` in Render when they change.
- The service trusts one proxy hop for the client address; confirm on the first deploy that
  Render's `X-Forwarded-For` gives the real client.
- The free instance sleeps after 15 minutes idle; the first request then takes up to a minute.

### Seeding a deployed environment

`npm run seed:remote` fills a deployed environment with the development seed through its own
admin API, so the server stores the images and no database URL or storage key is needed
locally. It reads only these variables, never `.env`, and refuses plain http except on this
machine:

```bash
SEED_API_URL=https://<service>.onrender.com/api/v1 \
SEED_ADMIN_EMAIL=staging-admin@maqady.local \
SEED_ADMIN_PASSWORD='<BOOTSTRAP_ADMIN_PASSWORD>' \
SEED_DATASET=egypt-2026 \
npm run seed:remote
```

It is idempotent, so it can run again. Never run it against production. The **Seed staging**
workflow runs it from Actions, with the dataset as an input.

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
                                         claims and the /ws seat map), bookings (holds,
                                         checkout, box office, admin bookings), seed
                                         (the development seed)
  migrations/                            raw SQL migrations
test/unit, test/integration, test/support
contracts/                               the generated OpenAPI contract (and the agreed drafts)
docs/                                    design, ADRs, per-unit specs and QA
```
