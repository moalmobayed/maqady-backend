---
title: U11 — Review of checkout, settlement and tickets
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, checkout, payments, settlement, confirmation, tickets, qr, pdf, ics, concurrency]
---

# U11 — Review of checkout, settlement and tickets

Issue #12, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`e9a423b..ff2c8f4` on `unit/gh-12-checkout`. The review checked the unit against design §6.2
(`payments`), §6.3, §7.1, §7.4, §7.5, §7.9 and §13.1, ADR 0004, PRD v2 ("Seats and holds",
"Payments", "Tickets and QR codes", C8, C9), the spec, and the `CLAUDE.md` stack rules,
anti-patterns and testing policy.

Each finding was reproduced before it was fixed, and the fix has a test that failed before it.
The integration suites ran on this tree's own database (`maqady_u11_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **A booking's due payment was never settled once 100 other due payments were waiting.** `SettlementService.settle()` read the 100 oldest due charges (`SETTLEMENT_BATCH_LIMIT`) and only then filtered them by the request's scope. A due charge outside every later request's scope stays due: an abandoned slow payment whose booking and showtime nobody reads again (a past showtime, a tester who closed the tab). Only `settleAllDue()` clears those, and its callers (U14, U16, U17) do not exist yet. Once 100 of them were due, every scoped settlement found nothing in scope. A new slow payment then stayed `processing` on every read and write, and its hold lapsed at `settles_at + 30 s`. A rival could then take the seats, so a successful payment ended as an automatic refund. Until then the owner got `PAYMENT_IN_PROGRESS` on every new hold. | A new integration test in `settlement.service.test.ts`, "settles a booking's due payment even behind a full batch of other due payments nobody read", sets up 101 due processing charges on other bookings, then a slow payment for the target booking and a read of it after its `settlesAt`. Before the fix the read answered `held` / `processing`. New unit tests in `settlement.service.test.ts` and `payments.service.test.ts` cover the paging and the cursor. | Fixed in `fa79e09`. `PaymentsService.due(limit, after?)` and `PaymentsRepository.due()` take a keyset cursor on `(settles_at, id)`. When a full page holds nothing of the scope, settlement reads the next page, until it finds the scope's charges (at most 100) or no due charges are left. `settleAllDue()` still reads one batch. The common case (nothing due) is still one indexed query with no transaction. Design §7.5 "As built" and the spec say so. |

## Checked and found sound

- **Lock order.** Pay takes the showtime `FOR SHARE` → the customer → the booking `FOR UPDATE`
  → its claims (showtime, label, `COLLATE "C"`, the same order as U10's `compareSeatLabels`).
  Settlement takes showtimes `FOR SHARE` (id order) → bookings (id order) → claims. Holds,
  claims and releases are subsequences of the same order. The review traced pay against a
  release, a rival hold, the payer re-picking seats, U7 move and cancel, and overlapping
  settlements of different scopes. None of these pairs can form a cycle. Payment rows are only
  written under their booking's lock, so the `PAYMENT_IN_PROGRESS` / `ALREADY_PAID` checks and
  the `<ref>-c<n>` / `-r<n>` counts stay true until commit. The partial unique index backs them.
- **Exactly once.** A second payment with a different key waits on the booking lock and finds
  the booking `confirmed` or the charge processing. With the same key the idempotency claim
  replays. When racing settlements reach the conditional `UPDATE … WHERE status = 'processing'
  RETURNING`, only one of them gets the charge back.
- **Time.** Hold, claim and settlement checks compare stored instants with the `Clock`. A hold
  is `HOLD_EXPIRED` at exactly `hold_expires_at`. `now` is read once per transaction. In
  checkout that matches PRD Seats 5: a claim that expired during a lock wait and was taken by a
  rival has a different `booking_id`, so the payment is `HOLD_EXPIRED`. The `.ics` is in UTC
  with no time-zone data. Messages and the PDF use `formatCairoDisplay`, which handles summer
  time.
- **Access and secrets.** Payment and downloads are `@Customer()` with the owner checked in the
  service, and `NOT_FOUND` for anyone else, a guest hold or an unknown reference. The QR key is
  checked at boot, by its decoded bytes, against the JWT and encryption secrets. The signature
  is compared in constant time after a strict parse. The QR payload is a secret template
  parameter, so no stored message holds it. No new code logs anything. Card data is the brand
  and last four only.
- **Messages.** Tickets are queued in the confirming transaction. `MessagingService` asks for
  an outbox drain after commit, so a confirmation settled by a `GET` (which the drain
  interceptor skips) is still sent at once.
- **Conventions.** The migration follows the conventions: named FKs, each covered by an index,
  every index commented with its query, no defaults, `TIMESTAMPTZ`, `INT` money with currency,
  and RLS. There are no inline types in services, controllers, repositories or interceptors, no
  `HttpException` or plain `Error`, and no `SELECT *` in `src/`. Batches cost a fixed number of
  statements (confirmation, tickets, audit `recordMany`, claim writes).
- **Swagger.** The three routes have tags, prose and their error codes. Access, idempotency and
  `429` are documented cross-cuttingly. Nullable and enum fields are marked. The binary and
  calendar responses use `@ApiProduces`. `npm run contract` leaves no diff.

## Notes, not findings

- With R1's paging, a scoped settlement reads every page of other bookings' due charges ahead
  of its own. That cost grows with the backlog of unread abandoned slow payments until a
  `settleAllDue()` caller exists (U14, U16, U17, already follow-ups in the spec). With the
  simulated provider the backlog only grows through `sim_card_slow*` tokens that nobody
  follows up.
- The payment rate limit (10 in 5 minutes) is keyed by booking reference alone, as design §10.6
  says. Another signed-in customer who knows a reference can use up the owner's attempts. That
  belongs to the §10.6 design, not to this unit.
- QA incident recorded by the builder: one `pkill -f` by command pattern while restarting the QA
  server. Every later stop used the exact process id.

## Gates on the final tree

`npm run typecheck` and `npm run lint` are clean. `npm test`: 1402 unit and 683 integration
tests pass, none fail. `npm run build` succeeds. `npm run contract` leaves `git status` clean.
