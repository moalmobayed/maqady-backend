---
title: U13 — Review of the box office unit
owner: Mohamed Tarek
status: Passed — 2026-10-29, no open blocker or major findings
last_verified: 2026-10-29
tags: [review, box-office, counter-sales, counter-holds, scanning, check-in, settlement, lock-order]
---

# U13 — Review of the box office unit

Issue #14, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`8f85171..13228c0` on `unit/gh-14-box-office`. Reviewed against design §6.2, §7.1, §7.3, §7.5,
§7.6, §7.8, §7.9, §10.4, §11 (the admin box-office and scan routes), §14.1 and §21, PRD v2
"Payments" 2, A6 "New booking", "Scan tickets", "Tickets and QR codes" and "Statuses", the spec,
and the `CLAUDE.md` stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. Every fix has a test that failed before it.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **A typed reference of a booking that was actually paid scanned as `NOT_VALID not_paid`.** `POST /admin/scans` had no `@SettleFirst()`, so it skipped design §7.1 step 1. Settlement only happens on read and on write; no timer runs it. A customer who paid with a slow online method and closed the page still has a `held` booking with a `processing` charge whose result is due. At the entrance, staff type the reference and the scanner says "not paid", although the money was taken. | A new `scans.controller.test.ts` case: a customer pays with `sim_card_slow` the day before, then at the door the reference is sent with `confirm: true`. Against the old code it answered `NOT_VALID` (expected `VALID`). | Fixed in `c791f9d`. `@SettleFirst('booking', 'body')` now works as the showtime body source already did: the interceptor reads the raw body's `reference`, trimmed and upper-cased as validation normalises it, and settles that booking before the request transaction opens. A QR code exists only for a confirmed booking, so it needs nothing settled. Unit-tested in `settle-first.interceptor.test.ts` (normalisation, plus nothing for a missing, malformed or non-string reference, or a `code`). Spec, design §7.9 and the route description record it. |
| R2 | minor | **A booking moved to another showtime during a scan could be admitted on its old showtime.** The scan reads the booking without a lock, then waits for its showtime's `FOR SHARE`. The conditional check-in named the booking id, its status, `checked_in_at IS NULL` and (for a QR code) the version, but not the showtime. A typed reference has no version. So an edit (U14, design §7.8) that moved the booking to another theater's showtime while the scan waited still let the scan admit it, using the old showtime's verdict. | A new `scans.controller.test.ts` case. A transaction holds the showtime `FOR UPDATE`, and the scan is seen waiting on it in `pg_stat_activity`. The booking is then moved to another theater's showtime the way design §7.8 does it (claims deleted, `showtime_id` changed, QR version kept), and the lock is released. Against the old code the scan answered `VALID` and set `checked_in_at` (expected `WRONG_SHOWTIME other_theater`). | Fixed in `c791f9d`. `BookingsRepository.checkIn()` takes a `CheckInTarget` (`id`, `showtimeId`, `qrVersion`) and adds `showtime_id` to the `WHERE`. When the update changes nothing and the re-read finds the booking on another showtime, that showtime is locked `FOR SHARE` and the booking judged again. This happens at most 3 times; beyond that the scan answers `INTERNAL` rather than admit. A new `scan.service.test.ts` case covers the second lock and verdict. The impact before U14 was nil, because no route moves a booking yet. |

No blocker was found. The one major finding (R1) is fixed, and so is the minor one (R2). Nothing
stays open.

## Checked, with nothing to report

- **Seat correctness across channels.** A counter hold goes through `HoldsService.create()` with a
  staff holder. It locks the showtime and the hall `FOR SHARE`, then the member at §7.1 step 4,
  then the member's previous live counter hold `FOR UPDATE`, then writes the same claim statement.
  The concurrency suite's counter-against-customer races, the 12-way overlap and the swapped-order
  rounds pass with no deadlock. A counter hold has no code and no customer, so the online release,
  claim and checkout paths all answer `NOT_FOUND` for it: `mayActOn`, `mayRead` and
  `holdCodeMatches` treat a null hash as no match.
- **Money.** A counter payment locks in §7.5 order: showtime `FOR SHARE`, the existing customer
  `FOR UPDATE`, the booking `FOR UPDATE`, then its claims. It re-checks `ALREADY_PAID` and expiry
  under the booking lock, so a double press records one row (proved concurrently). The
  partial unique index on live sale charges still applies. The amount is the hold's own total.
  `chk_payments_receipt_reference` matches `RECEIPT_REFERENCE_PATTERN`, and its NULL hole was
  already fixed during the build. No refund path is added (U14).
- **Double check-in.** The conditional update serializes two scans on the row. The loser re-reads
  and answers `ALREADY_USED` with the first scan's time (proved concurrently, one audit row).
  `chk_bookings_checked_in_paid` refuses a check-in on a hold.
- **Security.** Every new route is `@Staff()` (both roles, as §11 lists), behind the global guards,
  and a customer token answers `401`. Ownership of a counter hold is the member's.
  `FORBIDDEN not_your_counter_hold` instead of `404` is a recorded as-built decision: staff read
  every booking (§10.4). Audit metadata carries no personal data (method, purpose, channel,
  `customerKind`, `theaterId`, `via`, `format`), and the new code logs nothing.
- **Idempotency and transactions.** Counter holds and counter payments are `@Strict()`. Scans and
  releases accept an optional key, as §11 says. Each write runs in one transaction with its audit
  row. The staff PDF's audit row has a short transaction of its own (§14.1 updated).
- **Time.** The scan window uses `subtractFromInstant()` on stored instants. It opens exactly
  60 minutes before the start and closes at `ends_at` (both edges unit-tested), with Cairo ISO
  output. Hold expiry and the start cap come from U10's code.
- **Conventions.** Both migrations are in `migration-list.ts` with the `0140_<nn>` prefix and
  named `chk_` constraints. They add no index; the lookups use U10 and U11's indexes. There are no
  inline types outside `types.ts`, no `HttpException` or plain `Error` from services, no
  `SELECT *` and no per-row queries. DTOs live in `dto/`. The contract is regenerated and current.
