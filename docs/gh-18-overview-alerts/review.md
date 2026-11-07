---
title: U17 — Review of the Overview and bell unit
owner: Mohamed Tarek
status: Passed — 2026-10-29, no open blocker or major findings
last_verified: 2026-10-29
tags: [review, admin, overview, analytics, kpis, heatmap, alerts, bell, cinema-day]
---

# U17 — Review of the Overview and bell unit

Issue #18, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`25f8886..e2232b3` on `unit/gh-18-overview-alerts`. Reviewed against design §5, §6.2, §11 (the
admin overview and alerts routes), §13.3 and §21, PRD v2 A1 "Overview", "Notifications panel" and
"Dashboard numbers", the spec, and the `CLAUDE.md` stack rules, anti-patterns and testing policy.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **`POST /admin/alert-reads` took `"keys": null` as "mark nothing".** The DTO used `@IsOptional()`, which skips validation for `null` as well as for an omitted field. A sent `null` reached `markRead()` as a non-`undefined` value, `new Set(null)` is empty, and the route answered `200 { markedCount: 0 }`. The contract says `keys` is not nullable, and only omitting it means every current alert. | A probe and then red tests: `{ keys: null }` added to the DTO unit cases (`refuses %j`, failed: no `keys` error) and to the integration loop `refuses malformed keys and pages` (failed: `200` instead of `400`). | Fixed in `d042d6b`: `@ValidateIf(value !== undefined)` in place of `@IsOptional()`, the pattern `update-showtime.request.ts` uses, so a sent `null` is `VALIDATION_FAILED`. Both tests are green; omitting `keys` still marks every current alert. |
| R2 | minor | **The docs said a stale panel never hides a newer alert, but "Mark all as read" does.** Without `keys`, `markRead()` marks every alert current at that call. A failure that lands after the panel was drawn makes a new `failed-payments:<date>:<n+1>` key, and "Mark all" marks it read unseen, so the badge drops to 0. The route description, the request field and the spec implied otherwise. The behaviour itself matches design §13.3 ("marks the current keys seen"). | An integration test, `marks only the panel's keys when sent, every current alert when omitted`: one failure, read the panel, a second failure, then mark the panel's keys (`markedCount 7`, the `:2` key stays unread), then mark all (`markedCount 1`, unread 0). | Fixed in `60bdbc3`: the route and request descriptions and the spec say what "Mark all" marks, and tell the panel to send its keys to mark only what it shows. The contract is regenerated. The new test pins both behaviours. No code change. |

No blocker or major finding was found. R1 and R2 are fixed.

R1 was fixed red before green. R2 changes documentation only. Its test passed before and after,
and records the behaviour the documentation now describes. Every gate was re-run on the final
commit.

## Checked, with nothing to report

- **Money.**
  - Revenue and tickets are the `confirmed` bookings (Confirmed and Completed) of the period's
    showtimes, by `cinema_date`. Held bookings never count, and refunded bookings drop out.
    Cancelling a showtime refunds its bookings, so a cancelled showtime carries no revenue.
  - The method split takes succeeded charges minus every refund. The payments `CHECK`s allow a
    refund to be only `pending` (counter) or `succeeded`, so no failed refund can be subtracted.
  - `PaymentsService.refund()` refunds on the charge's own method, so a method's amount cannot go
    negative unless it is over-refunded, which U16's reconciliation already flags.
  - `SUM` and `COUNT` come back as numbers: `pg-type-parsers.ts` parses `INT8` and `NUMERIC`. So
    `count === 0` is a real zero, and an empty day gives no "0 payments failed" alert.
- **Cinema dates and summer time.**
  - Presets resolve on the server's cinema day.
  - A probe at 2026-10-29 10:00 Cairo time, the day Egypt's summer time ends, answered `to`
    `2026-10-30T06:00:00+02:00` for `today` and for a 7-day range that crosses the change.
  - Heatmap slots use `cairoWallClockOf()`, never offset arithmetic. The unit tests cover every
    slot in both summer and winter time.
  - Failed payments count by `completed_at` within `cinemaDayBounds()`.
- **Alerts.**
  - Keys are built only by `alerts.ts` and stay inside the `CHECK` alphabet.
  - `low-sales` uses the integer test `seats × 100 < 35 × seat_capacity`. A showtime with
    `seat_capacity` 0 raises no alert and never divides by zero.
  - Hall gaps read only `active` halls of `active` theaters, then keep only the days
    `TheaterHoursService` resolves as open. That is one call over the 7 dates, within its 31-date
    limit.
  - The 30-day tidy-up cannot delete a key that is still current: every key belongs to a cinema
    day at most 6 days ahead.
  - Concurrent marks are safe: the insert is `ON CONFLICT DO NOTHING` on the primary key.
- **Paging.** The cursor `[key, position]` is decoded by the shared `decodeCursor(…, 'text')`, so
  the position is a safe integer of at least 1. A key that no longer exists falls back to
  `min(position, length)`, so a tampered or stale cursor neither fails nor reads out of range.
  `toPageRequest()` runs before settlement, so a bad page is refused without side effects.
- **Access.**
  - The Overview is `@Admin()`: box office gets `FORBIDDEN`, a customer `UNAUTHENTICATED`.
  - Both bell routes are `@Staff()`.
  - The acting staff member always comes from `@CurrentPrincipal()`, never from the body.
  - The idempotency scope is the principal, so one member's key cannot replay another member's
    answer.
  - Nothing new is logged or audited, and alert payloads carry no customer data.
- **Transactions.** Both reads settle due payments in their own transaction before reading.
  `markRead()` runs in the request transaction and does not settle, as design §7.5 requires and
  the spec records.
- **Code rules.**
  - No inline types: `grep` for `interface` or `type` declarations outside `types.ts` found none.
  - No plain `Error` or `HttpException`.
  - No `SELECT *`: every column is named.
  - No N+1: names are read with one `whereIn` per table, and the integration test counts the same
    number of queries for 1 and for 30 days.
- **Migration.**
  - `0180_01` is in `migration-list.ts`.
  - The table has a named primary key that covers the named foreign key, carries a comment with
    its queries, and has no defaults.
  - A `CHECK` holds the key alphabet, and row-level security is on.
  - `down` follows the same pattern as `0150_01`.
  - There are no `deleted_at` columns to filter on: halls, theaters, showtimes and movies are
    never soft-deleted.
- **Contract.** The generated document lists both tags, the access errors (`FORBIDDEN` on the
  Overview) and the nullable ratios and money. `npm run contract` leaves `contracts/openapi.yaml`
  unchanged on the final commit.

## Observation for the owner (not a finding)

`low-sales` alerts are raised for every scheduled showtime later today, whatever the theater's
status. A `sales_paused` theater still gets low-sales alerts for shows it cannot sell. The spec
excludes paused theaters from hall gaps for that reason, but defines `low-sales` without a theater
condition, so the code follows the spec. Excluding paused theaters is a one-line change to the
query if the owner wants it.
