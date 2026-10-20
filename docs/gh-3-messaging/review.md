---
title: U3 — Review of messaging
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, messaging, outbox, email, resend, sms]
---

# U3 — Review of messaging

Issue #3, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`c5c7c79..76e53d1` on `unit/gh-3-messaging`, against design §5, §6.2 (`messages`), §13.1, §14.5
and §16, ADR 0004, PRD v2.0, the spec, and the `CLAUDE.md` build order, stack rules,
anti-patterns and testing policy.

Each finding was reproduced before it was fixed. Every code fix has a test that failed before
it.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **A drain request made just as a drain finished was dropped.** `requestDrain()` cleared `running` in a `.finally()`, one microtask after the loop's last look at `pending`. A request landing in that gap (another request's post-commit hook, or the interceptor, firing as a drain ends) found `running` still set and only set `pending` on a loop that had already ended. Nothing ran it. The message then waited for the next write request or the daily readiness ping, which can be longer than a 24-hour one-time link lives. | A new unit test puts a `requestDrain()` call at each microtask depth from 0 to 7 after the running drain resolves, and expects one more run each time. Before the fix, depth 1 gave 1 run instead of 2. | Fixed in `f060912`. The loop clears `running` itself, in the same synchronous step as its last check of `pending`, so a request either becomes `pending` and is run, or starts a new loop. |
| R2 | minor | **`queue()`'s secret check missed HTML-escaped and form-encoded copies.** It looked for a secret parameter's value raw and as `encodeURIComponent` writes it. A template that put the secret in the HTML through `escapeHtml()`, or in a query string through `URLSearchParams` (`links.page(path, { code })`), was stored without being refused whenever the value held `&<>"'`, a space or `!'()~`. Today's tokens are base64url, which no encoding changes, so this was a gap in the safety net rather than a live leak. | Two new unit tests with the secret `it's a <secret> & more`, written once HTML-escaped and once form-encoded. Both were queued instead of refused. | Fixed in `0bff56e`. The check also looks for the `URLSearchParams` and `escapeHtml` forms. |
| R3 | minor | **The spec overstated the cost of probing a spent quota.** Its monthly-quota decision said "probing once a day costs at most one refused call per day". No quota state is kept between drains: a 429 holds only the emails it was claimed with, so each later drain that claims a due email spends one refused call on it. Three drains with one due email each made 3 refused calls in one day. Refused calls are not counted as attempts, so deliveries are unaffected. | A throwaway unit test (not kept): three `drain('batch')` calls, each claiming one email answered `daily_quota_exceeded`, made 3 provider calls. | Fixed in `a6a1e56`. The decision row now describes the real cost. The behaviour is unchanged. |

## Checked, with nothing to report

- **Outbox atomicity.** `queue()` joins the open transaction through `TransactionRepository.run()`,
  reserves the id in it and registers the drain with `afterCommit()`. A rolled-back write
  request, a retried deadlock attempt and a rolled-back savepoint all drop their hooks. The drain
  uses the pool directly and never an open request transaction.
- **Claim and lease.** The claim is one autocommit CTE with `FOR UPDATE SKIP LOCKED` on the
  partial `idx_messages_due`. The 5-minute lease outlasts a full batch (10 × 10 s timeout plus
  500 ms pacing). Every result update is guarded by `status = 'queued'`. After an expired lease
  or a crash the resend carries the same `Idempotency-Key`. The integration tests race real
  drains against Postgres and check exactly-once sends.
- **Interceptor order.** `OutboxDrainInterceptor` is registered before `WriteInterceptor`, so it
  is the outer one: its `complete` follows the commit and the post-commit hooks. A failed
  handler triggers nothing.
- **Retry policy.** The backoff, the cap of 10 (`chk_messages_attempts`), a terminal `failed`,
  and an uncounted 429 match D-27. Quota holds use `startOfNextUtcDay()`, other 429s use a
  clamped `Retry-After`, both through the shared time helpers. There is no inline
  millisecond math, and nothing depends on a timer.
- **Secrets and personal data.** Stored copies are rendered with the storage link builder. The
  parameters are AES-256-GCM encrypted with AAD `messages:<id>` and cleared on `sent`.
  Log lines carry ids, template, channel, outcome and code. They never carry the recipient,
  the body or a provider message. Only a Resend error `name` matching `^[a-z_]{1,64}$` is
  stored. `compileSqlOnError` is false, so a failing insert never quotes its values. Config
  errors never echo `RESEND_API_KEY`.
- **Migration.** Raw SQL, named CHECKs per enum and status, no defaults, `TIMESTAMPTZ`, every
  index commented with its query path, covering indexes for the three future FKs, and
  row-level security like the U1 tables.
- **Code rules.** No inline types outside `types.ts`, no `SELECT *`, no N+1 (held emails share
  one `whereIn`), no plain `Error` or `HttpException` from services. Knex is reached only through
  the repository.
- **Contract.** The only diff is the readiness description, as the spec says. `GET /health/ready`
  stays `@Public()` with its `503`.
- **Exports for later units.** `MessagingService`, `MessageTemplateRegistry`,
  `OutboxDrainService`, `EmailSender`, `SmsSender`, the template types, `renderSimpleHtml`,
  `escapeHtml`, `REDACTED_LINK` and `DrainOutboxAfterResponse` are exported as the spec lists.

## Noted, not findings

- A write that queues a message asks for two drains: one from the post-commit hook and one from
  the interceptor. Coalescing turns that into one extra claim query that finds nothing. It is
  cheap, so it was left alone.
- Drains requested after `beforeApplicationShutdown` has returned can still claim rows before
  the pool closes. Those rows wait out their 5-minute lease and are resent under the same
  idempotency key. Nothing is lost or sent twice.
- Resend keeps an idempotency key for 24 hours, and the retry schedule spans about 28. A send
  could go out twice only if Resend accepted it, the answer was lost, and every retry in the
  next 24 hours then failed. The next retry normally dedupes within a minute.

## Gates

Run fresh after the last fix (`a6a1e56`), with only this document and its `INDEX.md` row
uncommitted:

- `npm run typecheck`: clean.
- `npm run lint`: clean. ESLint passes, and Prettier reports "All matched files use Prettier
  code style!".
- `npm test`: unit 40 suites, 487 passed of 487; integration 17 suites, 144 passed of 144. No
  failures or skips.
- `npm run build`: exit 0.
- `npm run contract`: "Wrote contracts/openapi.yaml (2 paths)". `git status` shows no change to
  the contract.
