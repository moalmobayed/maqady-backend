# Documentation index

Every document in this repo has a row here. Add one when you add a doc; the doc-hygiene
gate (G5) checks it.

| Doc | What it covers | Owner | Last verified |
|---|---|---|---|
| `docs/system-design.md` | Repo-level architecture: how the backend meets PRD v2.0 (modules, data model, booking core, API, delivery plan) | Mohamed Tarek | 2026-10-20 |
| `docs/adr/0001-track-in-github-issues.md` | Decision: track work in GitHub Issues instead of Linear (recorded exception) | Mohamed Tarek | 2026-10-18 |
| `docs/adr/0002-nestjs-instead-of-express.md` | Decision: build the API on NestJS instead of plain Express (recorded exception to the pack) | Mohamed Tarek | 2026-10-18 |
| `docs/adr/0003-idempotency-in-postgres.md` | Decision: keep idempotency keys in Postgres instead of Redis; Redis leaves the stack (recorded exception to the pack) | Mohamed Tarek | 2026-10-19 |
| `docs/adr/0004-email-through-resend.md` | Decision: send email through Resend and keep SMS simulated; no secret links in the Message log | Mohamed Tarek | 2026-10-20 |
| `docs/reference/design-inventory.md` | What the design prototypes show, screen by screen: data, actions, enums, gaps G1–G22 (not decisions) | Mohamed Tarek | 2026-10-18 |
| `docs/reference/prd.md` | Text extract of the PRD, "Movie Reservation System" v1.0 (Arabic/English); superseded by v2.0 | Mohamed Tarek | 2026-10-19 |
| `docs/reference/prd-v2.md` | PRD v2.0: requirements after backend planning (copy of the shared doc) | Mohamed Tarek | 2026-10-20 |
| `docs/gh-1-scaffold/spec.md` | U0 spec: the NestJS scaffold, config, logging, errors, database, Swagger, health, tests, CI and deploy files | Mohamed Tarek | 2026-10-20 |
| `docs/gh-1-scaffold/qa.md` | U0 manual QA: curl evidence for health, readiness, error shapes, X-Request-Id, CORS, Swagger, database-down, fail-fast boot, logs, the replayed Docker image and shutdown | Mohamed Tarek | 2026-10-20 |
| `docs/gh-1-scaffold/review.md` | U0 adversarial review: findings with severity, how each was verified, and the fix commit or why it stays open | Mohamed Tarek | 2026-10-20 |
| `docs/gh-2-foundations/spec.md` | U1 spec: transactions, idempotency and the write interceptor, crypto, time, money, pagination, access guards and the boot check, rate limits, audit, the error catalogue; the exported services later units call | Mohamed Tarek | 2026-10-20 |
| `docs/gh-2-foundations/qa.md` | U1 manual QA: curl evidence for boot and migrations, guards on health, rate limits, the published document, config refusal, and (through a QA-only harness of the probe routes) idempotency, replays, a retried deadlock and every access level | Mohamed Tarek | 2026-10-20 |
| `docs/gh-2-foundations/review.md` | U1 adversarial review: findings with severity, how each was verified, and the fix commit or why it stays open | Mohamed Tarek | 2026-10-20 |
| `docs/gh-3-messaging/spec.md` | U3 spec: the messages outbox, templates and redacted one-time links, MessagingService.queue, the Resend and simulated senders, the opportunistic drain; the exported services later units call | Mohamed Tarek | 2026-10-20 |
| `docs/gh-3-messaging/qa.md` | U3 manual QA: curl evidence for the migration, readiness and its description, email config refusal, and (through a QA-only harness of the probe routes) send after commit, redaction, rollback, SMS, retries and the drain triggers | Mohamed Tarek | 2026-10-20 |
| `docs/gh-3-messaging/review.md` | U3 adversarial review, two rounds: findings with severity, how each was verified, and the fix commit or why it stays open | Mohamed Tarek | 2026-10-20 |
| `README.md` | What the service is, setup, environment variables, scripts, API docs, tests, migrations and deploy notes | Mohamed Tarek | 2026-10-20 |
| `contracts/openapi.yaml` | The OpenAPI contract generated from the code by `npm run contract`; CI fails when it is stale | Mohamed Tarek | 2026-10-20 |
| `contracts/drafts/home-page.openapi.yaml` | Hand-written contract for `GET /api/v1/home` and health, agreed with the frontend before the code; the generated `contracts/openapi.yaml` must match it, then the draft is deleted | Mohamed Tarek | 2026-10-20 |
