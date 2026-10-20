---
title: U0 — Scaffold the NestJS app, Swagger, CI and deploy files
owner: Mohamed Tarek
status: In progress
last_verified: 2026-10-20
tags: [scaffold, nestjs, config, logging, errors, database, swagger, health, ci, docker]
---

# U0 — Scaffold the NestJS app, Swagger, CI and deploy files

Issue: #1. Design: `docs/system-design.md` §5, §6.1, §10.7, §14, §16, §19.

## Goal

A NestJS service that boots against Postgres, migrates itself, logs safely, answers every
error in one shape, publishes its OpenAPI contract, and passes the CI gates. Every later unit
builds on these pieces instead of re-deciding them.

## Scope

- Hand-initialised Nest project: `package.json`, strict `tsconfig`, `nest-cli.json` (no spec
  files), ESLint flat config with typescript-eslint, Prettier, `src/main.ts`, `src/app.module.ts`.
- `common/config`, `common/logging`, `common/errors`, `common/database`, `common/swagger`.
- The `health` module.
- Jest unit and integration projects, the test-app helper, and the tests listed below.
- `docker-compose.yml`, `Dockerfile`, `.dockerignore`, `.gitignore`, `.env.example`, CI, README.

## Out of scope

Guards and access decorators, rate limiting, the write interceptor and idempotency, the
`Clock` and time helpers, and the rest of the error catalogue all belong to U1. The Render
deploy and its `X-Forwarded-For` check need the owner's Render account, so they wait until
the owner deploys (see follow-ups in the unit report).

## Decisions taken here

| Decision | Why |
|---|---|
| **NestJS 11 on CommonJS**, TypeScript 6.0, Jest 30 with ts-jest 29 | NestJS 12 ships only as ES modules. Jest 30 loads ES-module-only packages from CommonJS only on Node 24.9+, and the suite must also run on Node 22. NestJS 11 is still maintained. Move to 12 once the minimum Node version is 24.9 or later. ts-jest supports TypeScript below 7. |
| `AppError(code, message, details?, options?)`, with the HTTP status taken from the catalogue | One code always has one status, so no call site can pair them wrongly. Design §14.3 is updated to match. |
| Starter catalogue adds `PAYLOAD_TOO_LARGE` (413) | The 1 MB body limit needs an honest status. |
| `search_path` is `<DB_SCHEMA>, extensions, public` | Supabase keeps extensions in `extensions`; plain Postgres keeps them in `public`. Postgres skips schemas that don't exist, so one setting works in both places. |
| Migrations are recorded without file extensions, and get the schema name as a second argument | Tests run the `.ts` sources and production runs the compiled `.js` files, so both record the same names. |
| Knex's bookkeeping tables live in `DB_SCHEMA`, with row-level security on | `public` is exposed by Supabase's Data API. |
| `DATE` columns come back as `YYYY-MM-DD` strings; sessions run in UTC | node-pg turns `DATE` into a local-midnight `Date`, which shifts the day. UTC keeps `now()` and casts the same on a laptop as on Supabase. |
| Knex error messages never include bound values (`compileSqlOnError: false`) | Values can be personal data, and error messages reach the logs. |
| `Retry-After` is an exposed CORS header | Otherwise the browser can't read it on a `429`. Design §10.7 is updated. |
| Operation ids are the controller method names, checked for uniqueness when the document is built | Gives the frontend stable client function names, such as `getHealth`. |
| DTO class names are the OpenAPI schema names, for example `HealthResponse` and `ErrorResponse` | The generated contract keeps the names agreed in `contracts/drafts/home-page.openapi.yaml`. |

## Modules and files

```
src/
  main.ts                      boot: config → app → migrations → listen
  app.module.ts                AppModule.forRoot({ config }) and the global pipe and filter
  app.setup.ts                 configureApp(): prefix, helmet, CORS, body limit, proxy, Swagger
  app.types.ts                 AppModuleOptions
  cli/migrate.ts               npm run migrate
  cli/contract.ts              npm run contract
  migrations/0010_01_create_schema.ts
  common/config/               loadConfig(), AppConfig, ConfigModule (APP_CONFIG)
  common/logging/              nestjs-pino params, correlation ids, error serializer
  common/errors/               AppError, catalogue, ErrorResponse DTO, filter, validation factory
  common/database/             KNEX provider, pg type parsers, migration source and repository
  common/swagger/              document builder, ApiErrorResponses(), security scheme names
  modules/health/              enums, types, dto, repository, service, controller, module
test/
  unit/…                       mirrors src/
  integration/…                mirrors src/
  support/                     test config, test app, database reset, global setup
scripts/db-local.sh            starts local Postgres and creates the two databases
docker/postgres/init/          creates maqady_test on first start
```

## Configuration

Validated at boot by `loadConfig(process.env)`. A missing or malformed value stops the start,
and the error names the variable but never echoes its value.

| Variable | Rule | Default |
|---|---|---|
| `DATABASE_URL` | `postgres://` or `postgresql://` URL | required |
| `DB_SCHEMA` | lower-case SQL identifier | required (`maqady`) |
| `CORS_ORIGINS` | comma-separated origins (`scheme://host[:port]`) | required |
| `PORT` | 1–65535 | `3000` |
| `LOG_LEVEL` | `fatal` `error` `warn` `info` `debug` `trace` `silent` | `info` |

`.env.example` also lists the variables later units validate: `JWT_SECRET_CUSTOMER`,
`JWT_SECRET_STAFF`, `QR_SIGNING_KEY`, `DATA_ENCRYPTION_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET`, `FRONTEND_BASE_URL`, `RESEND_API_KEY` and
`EMAIL_FROM`. The rate-limit variables are named by U1. Tests use `TEST_DATABASE_URL`, and
refuse a database whose name doesn't end in `_test`.

