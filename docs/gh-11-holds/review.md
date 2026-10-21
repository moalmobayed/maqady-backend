---
title: U10 — Review of the holds and live seat map unit
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, holds, seat-claims, lock-order, hold-code, websocket, seat-map, rate-limits]
---

# U10 — Review of the holds and live seat map unit

Issue #11, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`77e7754..ae41eee` on `unit/gh-11-holds`. Reviewed against design §6.2 (`bookings`,
`booking_seats`, `seat_claims`, `hold_refusals`), §6.3, §7.1–§7.4, §7.10, §10.3–§10.6, §11, §12
and §14.1, PRD v2 "Seats and holds", "Prices", C6, C7, "Live seat map" and the frontend
integration contract, the spec, and the `CLAUDE.md` stack rules, anti-patterns and testing
policy.

Each finding was reproduced before it was fixed. Every fix has a test that failed before it.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **The `/ws` seat map let one client run the database out of connections.** Each `subscribe` read a snapshot, including a repeat for a showtime whose snapshot was still being read, and Nest's `WsAdapter` handles messages concurrently. Nothing limited snapshot reads either: design §10.6 capped connections and subscriptions, but a refresh of an existing subscription was free. A public HTTP read of the same data (`GET /showtimes/{id}/seats`) is held to 300 per minute. The pool has 5 connections. | A throwaway integration probe on one connection. 200 `subscribe` messages for one showtime caused 200 `seat_claims` queries and sent 1 snapshot. 5,000 messages caused 5,001 queries, and a `GET /showtimes/{id}/seats` sent during the burst took 1.3 s. Then a new case in `seat-map.gateway.test.ts` (a burst of 200 must cost at most 3 reads; it read 201) and a second app limited to 3 reads (the 4th read was still served). New `seat-map.connections.test.ts` cases (`pending` during a read; `rate_limited` per address and window) also failed against the old code. | Fixed in `c37af33`. A `subscribe` while that showtime's snapshot is still pending reads nothing more (`pending`). That snapshot and the events buffered behind it already bring the client up to date, so a burst costs one read. Snapshot reads per client address follow the `default` rate limit (`RATE_LIMIT_DEFAULT`, the same budget as `GET /showtimes/{id}/seats`) in a fixed window judged by the `Clock`. A read beyond it gets `error RATE_LIMITED` and the connection stays open. Windows that have passed are forgotten on the ping sweep. Design §10.6 and §12, the spec and the README record this. |
| R2 | minor | **Each connection's per-showtime generation map only ever grew.** `SeatMapConnections` kept a generation for every showtime id a connection had ever subscribed to, and `unsubscribe` did not remove it. A long-lived connection cycling through ids held more memory with each subscribe until it disconnected. | A new `seat-map.connections.test.ts` case: subscribe to and unsubscribe from 1,000 showtimes, then check that no per-showtime map holds entries. It found 1,000. | Fixed in `c37af33`. The generation now lives on the subscription and comes from one counter per connection, so an unsubscribed showtime leaves nothing behind. A snapshot for a subscription that was replaced (unsubscribe, then subscribe again) is still dropped (tested). |
| R3 | minor | **A hold write judges liveness with the `Clock` time it read before waiting on its locks.** `HoldsService.create` and `claim` read `now` once, at the start. A request that then waits on a lock (a showtime held `FOR UPDATE` by a move, or the same customer's other request) can find a hold that a later-starting request already ended, and still treat it as live at its own older `now`. It then releases that hold again: `hold_expires_at` moves back to the older time, a second `booking.released` audit row is written, and a `seat.released` goes out for a seat a rival has held since. The claim statement's `WHERE` leaves the rival's claim untouched, so no seat is ever held twice. The map shows the seat free until the next event or snapshot, and picking it answers `SEAT_TAKEN`, which the frontend already handles. The same stale `now` lets a claim succeed on a hold that ended during the wait (the next read shows it `abandoned`). | A throwaway integration probe. A customer holds `A2`, then re-picks `B2` 60 s later (which releases `A2`), and a guest holds `A2`. The `TestClock` is then set 30 s back, standing in for a request that read its clock and then waited, and the customer holds `C2`. The seat map received `seat.released ["A2"]` while the guest's claim was still live, booking 1's `hold_expires_at` moved from 10:01:00 to 10:00:30, and `booking.released` was recorded twice for it. | **Open.** The fix is a design decision that every booking writer shares: when a write reads the `Clock` relative to its locks (§7.1, §14.6). U11 adds the "settle due payments first" step, and U13 and U14 add their own writers. Reading the time after the locks also changes bookability (`started`) and the hold's expiry cap, so it should be decided once, for all of them, in U11's design pass. The impact is cosmetic and self-healing, and no seat is ever double-held. |

No blocker was found. The one major finding (R1) is fixed. R3 stays open as minor.

## Checked, with nothing to report

- **Access.** The 6 routes carry exactly one access decorator each: the two seat page `GET`s are
  `@Public()`; holds, release and `GET /bookings/{ref}` are `@Guest()`; claims are `@Customer()`.
  A staff token on a guest route is `UNAUTHENTICATED` (tested). Someone else's booking is
  `NOT_FOUND` on every path, including guests whose hold ended and holds another customer
  claimed. The ownership check runs before anything else is read, so a `404` costs one query.
  The gateway is `@Public()`, and every global guard and interceptor returns early for
  non-HTTP contexts (`getType() !== 'http'`).
- **Hold codes.** 32 random bytes. Only the SHA-256 is stored (`hold_token_hash`, partial
  UNIQUE, CHECKed to exist only on an unowned online hold), and codes are compared with
  `safeEqual`. A malformed or missing code matches no hold. The code is cleared on claim. It
  reaches the client only in the `201`, and in its replay, encrypted in the idempotency row.
  The request hash includes `X-Hold-Token`, so a replay needs the same code. The header is
  redacted in logs and allowed by CORS.
- **Lock order.** Traced create (showtime `FOR SHARE` → hall `FOR SHARE` → customer
  `FOR NO KEY UPDATE` → bookings `FOR UPDATE` in id order → claims by showtime and label), claim
  (customer → bookings → claims) and release (bookings → claims). Each was traced against the
  others, against U5's layout save, U7's move, re-price and cancel, and U9's block. FK checks
  (`seat_claims`, `booking_seats`, `audit_events`, `messages` onto `bookings`) take `KEY SHARE`
  only on bookings the transaction has already locked. Concurrent re-picks by one customer
  queue on the customer row. Two codes racing for one guest hold queue on the booking row, and
  a hold claimed in the meantime is re-checked under the lock and left alone. The suite's
  24-way race and its 20 rounds of swaps produce no `40P01`.
- **Claim statement.** One `INSERT … ON CONFLICT DO UPDATE` per showtime, in showtime id
  order, with rows sorted by label. A sold claim (`claimed_until IS NULL`) is never overwritten.
  `takeOverFrom` contains only bookings this transaction locked and released. A label in both
  the release and the new claim keeps the new claim, and is announced held rather than released.
- **Time.** Expiry is judged only from stored timestamps against the `Clock`: claims, statuses,
  `HALL_IN_USE` and the snapshot. No job runs when a hold ends. `hold_expires_at` is
  `min(now + 5 min, starts_at)` through `addToInstant`. Responses use `formatCairoIso`, tested in
  `+03:00` and `+02:00`. The ping timer is liveness only.
- **Transactions and idempotency.** Both `POST`s are `@Strict()`, and `DELETE` takes an optional
  key. `SEAT_TAKEN` rolls back everything, including the releases of the earlier hold.
  `hold_refusals` is written through `afterRollback()` in its own transaction after the
  connection returns to the pool, never on a second pooled connection. Seat events go out
  through `afterCommit()` only; the probe route and a refused re-pick prove that nothing is
  published.
- **Data model.** Migrations `0110_01` to `0110_05` follow the conventions: `BIGSERIAL` key,
  `BIGINT` FKs, every FK named and covered by an index, every index commented with its query,
  `TIMESTAMPTZ`, no defaults, row level security on, and enum-likes as `VARCHAR CHECK` matching
  `enums.ts`. Money is `INT` minor units with a currency. The contact CHECKs match `customers`'
  own, so copying a customer's contact can never fail an insert.
- **Code rules.** No `SELECT *`, `HttpException`, plain `Error` or silent `catch` in `src/`. No
  N+1 (`whereIn` reads; the only loops are the 5 reference draws and the at most 2 released
  holds). No inline types outside `types.ts`. Knex is reached only through repositories.
- **Contract.** The 6 operations document every error the code can answer. That includes the
  guard and idempotency codes added by the cross-cutting docs, `X-Hold-Token` (required on
  claims), nullable fields and the `BookingStatus`, `NotBookableReason`, `TakenSeatState`,
  `SeatZone`, `BookingChannel` and `BookingOwner` enums.

## Gates (final committed state)

`npm run typecheck`, `npm run lint`, `npm test` (unit 1281 passed, integration 611 passed, none
skipped), `npm run build` and `npm run contract` all passed, and `git status` was clean.
