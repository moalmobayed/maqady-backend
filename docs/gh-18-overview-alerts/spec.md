---
title: U17 — Overview and bell - overview analytics, alerts with keys, unread state
owner: Mohamed Tarek
status: Built
last_verified: 2026-10-29
tags: [admin, overview, analytics, kpis, heatmap, alerts, bell, notifications, cinema-day]
---

# U17 — Overview and bell: overview analytics, alerts with keys, unread state

Issue: #18. Docs folder: `docs/gh-18-overview-alerts/`. Migration prefix `0180`. Depends on U16
(the read-only `analytics` module, `PaymentsReportService.periodOf()`, `channelOfMethod()`) and,
through it, U14 (refunds, `idx_payments_completed_at`), U13 (counter sales), U11
(`SettlementService.settleAllDue()`), U7 (showtimes, `seat_capacity`, `cinema_date`), U5 (halls),
U4b (`TheaterHoursService`), U2a (staff) and U1. Design: `docs/system-design.md` §5, §6, §7.4,
§11 (admin overview and alerts routes), §13.3, §14, §21; PRD v2 A1 "Overview", "Notifications
panel", "Dashboard numbers".

## Goal

An admin opens `/admin` and sees how the chain is selling: Revenue, Tickets sold, Occupancy, Avg.
ticket and Counter share for today, 7 or 30 cinema days, each against the same weekday last week
or the period before; revenue by theater with its Online / Counter split, by hall for one
theater, by payment method and by movie; the busy-times heatmap; the last 30 days per theater;
and tonight's shows with how full they are. Both staff roles see the bell: a real unread count and
the panel of what needs attention now (failed online payments today, shows later today under 35%
sold, halls with nothing scheduled on an open day of the next 7), each read once per staff member.

## Scope

- Migration `0180_01_create_staff_alert_reads`.
- `GET /admin/overview` (Admin), `GET /admin/alerts` and `POST /admin/alert-reads` (Staff).
- In the `analytics` module: `OverviewService`, `OverviewRepository`, `overview.ts` (pure folds),
  `AlertsService`, `AlertsRepository`, `alerts.ts` (keys, titles, order), two controllers, two
  response mappers, their DTOs.
- Swagger tags `Admin: overview` and `Admin: alerts`; contract regenerated.

## Out of scope

- The overview CSV (U19): it can call `OverviewService.read()` with the same query.
- Admin search (U18), the Activity log (U19).
- Showing a box office member only the alerts whose screens they can open: every staff member sees
  every alert (PRD "Notifications panel (both roles)"); the frontend decides what each link opens
  (Follow-ups).
- Rollups, caches or any timer: everything is computed on read (design §13.3).

## Decisions taken here

