---
title: U1 — Review of the foundations
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, foundations, idempotency, auth, pagination, logging, swagger]
---

# U1 — Review of the foundations

Issue #2, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`b1bea21..b75bf38` on `main-jf8hqi`, against design §5, §7.1, §8, §10.2, §10.3, §10.6, §13.5,
§14 (14.1, 14.3, 14.6) and §15, PRD v2.0, the spec, and the `CLAUDE.md` stack rules,
anti-patterns and testing policy.

Each finding was reproduced before it was fixed. Every fix has a test that failed before it.
The reproductions ran on a separate database (`maqady_u1_review_test`), so no other run's data
was touched.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **A replay handed a guest's stored response to anyone who sent the guest's `Idempotency-Key`, with no hold code.** Guests share the `anonymous` scope, and their only proof of access is the hold code, which the handler checks (design §10.4). A replay skips the handler, and the request hash covered only method, route, path parameters and body. So the same key and body with a wrong `X-Hold-Token`, or none, replayed `201` with the owner's body: the hold code and tickets, the data design §14.1 encrypts at rest. Exploiting it needs the victim's key, but the key is never treated as a secret. | A test-only `@Guest() @Strict()` route that answers `NOT_FOUND` without the right code: the owner's call, then a wrong code and no code, all answered `201` with `Idempotent-Replayed: true` and the owner's body. Then a new integration test (wrong code, no code → `422`, never the secret) and unit tests on the hash, which failed. | Fixed in `d3c30f0`. The request hash now covers `X-Hold-Token`: a retry with the same code replays, and another code or none is `IDEMPOTENCY_KEY_REUSED`. Design §14.1, the spec and the `IDEMPOTENCY_KEY_REUSED` description are updated. |
| R2 | minor | **A cursor with a sort key of the wrong type answered `500 INTERNAL`, not `400 VALIDATION_FAILED`.** `decodeCursor` accepted any string or number as the sort key, so `["not-a-time", 1]` on a list sorted by a timestamp, or `[42, 1]`, passed and failed the query in Postgres (invalid input syntax), logged as an unexpected error. A NUL character in a text key fails the same way. The spec promises `400` on `cursor` for a cursor that was tampered with. | A test-only list route on `audit_events` ordered by `(occurred_at, id)`: a real time answered `200`, `"not-a-time"` and `42` answered `500 INTERNAL`. Then new unit tests (wrong kinds, an impossible date, a bare date, an ISO week date, NUL), which failed. | Fixed in `f496087`. `decodeCursor(cursor, kind)` and `toPageRequest(query, kind)` take the list's sort-key kind (`instant`, `text` or `number`; null is accepted for each), and no string may hold NUL. `isIsoInstant` joins the time helpers. The kind is an optional argument, so code already written against U1 still compiles. The spec tells each list to pass it. |
| R3 | minor | **Request lines didn't carry the principal kind and id.** Design §14.4: one line per request with "method, route template, status, duration, principal kind and id". U1 introduced `request.principal`, but the line still had only the first four, so an authenticated request couldn't be traced to its account. The spec had parked this for U2, although nothing in it depends on a real resolver. | A new integration test (a customer request through the test resolvers, read from the captured log) and a unit test on `requestLogLine`, which both failed. | Fixed in `2d4d17b`. The line carries `principalKind` (`customer` or `staff`) and `principalId`, null for guests and public routes, and nothing else of the principal. The spec says so, and its follow-up is removed. |
| R4 | minor | **Writes didn't document `413 PAYLOAD_TOO_LARGE`.** The one JSON parser refuses any body over 1 MB before the route runs (design §10.7, §14.3), but the cross-cutting documentation gave a write only `400`, `422`, `429` and `500`. | A 1.1 MB body to the probe's strict write answered `413 PAYLOAD_TOO_LARGE`, and its published operation listed `201, 400, 422, 429, 500`. Then a new unit test on `applyCrossCuttingDocs`, which failed. | Fixed in `2eff9b6`. Every `POST`, `PUT`, `PATCH` and `DELETE` now documents `413`. The committed contract is unchanged, because it has no write route yet. |
| R5 | minor | **`@NoRequestTransaction()` routes are documented with an `Idempotency-Key` that replays, but U1 neither stores nor replays their keys.** The interceptor checks the key (required when `@Strict()`), then runs the handler as is. The document still publishes the header, `IDEMPOTENCY_KEY_REUSED` and `Idempotent-Replayed`. The PRD says every write's key returns the first result. | Code reading of `WriteInterceptor.handleWrite` and `applyCrossCuttingDocs`. The integration test "still require the key when the route opts out" confirms that nothing is stored. | **Open.** No such route exists yet. The upload routes come in U4, which decides how an upload records its key in its own short transaction (spec, Decisions). Recorded in the spec's follow-ups for U4. |

