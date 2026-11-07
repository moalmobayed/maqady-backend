---
title: U12 — Review of customer bookings
owner: Mohamed Tarek
status: Passed — 2026-10-29, no open blocker or major findings
last_verified: 2026-10-29
tags: [review, bookings, my-bookings, history, audit, tickets, email-again, rate-limit, clock]
---

# U12 — Review of customer bookings

Issue #13, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`8f85171..33fdc12` on `unit/gh-13-customer-bookings`, without the merge of `main-jf8hqi`. The
review checked the unit against design §5, §7.1, §7.4, §7.9, §10.6, §11 (customer booking
routes), §13.1, §13.5 and §14.1, PRD v2 (C10, C11, "Email and SMS", "Statuses"), the spec, and
the `CLAUDE.md` stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. Both are gaps in the tests, not in the product
code. They were shown by mutating the code and seeing every suite stay green; each new test fails
on that mutation and passes on the code as built. The integration suites ran on this tree's own
database (`maqady_u12_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **No test covered the booking details U12 adds to `GET /bookings/{ref}`.** The spec lists integration tests for the details route: `seatLines` for a two-zone booking, `showtime.theater` with the address and coordinates, `refund { amount = total, refundedAt }` for a refunded booking and `null` for a confirmed one, and `404` for another customer. None was written. `seatLinesOf()` has unit tests, but nothing checked how `BookingResponseMapper` sends the lines, the refund or the theater. | Changed the mapper to send a line's `amount` as its `unitPrice`, then ran the 15 bookings integration suites: 106 passed, none failed. | Fixed in `c41a002`. A new `test/integration/modules/bookings/bookings.controller.test.ts` checks a four-seat booking over two zones, picked out of seat order: a front line, then a middle line in seat order, with unit prices and amounts. It also checks the theater's full location, a refunded booking's refund (the total, and the settlement instant) and `404` for another customer. With the mutation 1 of its 3 tests fails; on the real code all 3 pass. |
| R2 | minor | **No test covered the History's refund bound.** A booking's History shows moves of its showtime only from `confirmed_at` until `refunded_at` (`AuditReadRepository`, `occurred_at < until`). The integration test "shows a refund, and no move after it" made no move after the refund: its showtime was cancelled, so it could not be moved. Unit tests only check that `historyFilterOf()` passes `until` through, not that the SQL uses it. | Removed the `occurred_at < ?` condition and its binding from `AuditReadRepository.filtered()`, then ran `booking-history.controller.test.ts`: 5 of 5 passed. | Fixed in `07c313d`. A new test pays for a booking, moves its showtime, refunds the booking the way U14 will store it (the row by SQL, as the contact-change test does, then `booking.refunded` through `AuditService`), and moves the showtime again. The History must read held, paid, one change, refunded, total 4. With the mutation it fails (a second change appears); on the real code it passes. The old test is renamed "shows a refund after the payment received", which is what it checks. |

## Checked and found sound

- **Ownership and access.** All three routes are `@Customer()`. The History and Email again
  return `NOT_FOUND` for another customer's booking or a guest's before any audit read or lock.
  Email again checks the owner again under the lock. My Bookings filters by
  `b.customer_id = :caller` in SQL. No token and a staff token give `401`, and the tests cover
  each case.
- **Rate-limit key.** `JwtAuthGuard` runs before `RateLimitGuard` (`AppModule` `APP_GUARD`
  order), so `request.principal` is set when `customerAndBookingRef` is computed. Another
  customer's `404`s and anonymous `401`s count in their own buckets, so they cannot spend the
  owner's three sends. Swapping the key back to `bookingRef` fails the integration test "allows 3
  an hour per booking".
- **Locks.** Email again takes only the booking `FOR UPDATE`. Its inserts into `messages` and
  `audit_events` take `FOR KEY SHARE` on the customer row through their foreign keys. Checkout and
  the profile take the customer with `FOR NO KEY UPDATE` (`customers.repository.ts`), which does
  not conflict with `FOR KEY SHARE`, so Email again cannot deadlock with them. Settlement and the
  U14 refunds lock the showtime and then the booking, and Email again waits for no other lock, so
  no lock cycle is possible. Idempotency replays parallel requests that share a key (§14.1), so 5
  of them still queue one email.
- **The U11 settlement fix.** Writing the charges' audit rows before `confirm()` and
  `refundAtOnce()` changes only the `id` order inside one instant. Every write stays in the same
  transaction. Checkout's direct path still writes `booking.confirmed` before
  `payment.succeeded`; that is harmless because the History hides `booking.confirmed`.
- **Clock and cinema day.** Tabs use `bookingStatusPredicate()` with one `now` for the page, the
  counts and every card. The split is by `s.ends_at`, and `cinemaDate` comes from the showtime
  view. Keyset values are `Date.toISOString()` with milliseconds. Audit `occurred_at` comes from
  the `Clock` (milliseconds), never from `now()` in SQL (microseconds), so a cursor never repeats
  a row.
- **No N+1.** A page is the page query, the counts, then `BookingViews.ofMany()` batches: seats,
  showtimes and halls, theaters and their children, movies and posters, latest sales. The suite
  counts equal queries for 1 and 12 bookings. The History is one query plus one count.
- **Conventions.** Migration `0130_01` creates one index (equality columns first, then the range),
  comments it with its query path, drops it schema-qualified in `down`, and is listed in
  `migration-list.ts`. There are no inline types in services, controllers or repositories, no
  `SELECT *`, `HttpException` or plain `Error` in `src/`, and every error is an `AppError`. The
  Swagger output for the three routes lists access, idempotency, `429` and each route's own errors
  (checked in `contracts/openapi.yaml`).
- **Personal data.** History items carry only kind, label and time. The audit metadata of
  `booking.tickets_resent` is `{ channel: 'email' }`. The log-hygiene test runs at debug level.

## Open, not in this unit

- Until U14's cancellation fan-out lands, `ShowtimeCancellationService.cancelBookings()` is a
  no-op. A confirmed booking of a showtime cancelled in the meantime still reads `confirmed` in
  Upcoming, and Email again still sends it. U14 owns this, and the spec's follow-ups already list
  the fan-out.