| Decision | Why |
|---|---|
| **Period**: `period=today|7d|30d` (that many cinema days ending today, resolved by the server's `Clock`, so a 01:00 visit reads yesterday's cinema day) or `dateFrom` / `dateTo` with the Payments screen's rules (`PaymentsReportService.periodOf()`: both inclusive, the last 7 days by default, at most 366). Both together: `VALIDATION_FAILED` on `period` | PRD A1 "Today, 7 days, 30 days, in cinema days"; a browser can't know the cinema day; the overview CSV (U19) and the Payments screen share the date rules. |
| **Scope**: `theaterId` limits every figure to that theater's showtimes and adds `byHall`; an unknown id is `NOT_FOUND`, checked before settlement | PRD A1 "Scope: all theaters or one", "Revenue by hall when one theater is selected". |
| **Revenue and tickets**: the totals and seats of bookings stored `confirmed` (Confirmed and Completed) on the period's showtimes, counted on the showtime's `cinema_date`; held, failed, abandoned and refunded never count | PRD "Dashboard numbers"; design §13.3 "Grouping by day". |
| **Occupancy**: the scheduled showtimes' tickets ÷ their `seat_capacity` (seats on sale: gaps are not seats, wheelchair spaces are); cancelled showtimes are left out of both | PRD "Occupancy". |
| **Avg. ticket**: revenue ÷ tickets, rounded to whole piastres; null without tickets | PRD "Avg. ticket". |
| **Counter share and the Online / Counter split** come from the ledger: for the period's revenue bookings, succeeded charges minus every refund (a pending counter refund is owed, so it counts) by method; cash and card terminal are the counter (`channelOfMethod()`). A consistent ledger's methods add up to the revenue (U16's reconciliation flags one that doesn't) | PRD "Counter share: share of revenue taken at the box office"; an online booking whose edit difference was paid in cash counts that part at the counter, where it was taken. |
| **Comparisons**: a single day against the same weekday 7 days before (`same_weekday_last_week`), a longer period against the same number of days just before it (`previous_period`); each card carries `value`, `previous` and `change` = `(value − previous) ÷ previous` from the shown values, null when `previous` is 0 or null. "VS PREV" per theater is the same on its revenue | PRD "Comparisons"; design inventory "vs last Thursday", "vs previous 7 days". |
| **Ratios** (occupancy, shares, changes) have 4 decimals: 0.4567 is 45.67% | Matches U16's `refundRate`. |
| **Revenue by theater**: every theater in scope with a showtime in the period, plus any with revenue in the comparison, highest revenue first (then name, id); `byHall` the same per hall; `topMovies` the 5 with most revenue (then tickets, title) | PRD A1; a theater that sold last week and nothing now still shows its drop. |
| **Heatmap**: 35 cells, the cinema date's ISO weekday (1 Monday … 7 Sunday) × the start-time slot by Cairo wall time (`before_15` 06:00–14:59, `15_18`, `18_21`, `21_24`, `after_midnight` 00:00–05:59), each with showtimes, tickets, seats and occupancy ("% of seats sold"), scheduled showtimes only | Design §13.3 "Heatmap slots"; design inventory "Occupancy by day and time". The slot comes from `cairoWallClockOf()`, never offset math. |
| **Revenue · last 30 days**: the 30 cinema days ending on the period's `dateTo`, every date present (0 when none), for all theaters (`totals`) and per theater with revenue in the window (and the selected one), by name | PRD A1 "Revenue · last 30 days by theater". |
| **Tonight**: today's scheduled showtimes still to end, whatever the period, soonest first, at most 20 with the `total`; each with `hasStarted`, tickets, seats, `soldShare` and revenue | PRD A1 "the Tonight list"; the dashboard colours above 85% and below 35%. |
| **Needs attention** on the Overview is the bell's list (`GET /admin/alerts`), not repeated in the overview response | One source for both; the Overview is admin-only, the bell is for both roles. |
| **Alerts computed on read, each with a stable key**: `failed-payments:<cinemaDate>:<count>` (online charges, card or wallet, declined or closed at the wallet, with `completed_at` on today's cinema day; none when 0), `low-sales:<showtimeId>` (a scheduled showtime of today's cinema date that starts after now with Confirmed seats × 100 < 35 × `seat_capacity`), `hall-gap:<hallId>:<cinemaDate>` (an active hall of an `active` theater with no scheduled showtime on that date, for today and the 6 days after it, on days the theater is open) | Design §13.3 "Alerts"; PRD A1 "Needs attention". The count in the failed-payments key makes a new failure unread again. A closed day (a special date, a closed weekday, no hours) is no gap: nothing can be scheduled then (recorded as a deviation in design §13.3). A draft theater is not public yet; a paused one has stopped selling on purpose. |
| **Read state** in `staff_alert_reads` (PK `staff_user_id, alert_key`, `seen_at`): per staff member; the unread count is the current keys with no row for the caller | Design §6.2, §13.3. |
| **`POST /admin/alert-reads`** takes optional `keys` (1 to 200; the panel opening one alert) or marks every current key ("Mark all as read"); only current keys are marked (a stale one is ignored), a key read twice keeps its first `seen_at` (`ON CONFLICT DO NOTHING`), and the caller's reads older than 30 days are deleted on the way (tidying, never correctness: every key is tied to a cinema day at most 6 days ahead). Answers `200 { markedCount, unreadCount, total }`. Not strict (design §11 lists it without **S**; marking is naturally idempotent); a sent `Idempotency-Key` is honoured | Design §11, §13.3. |
| **Settlement**: both reads call `settleAllDue()` first, in its own transaction (design §13.3 "after a batched settleDue"). Marking reads does not: it runs in the request transaction and settlement refuses to run inside one; a decline that settles later makes a new, unread key | Design §7.5, §13.3. |
| **The bell's list** is unread first, then failed payments, low sales (soonest show first), hall gaps (soonest day first, then theater and hall by name), cursor-paged in memory over the computed list (the cursor holds the last key and its position, so a page read while alerts change neither fails nor restarts) with `total` and `unreadCount` for the whole list | CLAUDE.md "Cursor-based, on every list endpoint"; the list is bounded by halls × 7 plus today's showtimes. |
| **Read-only SQL of its own**: the repositories read `showtimes`, `bookings`, `payments`, `theaters`, `halls` and `movies` in aggregate queries (one per figure set, no N+1: names are read in one `whereIn` per table); the only table written is `staff_alert_reads`, which `analytics` owns | Design §5 (`analytics` is a read-only module over the tables it reports on; it owns `staff_alert_reads`). |

## Modules and files