## Database

- One Knex instance (`pg`). The pool holds 0–5 connections, with a 5 s connect timeout and a
  10 s acquire timeout. Each new connection runs `SET statement_timeout = '10s'`,
  `SET idle_in_transaction_session_timeout = '15s'` and `SET TIME ZONE 'UTC'`.
- Type parsers: `BIGINT` → safe-integer number (an unsafe value throws), `NUMERIC` → float,
  `DATE` → string, and the array forms of all three.
- Migrations run at boot before `listen`, and through `npm run migrate`. The runner creates
  `DB_SCHEMA` if it is missing, then runs `knex.migrate.latest()` under Knex's lock.

**Migration `0010_01_create_schema`**

- `CREATE SCHEMA IF NOT EXISTS <schema>`.
- Creates `citext`, `pg_trgm` and `btree_gist` if missing: in schema `extensions` when it
  exists (Supabase), otherwise in `public`.
- Enables row-level security on `knex_migrations` and `knex_migrations_lock`.
- `down` refuses: rolling back the base migration would drop every table.

## Endpoints

Both are public and send `Cache-Control: no-store`. Shapes match
`contracts/drafts/home-page.openapi.yaml`.

| Route | Success | Errors |
|---|---|---|
| `GET /api/v1/health` (`getHealth`) | `200 {"status":"ok"}`, with no database call | `500 INTERNAL` |
| `GET /api/v1/health/ready` (`getReadiness`) | `200 {"status":"ok"}` after `SELECT 1` | `503 SERVICE_UNAVAILABLE`, `500 INTERNAL` |

Swagger UI is served at `/api/docs` and the JSON document at `/api/docs/openapi.json`.
`npm run contract` writes `contracts/openapi.yaml`.

## Errors

Every error body is
`{ "error": { "code", "message", "details", "correlationId" } }`, where `correlationId`
equals the `X-Request-Id` response header.

| Source | Code (status) | `details` |
|---|---|---|
| `AppError` | its code (status from the catalogue) | as thrown |
| Global `ValidationPipe` | `VALIDATION_FAILED` (400) | `{ "fields": [{ "field": "seats.0.label", "messages": ["…"] }] }` |
| Other `400` (malformed JSON, parse pipes) | `VALIDATION_FAILED` (400) | `null` |
| Unknown route | `NOT_FOUND` (404) | `null` |
| Nest `401` / `403` | `UNAUTHENTICATED` (401) / `FORBIDDEN` (403) | `null` |
| Body over 1 MB | `PAYLOAD_TOO_LARGE` (413) | `null` |
| Throttling (`429`) | `RATE_LIMITED` (429), always with `Retry-After` | `null` |
| Database unreachable, pool timeout, SQLSTATE class 08, `57P01`–`57P03`, `53300` | `SERVICE_UNAVAILABLE` (503) | `null` |
| Unhandled `23505` / `23P01` | `CONFLICT` (409) | `{ "constraint": "…" }` |
| Anything else | `INTERNAL` (500), logged with its stack | `null` |

Postgres errors are logged by SQLSTATE and constraint only. Their message and detail are
dropped, because they can carry values.

## Logging

pino via nestjs-pino. The request id comes from `X-Request-Id` when it is a UUID, otherwise
it is a new UUID. It is echoed in the response header and in error bodies, and every log line
carries it as `correlationId`. There is one line per request, with method, route template,
status and duration. URLs, query strings, headers and bodies are never logged. The
`authorization`, `x-hold-token` and `cookie` headers are redacted wherever a header object is
logged.

## Tests

**Unit** (`test/unit/`, collaborators mocked)

- Config: defaults, parsing, each invalid variable, and that no value is ever echoed.
- Exception filter: every row of the Errors table, the `Retry-After` sources, correlation-id
  fallback, headers already sent, and the log content (stack present, Postgres detail absent).
- Validation factory: nested and array paths, and unknown properties.
- Correlation id resolution, the logger params (redaction, serializers, levels) and the error
  serializer.
- Database-unavailable classification and the pg type parsers.
- Migration source: filtering, ordering, extension-free names, and the context argument.
- Health service: liveness, readiness, and the datastore down → `SERVICE_UNAVAILABLE` case.

**Integration** (`test/integration/`, real app and real Postgres `maqady_test`, migrated from
zero once per run, data cleaned per suite)

- `GET /health` and `GET /health/ready` return `200 {"status":"ok"}` with `no-store`.
- `X-Request-Id` echo: a valid UUID is echoed, an invalid one is replaced, and a missing one is
  generated.
- Error shapes: unknown route, validation failure (through a test-only route), malformed JSON
  and an oversized body.
- CORS: preflight for an allowed origin lists the allowed and exposed headers; a foreign origin
  gets no CORS headers. Helmet headers are present.
- Migrations: schema, extensions, row-level security, extension-free names, idempotent re-run,
  session settings and type parsers on a pooled connection.
- Request logging: one line per request with `correlationId`, and no body, query string or
  `Authorization` value.
- Swagger: the UI and the JSON document are served. The health paths and the
  `HealthResponse` and `ErrorResponse` schemas match the agreed draft, and the committed
  `contracts/openapi.yaml` is current.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero pass count, no failures, no skips),
  `npm run build` and `npm run contract` all pass, and `git status` is clean afterwards.
- `GET /api/docs` serves Swagger UI and `/api/docs/openapi.json` serves the document.
- `contracts/openapi.yaml` contains `/health` and `/health/ready`.
- `.github/workflows/ci.yml` is valid YAML and runs the gates on Node 24 against Postgres 16.
