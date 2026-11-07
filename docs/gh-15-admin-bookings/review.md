---
title: U14 — Review of the admin bookings unit
owner: Mohamed Tarek
status: Passed — 2026-10-29, no open blocker or major findings
last_verified: 2026-10-29
tags: [review, admin-bookings, refunds, payouts, edits, showtime-cancellation, settlement, lock-order]
---

# U14 — Review of the admin bookings unit

Issue #15, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`1af87d8..99a6b8a` on `unit/gh-15-admin-bookings`. Reviewed against design §5, §6.2, §7.1, §7.5,
§7.7, §7.8, §8, §11 (the admin booking routes), §13.1, §13.5, §14.1 and §21, PRD v2 A5, A6, A8,
"Cancellations, refunds and edits", "Email and SMS" and "Tickets and QR codes", the spec, and the
`CLAUDE.md` stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. The behaviour fix has a test that failed first.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **Cancelling a showtime skipped design §7.1 step 1, so a customer whose slow payment had already gone through got no cancellation notice.** U14 made `PATCH /admin/showtimes/{id}` with `status: cancelled` refund and notify for real, but the route had no `@SettleFirst()`. Take a customer who paid with a slow method: the provider decides 10 s later, and nobody reads the booking after that. When the showtime is cancelled, the booking is still `held` with a `processing` charge. The cancellation releases it as a live hold, sends no notice, and leaves the money charged. A later read then refunds it with no notice, and only if someone reads it, since no timer runs. A move had the same gap: the payer was not sent the new time. | A new `showtime-cancellation.test.ts` case: a customer pays with `sim_card_slow`, the clock moves 11 s on, and the showtime is cancelled. Against the old code the booking was still `held` (expected `refunded`), with no `showtime.cancelled` email. | Fixed in `b8627e5`. The PATCH is now `@SettleFirst('showtime')`, so the showtime's due payments are settled in their own transaction before the request's. The payment is confirmed first, then refunded and notified like any other confirmed booking. Showtimes cannot import bookings, so the decorator, its metadata key and its types moved to `src/common/settlement/`. Bookings re-exports them at their old paths, so every existing import, and any other unit's, keeps working. The route description, design §7.7 and the spec record it. |
| R2 | minor | **An inline object type in a service file.** `refundSplitOf()` in `booking-refunds.service.ts` returned `{ amount; onlineAmount; counterAmount }` as a type literal. `CLAUDE.md` puts non-trivial types in the module's `types.ts`. | Read in the diff; a scan of every changed service, controller, repository and mapper found no other case. | Fixed in `bb69445`: `RefundSplit` in `types.ts`. No behaviour change; typecheck and the unit suite stay green. |

No blocker was found. The major finding (R1) and the minor one (R2) are both fixed. Nothing
stays open.

## Checked, with nothing to report

- **Lock order and races.** Cancel & refund locks only the booking, then its claims (§7.1 steps 5
  and 6). An edit locks both showtimes `FOR SHARE` in id order, then the target hall, the
  booking, and the current and target claims in one ordered statement. A showtime cancellation
  holds the showtime `FOR UPDATE`, then its bookings in id order, then their claims. Settlement
  and scans take the showtime `FOR SHARE` first. These interleavings were traced and none forms a
  cycle:
  - refund against edit, and refund against cancellation;
  - edit against cancellation of either its current or its target showtime;
  - edit against edit on the same booking (a moved booking gets `CONFLICT`);
  - edit or refund against a scan (the check-in names the showtime and the QR version);
  - two payouts.

  The one deadlock left is the spec's known limit: an edit's new-seat insert racing a rival
  hold. The write interceptor retries it before any provider call has been made.
- **Money.** The ledger reads each charge's remainder under the booking lock. Refunds are planned
  per charge: `refundEverything()` for a cancel, `allocateRefund()` newest first for an edit.
  `PaymentsService.refund()` refuses more than a charge has left, a charge named twice in a
  batch, and any charge that did not succeed. Card and wallet refunds succeed through the
  provider with the key `<ref>-r<n>`. Cash and terminal refunds stay `pending` until paid out by a
  conditional update. The retry, the two-admin race, a split across two rails after an edit and
  a partial edit refund are all proved against Postgres.
  - *Not counted as a finding:* a provider refund made inside a transaction that then rolls back
    leaves its key number free, and the next refund reuses that key. A real gateway could replay
    the earlier amount. This is the scheme U11 chose (design §7.7), and the simulated provider
    cannot show the effect.
- **The edit plan.** `planEdit()` is pure and shared by the preview and the edit:
  - a kept seat keeps its sold price; any other seat, or any seat on another showtime, takes the
    current zone price;
  - the difference is collected at the counter with `payment` (required exactly then) or refunded
    across the charges;
  - an edit that changes nothing is refused;
  - `qr_version` goes up on every edit.

  `booking.edited` records the field names, the reason enum, both showtime ids and the signed
  difference, never a contact value.
- **Security.** Every new route carries `@Staff()` or `@Admin()` as the design gives it. The suites
  prove box-office tokens get 403 on the five admin routes and customer tokens get 401. No
  customer route reads `booking_notes`, and `booking.note_added` carries only the note id. The
  new code writes no log lines. The audit metadata holds ids, enums, amounts and channel names
  only.
- **Time.** "Today" is `cinemaDayBounds(cinemaDateOf(now))`, and `dateFrom` / `dateTo` are cinema
  days checked by `@IsCinemaDate()`. The 7 days use `subtractFromInstant()`. No inline offset or
  millisecond arithmetic was added.
- **Database.** `0150_01` and `0150_02` follow the conventions: `BIGSERIAL` primary key, named
  foreign keys, each covered by an index, every index commented with its query path, a `CHECK`
  on blank note bodies, row-level security, and no defaults. Both are listed in
  `migration-list.ts`. Every query names its columns. The list is one page query plus one count,
  and every batch read uses `whereIn` / `ANY`, so there is no N+1.
- **Errors and validation.** Services throw only `AppError`. The new codes are in the catalogue,
  its unit test and the Swagger examples. Request DTOs carry `class-validator` and
  `@nestjs/swagger` decorators. The contract suite checks every route's tag, prose, success
  status, errors, security and strictness.
- **Tests.** The integration suites run the real app on Postgres. Only Resend is replaced.
  Repositories are mocked only in unit tests. They would fail on a double refund, a second
  notice per booking and channel, a preview that differs from its edit, a filter that matches
  too much, or a page whose query count depends on its size.