| File | What |
|---|---|
| `src/migrations/0180_01_create_staff_alert_reads.ts` | The table; in `migration-list.ts` |
| `src/modules/analytics/analytics.module.ts` | Adds the two controllers, services, repositories and mappers; imports `TheatersModule`; exports `OverviewService`, `AlertsService` |
| `src/modules/analytics/admin-overview.controller.ts` | `GET /admin/overview` |
| `src/modules/analytics/admin-alerts.controller.ts` | `GET /admin/alerts`, `POST /admin/alert-reads` |
| `src/modules/analytics/overview.service.ts`, `overview.repository.ts`, `overview.ts` | The period, the reads, the folds |
| `src/modules/analytics/alerts.service.ts`, `alerts.repository.ts`, `alerts.ts` | The conditions, the read state, keys, titles and order |
| `src/modules/analytics/overview-response.mapper.ts`, `alerts-response.mapper.ts` | Response DTOs |
| `src/modules/analytics/dto/admin-overview.query.ts`, `admin-overview.response.ts`, `alert-reads.request.ts`, `admin-alert.response.ts` | DTOs |
| `src/modules/analytics/types.ts`, `enums.ts`, `analytics.constants.ts` | Types, enums (`OVERVIEW_PERIODS`, `COMPARISON_BASES`, `SHOWTIME_SLOTS`, `ALERT_KINDS`), limits |
| `src/common/swagger/swagger.constants.ts` | The two tags |
| `test/support/overview-alerts.ts` | `getOverview()`, `listAlerts()`, `markAlertsRead()`, `bookableFixture()` |

## Migration (prefix `0180`)

- `0180_01_create_staff_alert_reads`: `staff_user_id BIGINT NOT NULL` (`fk_staff_alert_reads_staff_user_id`
  → `staff_users`, no `ON DELETE`: staff are deactivated, never deleted), `alert_key VARCHAR(200) NOT NULL`
  (`chk_staff_alert_reads_alert_key`: `^[a-z0-9:-]{1,200}$`), `seen_at TIMESTAMPTZ NOT NULL` (no
  default: the `Clock`), `pk_staff_alert_reads (staff_user_id, alert_key)` (covers the foreign key;
  commented with its queries), row-level security on. A new table only, so the previous release
  runs beside it (design §6.1).
- No new index elsewhere: the Overview reads `idx_showtimes_cinema_date_starts_at` /
  `idx_showtimes_theater_id_cinema_date_starts_at`, `idx_bookings_showtime_id_status` and
  `idx_payments_booking_id_created_at`; the failed payments `idx_payments_completed_at`; the hall
  gaps `idx_showtimes_theater_id_cinema_date_starts_at`.

## Endpoints

All under `/api/v1`, JSON in camelCase, times in Cairo ISO, money `{ amount, currency }` in
piastres. All also answer `401` (`UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED`; a
customer token is `UNAUTHENTICATED`), `403 ACCOUNT_DEACTIVATED`, `429 RATE_LIMITED`,
`500 INTERNAL`, `503 SERVICE_UNAVAILABLE`.

| Route | Access | S | Success | Request | Errors |
|---|---|---|---|---|---|
| `GET /admin/overview` | Admin | | `200 AdminOverview` | `period`, `dateFrom`, `dateTo`, `theaterId` | `400 VALIDATION_FAILED` (a bad preset or date, a preset with dates, `dateTo` before `dateFrom`, over 366 days, a bad id); `403 FORBIDDEN` (box office); `404 NOT_FOUND` (unknown theater) |
| `GET /admin/alerts` | Staff | | `200 AdminAlertPage` | `cursor`, `limit` | `400 VALIDATION_FAILED` (a bad cursor or limit) |
| `POST /admin/alert-reads` | Staff | | `200 AlertReadResult` | `AlertReadsRequest { keys? }` | `400 VALIDATION_FAILED` (an empty list, a malformed key, over 200 keys, another field); `422 IDEMPOTENCY_KEY_REUSED`, `413 PAYLOAD_TOO_LARGE` |

`AdminOverview`: `period { preset, dateFrom, dateTo, days, from, to }`, `comparison { basis,
dateFrom, dateTo, days, from, to }`, `theater` (`NamedRef` or null), `cinemaDate`, `serverTime`,
`kpis { revenue (MoneyKpi), ticketsSold (CountKpi), occupancy (RatioKpi), averageTicket
(OptionalMoneyKpi), counterShare (RatioKpi) }` (each `{ value, previous, change }`), `byTheater
[TheaterRevenue { theater, revenue, ticketsSold, seatsOnSale, occupancy, showtimeCount,
averageTicket, online, counter, previousRevenue, change }]`, `byHall` (`[HallRevenue { hall, …
SalesFigures }]` or null), `paymentMethods [MethodRevenue { method, amount, share }]` (all four),
`topMovies [MovieRevenue { movie, … SalesFigures }]`, `heatmap [HeatmapCell { weekday, slot,
showtimeCount, ticketsSold, seatsOnSale, occupancy }]` (35), `revenueTrend { dateFrom, dateTo,
totals [RevenuePoint { cinemaDate, revenue }], theaters [{ theater, points }] }`, `tonight {
cinemaDate, items [TonightShowtime { showtimeId, startsAt, endsAt, cinemaDate, hasStarted, movie,
theater, hall, ticketsSold, seatCapacity, soldShare, revenue }], total }`.