## Checked, with nothing to report

- **Transactions.** The handler runs inside the context because `next.handle()` is called
  inside `run()`. Nest binds the handler with `AsyncResource.bind` at that call, which is how the
  ALS store reaches pipes and the handler. A retry re-subscribes and re-runs the pipes. Hooks run
  outside the store after commit, are dropped with a rolled-back savepoint, and never run on a
  replay. The status a write stores is the one Nest set before the interceptors run, so
  `@HttpCode` survives a replay.
- **Idempotency races.** Same key, concurrent: the second `INSERT … ON CONFLICT` waits for the
  first. A commit makes it replay or answer `REUSED`, and a rollback makes it claim the key
  itself. Taking over an expired key concurrently re-checks the `WHERE` on the new row version.
  The purge only takes rows with `SKIP LOCKED`, so it never waits and never takes a live key.
  A deadlock retry re-claims, because the first claim rolled back.
- **Access.** Class-level and method-level declarations both reach the guards and the published
  `security`, checked on a class-level `@Staff()` controller. The boot check counts the method
  and its controller together. A box office account gets `FORBIDDEN` on `@Admin()`. A staff
  token on `@Guest()` is `UNAUTHENTICATED`. The token's `sub` and `sid` must match the resolved
  principal. Only HS256 is accepted, with one secret per audience, and expiry is judged by the
  `Clock`.
- **Time.** Egypt's 2026 changes (24 April 00:00 → 01:00, 29 October 24:00 → 23:00): the cinema
  date before 06:00, 23- and 25-hour cinema days, a nonexistent admin time refused, an
  ambiguous one resolved to its first occurrence, and stored minutes shifted out of the gap.
  No `new Date()` or SQL `now()` decides correctness outside `SystemClock`.
- **Rules.** No `SELECT *`, no N+1, no inline types outside `types.ts`, and no `HttpException`
  or plain `Error` thrown on a request path. The plain `Error`s are boot-time configuration
  failures. Both migrations follow the conventions: named constraints, commented indexes,
  `TIMESTAMPTZ`, no defaults on critical columns, row-level security enabled.
- **Personal data.** Emails are hashed before they become throttler keys. Audit metadata refuses
  personal-data keys and non-scalar values. Config errors never echo a value. Stored responses
  are AES-256-GCM, with the scope and key as associated data.
- **Rate limits.** The default counts per route, and a named limit shares one bucket across its
  routes. `holdCustomer` is skipped for guests, and every `429` carries `Retry-After`. Invalid
  tokens are refused before the limiter counts them, which the guard order of design §10.3
  implies and the spec's follow-ups already record.

## Gates (final committed state)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean, Prettier clean |
| Test | `npm test` | unit 31 suites, 377 passed; integration 13 suites, 122 passed (473 before the review) |
| Build | `npm run build` | clean |
| Contract | `npm run contract`, then `git status` | `contracts/openapi.yaml` unchanged (2 paths), tree clean |
