---
title: U0 — Review of the scaffold
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, scaffold, errors, logging, database, migrations]
---

# U0 — Review of the scaffold

Issue #1, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`2f8f623..df5c095` on `main-jf8hqi`, against design §5, §6.1, §10.7, §14, §16 and §19, PRD v2.0,
the spec, and the `CLAUDE.md` build order, stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. Every fix has a test that failed before it.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **Malformed JSON answered with the parser's message, which quotes part of the body.** Nest's router error handler turns body-parser's `SyntaxError` into `BadRequestException(err.message)` before the filter sees it. So the fixed "The request body could not be read." in `error-mapping.ts` never applied in the real app: `{"name": secret-…` came back as `Unexpected token 's', "{"name": secret-in-"... is not valid JSON`. The unit test passed a hand-made body-parser error that the real app never delivers, and the integration test didn't check the message. `qa.md` recorded the leaked message too. | A supertest probe through the real app, then a new integration test (malformed JSON, and a JSON string body) that failed with the parser's message. | Fixed in `ae54e97`. An Express error middleware right after the JSON parser maps parser failures to `AppError` (`toUnreadableBodyError`), and Nest passes that through to the filter. Unit tests cover the mapping. `qa.md` carries the corrected response. |
| R2 | minor | **Some failed requests left no log line at all.** The JSON parser runs before nestjs-pino's middleware, and routes outside `/api/v1` never reach it. Malformed JSON (400), a body over 1 MB (413) and unknown routes such as `GET /nope` (404) wrote no request line. The filter skips 4xx because "the request line records them", which isn't true here. This breaks the spec's "one line per request" (design §14.4). | A probe with the log captured, then a new integration test (three cases) that timed out waiting for the line. | Fixed in `757ea1a`. When the request has no request-bound logger, the filter writes the one request line itself: `correlationId`, method, `route: null`, status. Unit tests check that it writes the line only in that case. |
| R3 | minor | **Concurrent first boots failed, and so did concurrent runs of a pending `0010_01`.** Knex takes its lock only after the runner creates the schema and Knex creates its tables. Four runners on an empty database: three failed with `23505` on `pg_namespace` or `pg_type`, or `42P07`. With `0010_01` pending, the losers deadlocked (`40P01`) on `knex_migrations_lock`. Design §16 says "Knex's migration lock makes that safe". The process exits 1 and Render restarts it, so this heals itself, but `npm run migrate` during a boot, or two instances, fail. | A script running four `MigrationRepository`s against a fresh database (3 runs, all with failures), then a new integration test on a scratch database that failed. | Fixed in `fa2e485`. `migrateLatest()` holds `pg_advisory_xact_lock(hashtext('maqady-backend:migrations'))` in its own transaction for the whole run, with `statement_timeout` and `idle_in_transaction_session_timeout` lifted for that transaction only. Re-running the script: every run succeeds, and exactly one applies the migration. Design §14.2 and §16, the spec, the README and the Dockerfile comment are updated. |
| R4 | minor | **CORS preflights and the Swagger routes carry no `X-Request-Id` and write no request line.** The API description says "Every response carries an `X-Request-Id` header". These responses are answered before Nest's middleware runs. | The same probe: `OPTIONS /api/v1/health` and `GET /api/docs/openapi.json` came back without the header, and nothing was logged. | **Open.** No client code reads the header from a preflight or the docs, and nothing fails. Fixing it means mounting the logger ahead of Nest's middleware, which is a structural change. It fits U1, which adds the global middleware (rate limiting, the write interceptor). |

## Checked, with nothing to report

- **Access and secrets.** Both health routes are public by design, and guards and `@Public()`
  belong to U1. `.env` is ignored and untracked. Config errors name the variable and never its
  value.
- **Personal data in logs.** Postgres errors keep only their SQLSTATE and constraint, so the
  message, the detail and the stack header are dropped. `compileSqlOnError` is false.
  Validation errors drop `target` and `value`. Knex's warnings carry SQL with placeholders.
  4xx bodies are never logged.
- **Database.** One Knex provider, injected only by repositories and `common/database`
  (enforced by lint). No `SELECT *`. The migration is raw SQL with a refused `down`, and every
  table it touches gets row-level security. UTC sessions. A `DATE` stays text.
- **Errors.** Services throw only `AppError`. `RATE_LIMITED` always carries `Retry-After`.
  Unknown errors answer `INTERNAL` without leaking their message.
- **Swagger.** `500` is on every operation and `503` on readiness. The examples, the
  `X-Request-Id` headers, the `enum` on `HealthResponse` and `nullable` on every error field
  are present. The schemas match `contracts/drafts/home-page.openapi.yaml`, and the committed
  contract is current.
- **Ops.** The image runs as the non-root `node` user and holds production dependencies only.
  CI uses a read-only token, Node 24 and Postgres 16, and runs the contract check.

## Gates after the fixes

Run fresh on `fa2e485`:

```
$ npm run typecheck        → tsc --noEmit, exit 0
$ npm run lint             → All matched files use Prettier code style!
$ npm test                 → unit: 14 suites, 165 passed; integration: 7 suites, 55 passed
$ npm run build            → nest build, exit 0
$ npm run contract         → Wrote contracts/openapi.yaml (2 paths).
$ git status --short       → (clean)
```