`AdminAlertPage`: `items [AdminAlert { key, kind (failed_payments, low_sales, hall_gap),
cinemaDate, title, read, readAt, failedPayments { count } | null, lowSales { showtimeId, startsAt,
movie, theater, hall, ticketsSold, seatCapacity, soldShare } | null, hallGap { hall, theater } |
null }]`, `nextCursor`, `total`, `unreadCount`, `cinemaDate`, `serverTime`.

`AlertReadResult`: `markedCount`, `unreadCount`, `total`.

## Exported services (for U19 and later)

- `OverviewService.read(query)` → `Overview` (the overview CSV exports this view) and
  `periodOf(query)`.
- `AlertsService.current(now)` → `Alert[]` (every alert that holds at `now`, no read state; runs on
  the current executor, so inside a transaction too), `page(staffUserId, page)`,
  `markRead(staffUserId, keys?)`.
- Pure helpers: `overview.ts` (`ratioOf`, `relativeChange`, `slotOf`, `comparisonDatesOf`, the
  folds) and `alerts.ts` (`failedPaymentsKey`, `lowSalesKey`, `hallGapKey`, `sortAlerts`).

## Tests

- Unit (`test/unit/modules/analytics/…`, collaborators mocked): `overview.test.ts` (ratios and
  changes, dates and comparisons, every slot by Cairo wall time in summer and winter, the KPI
  figures with cancelled showtimes, the counter share by method, theaters with a lost one, halls,
  top movies, methods, the 35-cell heatmap, the zero-filled trend, Tonight), `alerts.test.ts`
  (keys in the alphabet, titles, the round-down percentage, read state, the order, the cursor's
  restart point), `overview.service.test.ts` (presets against the cinema day, dates, refusals
  before any read, settlement first, the calls of a scoped and an unscoped read, `NOT_FOUND`
  before settling), `alerts.service.test.ts` (today's bounds and the 7 dates, gaps on open days
  only, settlement first, unread first, paging, marking only current keys once, the tidy-up,
  never settling), `dto/overview-alerts-requests.test.ts`.
- Integration (`test/integration/…`, real app and Postgres; only Resend replaced):
  `modules/analytics/admin-overview.controller.test.ts` (a two-theater dataset worked out by hand:
  every KPI and its comparison in piastres, revenue by theater with Online / Counter and VS PREV,
  methods, top movies, the heatmap, Tonight, the trend; 7 days against the 7 before; one theater
  with revenue by hall; an after-midnight show on the day before and a 06:30 show on its own day;
  "today" at 01:00 and 06:00; a fixed query count for 1 and 30 days; refusals; admins only),
  `modules/analytics/admin-alerts.controller.test.ts` (one alert per condition and key, the same
  for two staff members; read state per member and the unread count; a new failure unread again
  and a stale key ignored; low sales gone at 35% and once started; a gap filled and back after a
  cancellation; a closed day and a draft hall never a gap; paging; the tidy-up; refusals; both
  roles, never customers), `modules/analytics/dto/admin-overview-alerts-contract.test.ts`,
  `migrations/0180_staff_alert_reads.test.ts`.

## Acceptance

- [x] Overview numbers match a seeded dataset, hand-computed in piastres.
- [x] Ranges follow the cinema date (06:00 to 06:00 Cairo time), for dates and for the presets.
- [x] The same alert condition raises one alert per key.
- [x] Read state is per staff member, and the unread count updates.
- [x] Role rules: the Overview is admin-only (box office `FORBIDDEN`); the bell is for both roles;
  customers are refused everywhere.
- [x] Gates pass against the committed state; `contracts/openapi.yaml` is current.

## Follow-ups

- A box office member sees alerts whose screens (Payments, Showtimes) are admin-only; the panel
  could point them at Bookings instead, or the bell could filter by role, if the frontend asks.
- The heatmap's weekday is the cinema date's; the prototype labels rows Sunday first. The order is
  the frontend's to choose.
- The Overview reads one row per showtime of the period (at most 366 days); a chain much larger
  than Cairo and Giza's would want the folds pushed into SQL `GROUPING SETS`.
