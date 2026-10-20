---
title: U3 — Review of messaging
owner: Mohamed Tarek
status: Passed — 2026-10-20, two rounds, no open findings
last_verified: 2026-10-20
tags: [review, messaging, outbox, email, resend, sms]
---

# U3 — Review of messaging

Issue #3, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Two rounds, each against design §5,
§6.2 (`messages`), §13.1, §14.5 and §16, ADR 0004, PRD v2.0, the spec, and the `CLAUDE.md`
build order, stack rules, anti-patterns and testing policy:

- round 1 reviewed `c5c7c79..76e53d1` (findings R1 to R3);
- round 2 reviewed the whole unit again, `c5c7c79..f4a7112`, after U3 had merged
  (findings R4 and R5). `unit/gh-3-messaging` was recreated at `f4a7112` for its commits.

Each finding was reproduced before it was fixed. Every code fix has a test that failed before
it.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **A drain request made just as a drain finished was dropped.** `requestDrain()` cleared `running` in a `.finally()`, one microtask after the loop's last look at `pending`. A request landing in that gap (another request's post-commit hook, or the interceptor, firing as a drain ends) found `running` still set and only set `pending` on a loop that had already ended. Nothing ran it. The message then waited for the next write request or the daily readiness ping, which can be longer than a 24-hour one-time link lives. | A new unit test puts a `requestDrain()` call at each microtask depth from 0 to 7 after the running drain resolves, and expects one more run each time. Before the fix, depth 1 gave 1 run instead of 2. | Fixed in `f060912`. The loop clears `running` itself, in the same synchronous step as its last check of `pending`, so a request either becomes `pending` and is run, or starts a new loop. |
| R2 | minor | **`queue()`'s secret check missed HTML-escaped and form-encoded copies.** It looked for a secret parameter's value raw and as `encodeURIComponent` writes it. A template that put the secret in the HTML through `escapeHtml()`, or in a query string through `URLSearchParams` (`links.page(path, { code })`), was stored without being refused whenever the value held `&<>"'`, a space or `!'()~`. Today's tokens are base64url, which no encoding changes, so this was a gap in the safety net rather than a live leak. | Two new unit tests with the secret `it's a <secret> & more`, written once HTML-escaped and once form-encoded. Both were queued instead of refused. | Fixed in `0bff56e`. The check also looks for the `URLSearchParams` and `escapeHtml` forms. |
| R3 | minor | **The spec overstated the cost of probing a spent quota.** Its monthly-quota decision said "probing once a day costs at most one refused call per day". No quota state is kept between drains: a 429 holds only the emails it was claimed with, so each later drain that claims a due email spends one refused call on it. Three drains with one due email each made 3 refused calls in one day. Refused calls are not counted as attempts, so deliveries are unaffected. | A throwaway unit test (not kept): three `drain('batch')` calls, each claiming one email answered `daily_quota_exceeded`, made 3 provider calls. | Fixed in `a6a1e56`. The decision row now describes the real cost. The behaviour is unchanged. |
| R4 | minor | **No test held the Resend call's 10-second timeout.** The unit test only checked that `fetch` got some `AbortSignal`, and the timeout test fed `fetch` a ready-made `TimeoutError`. The drain sends one message at a time, and the 5-minute lease assumes each call ends within 10 s. A sender whose timeout never fires would leave a call hanging, the drain loop with it, and so the outbox stopped in that process until a restart. The code was right; nothing would have caught a regression. | Mutation: `AbortSignal.timeout(RESEND_TIMEOUT_MS)` replaced by `new AbortController().signal`. The sender's unit suite (36 of 36) and its integration suite (6 of 6) stayed green. | Fixed in `703515a`. A new unit test makes `fetch` hang until its signal aborts, and checks that the send ends as a `timeout` retry with `AbortSignal.timeout` called for 10 000 ms. Against the mutant it fails ("still waiting on Resend"), against the code it passes. |
| R5 | minor | **ADR 0004 still said failed messages are retried.** Its Decision reads "Queued and failed messages are retried opportunistically". The code, design §13.1 and the spec make `failed` terminal: the claim takes only `status = 'queued'` rows. The spec recorded the correction against §13.1 only, so the accepted ADR contradicted the code. | `grep` of `docs/adr/0004-email-through-resend.md`, here and on `main-jf8hqi`, against `claimDue()`'s `WHERE status = 'queued'` and the integration test "marks a refused message failed for good". | Fixed in `b1c57da`. The original text stays, and a dated Amendments section records the narrower rule. |

## Checked, with nothing to report

Both rounds; round 2 added the claim-plan and coalescing checks marked *(round 2)*.

- **The claim's plan** *(round 2)*. `EXPLAIN` on Postgres 16 shows `due` materialised as a CTE
  (`CTE due` → `Limit` → `LockRows`, read back by a `CTE Scan`). So the `LIMIT 10 … SKIP LOCKED`
  subquery runs once and is never rescanned into more than 10 rows. `LockRows` re-checks
  `next_attempt_at <= now` on a row another drain has just leased, so it drops that row.
- **Coalescing** *(round 2)*. Traced after R1's fix: `drain()` always awaits before it returns,
  so `running` is set before the loop can end. The loop clears it in the same synchronous step
  as its last look at `pending`.

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
- *(round 2)* A Resend `id` longer than `provider_message_id`'s 128 characters would make
  `markSent()` fail on every attempt, and the lease would then send it again every 5 minutes,
  uncounted. Resend ids are 36-character UUIDs, so this can't happen with the real provider.
- *(round 2)* Resend answers `403 validation_error` when the domain is not verified. That
  marks the message `failed` at once: verifying the domain later does not resend it. The spec
  retries only API-key problems, so this follows the spec. It is visible in the Message log.
- Resend keeps an idempotency key for 24 hours, and the retry schedule spans about 28. A send
  could go out twice only if Resend accepted it, the answer was lost, and every retry in the
  next 24 hours then failed. The next retry normally dedupes within a minute.

## Gates

Run fresh on `b1c57da` (round 2's last fix), with only this document and its `INDEX.md` row
uncommitted:

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0. ESLint passes, and Prettier reports "All matched files use Prettier
  code style!".
- `npm test`: unit 40 suites, 488 passed of 488; integration 17 suites, 144 passed of 144. No
  failures or skips.
- `npm run build`: exit 0.
- `npm run contract`: "Wrote contracts/openapi.yaml (2 paths)." `git status` is clean.

Round 1's gates, on `a6a1e56`, gave the same results with 487 unit tests.
