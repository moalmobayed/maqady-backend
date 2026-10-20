---
title: U7 — Showtimes - scheduling, overlap checks, dry run, batch create, move, prices
owner: Mohamed Tarek
status: Approved — building
last_verified: 2026-10-20
tags: [showtimes, scheduling, cleaning-gap, exclusion-constraint, opening-hours, summer-time, cinema-day, prices, admin]
---

# U7 — Showtimes: scheduling, overlap checks, dry run, batch create, move, prices

Issue: #8. Docs folder: `docs/gh-8-showtimes/`. Migration prefix `0080`. Depends on U3
(`MessagingService`, `MessageTemplateRegistry`), U5 (`HallReadService`, `HallLifecycleRegistry`)
and U6 (`CatalogReadService`, `MovieLifecycleRegistry`), and through them U4b
(`TheaterReadService`, `TheaterHoursService`, `TheaterLifecycleRegistry`, `MoneyRequest`), U2a
(staff resolver, test helpers) and U1. Design: `docs/system-design.md` §5, §6.1, §6.2
(`showtimes`), §6.3, §7.1, §7.7 (cancelling a showtime), §7.10, §8, §9, §11, §14; PRD v2
"Showtimes", "Halls and seat maps" 4–5, "Theaters and movies" 2, A5, "Notifications".

## Goal

An admin schedules a Now showing movie in an active hall on one or more cinema dates at one
wall-clock start time, sees per date whether it fits (opening hours, the 20-minute cleaning gap,
summer-time nights) before writing anything, creates the dates that fit, and later moves,
re-prices or cancels a showtime. The database itself refuses two showtimes in one hall closer
than 20 minutes apart. Discovery (U8) and holds (U10) read showtimes through one exported read
service; bookings (U10–U14) plug into two seams this unit defines.

## Scope

- Migration `0080_01_create_showtimes` with the exclusion constraint (btree_gist, created by
  `0010_01`).
- `src/modules/showtimes/` (`ShowtimesModule`): repository, `ShowtimeSchedulingService`,
  `ShowtimesService`, the exported `ShowtimeReadService`, the three booking seams
  `ShowtimeCancellationService`, `ShowtimeTicketHolderService` and `ShowtimeSeatClaimService`
  (with their no-bookings defaults), the pure `showtime-time.ts`, two admin controllers, 5 admin
  routes, the two "showtime moved" templates, audit events, complete Swagger.
- The showtime-dependent rules other units left as seams: hall `has_showtimes` (delete) and
  `has_future_showtimes` (retire) blockers, the hall `showtime_capacity` and `hall_in_use` layout
  participants (`HALL_IN_USE` for showtimes that have not ended and have a live seat claim, the
  claims coming from `ShowtimeSeatClaimService`, which U10 rebinds), the theater and movie
  `has_showtimes` deletion blockers.
- Small shared additions: `MessagingService.queueMany()` (U3's module), `formatCairoDisplay()`
  and `cairoWallClockOf()` (`common/time`), `HallReadService.findByIds()` (U5's module).
- Test support: `test/support/showtimes.ts` (`scheduleShowtime()` and friends) for later suites;
  U5's `HallLifecycleProbe` and U4b's `TheaterLifecycleProbe` lose their `has_showtimes` /
  `has_future_showtimes` stand-ins (the keys would clash with the real ones), and the three
  suites that used them schedule real showtimes instead.
- Error codes `SHOWTIME_NOT_SCHEDULABLE`, `SHOWTIMES_NOT_CREATED`, `SHOWTIME_NOT_EDITABLE`.
- `docs/system-design.md` §6.2, §8, §14.3 updated (Decisions below); `docs/INDEX.md`.

## Out of scope

- Bookings, holds, seat claims, refunds. Cancelling calls `ShowtimeCancellationService`, whose
  default (`NoBookingsShowtimeCancellation`) has nothing to refund; moving calls
  `ShowtimeTicketHolderService`, whose default (`NoTicketHolders`) returns nobody. U14 replaces
  the first (refund every confirmed booking, release live holds, the cancellation email and SMS);
  U10/U11 replace the second (confirmed bookings' contacts). Follow-ups on #8 and the U10/U14
  issues.
- Live seat claims (U10). The `hall_in_use` participant asks `ShowtimeSeatClaimService` which of
  the hall's unended showtimes have one; its default (`NoSeatClaims`) answers none, so until U10
  rebinds it no layout save is refused. `ShowtimeReadService.listUnendedInHall()` is exported too.
- `GET /admin/showtimes/{id}/cancellation-preview` and the manage panel's seats sold, occupancy
  and revenue (U14); the payment-versus-cancellation race (U11, U14).
- Public routes (`/movies/{id}/showtimes`, `/theaters/{id}/showtimes`, `/home` ticker: U8;
  `/showtimes/{id}`: U10), from `ShowtimeReadService`. "Sold out" (U10).

## Decisions taken here

| Decision | Why |
|---|---|
| The admin sends a **cinema date** plus a wall-clock `startTime` `HH:mm`. `06:00–23:59` is on that calendar date; `00:00–05:59` is on the next calendar date (`startInstantFor()`), then `wallClockToInstant()` (nonexistent → `TIME_DOES_NOT_EXIST`, twice-occurring → first) | The timeline is drawn per cinema day; same convention as U4b's `closes`. 2026-10-16 + `00:30` is 2026-10-17 00:30, cinema date 2026-10-16. 2026-04-23 + `00:30` doesn't exist. |
| `ends_at = starts_at + runtime` and `cleaning_ends_at = ends_at + 20 min`, absolute durations (`addToInstant`); CHECKs back both | Design §6.2; a summer-time change mid-show doesn't shorten the film. |
| Hours check: `opensAt <= starts_at` and `ends_at <= closesAt`; cleaning may run past closing | Design §8 "starts and ends inside that window". |
| Schedulable: movie `now_showing`, hall `active`, theater in any status; the theater must have default prices unless the request gives prices. Otherwise `409 SHOWTIME_NOT_SCHEDULABLE` `details.reasons` ⊆ `['movie_not_now_showing', 'hall_not_active', 'no_prices']` | Design §8; a draft theater can be scheduled before it is published (customers see only active theaters, U8). |
| A start at or before `Clock.now()` is per date `in_past`, and on a move `VALIDATION_FAILED` on `startTime` | Nothing can be sold for it. |
| Per-date results, first failing check wins: `time_does_not_exist` → `in_past` → `outside_opening_hours` (also a closed or hour-less date) → `conflict` → `available` (dry run) / `created` | One status per date chip (PRD A5: Available, Conflict, Outside opening hours). |
| Batch: 1–31 unique dates inside a 31-day span. `skipUnavailable: true` creates the dates that fit; `false` creates all or nothing. Nothing created (either mode) → `409 SHOWTIMES_NOT_CREATED` `details.results`; else `201` with every date's result | Design §8 "skip the dates that don't fit"; an error commits nothing, so the key rolls back and a retry runs again (U1). |
| Every insert and the move's update run in `TransactionRepository.savepoint()`; a `23P01` on `ex_showtimes_hall_cleaning_gap` is caught, the savepoint rolls back, and one follow-up query names the overlapping showtimes | Design §8; Postgres aborts the transaction on an error, a savepoint does not. Other errors re-throw. |
| Dry run `POST /admin/showtime-checks` is `@NoIdempotencyStorage()`: it writes no row at all, key or not | "Dry run writes nothing", literally. |
| Suggestions: for each date that is not `available`, up to 3 free starts on the wall-clock 5-minute grid (`06:00`…`05:55`, nonexistent ones skipped) that fit the window and the cleaning gap, nearest to the requested time first, earlier first on a tie | Design §8 "suggests free start times on a 5-minute grid". |
| Admin start times may be any minute, not only the 5-minute grid | PRD is silent; the grid is only for suggestions. |
| Lock order everywhere: theater `FOR SHARE` (`TheaterReadService.lockForShare`) → movie `FOR SHARE` (`CatalogReadService.lockMovieForShare`) → showtime `FOR UPDATE` → hall `FOR SHARE` (`HallReadService.lockForShare`) | §7.1 (showtime before hall) plus U4b and U5 (theater first; U5's layout save locks future showtimes before the hall). Serialises scheduling against archiving, hall retire and hours edits. |
| `PATCH /admin/showtimes/{id}` does one of: move (`startTime`, optional `cinemaDate`), prices, both, or cancel (`status: cancelled` + `cancelReason`, alone). Anything else is `VALIDATION_FAILED` | One manage-panel action per request; cancel never mixes with edits. |
| A move keeps the hall and re-runs every check with the movie's **current** runtime; it is refused once the showtime starts. Prices change only before the start. Cancel is allowed until it ends. A cancelled showtime is final. Refusals are `409 SHOWTIME_NOT_EDITABLE` `details.reason` `started`, `ended` or `cancelled` | Design D-22, §7.10. |
| Cancel reasons: `technical_issue`, `print_not_delivered`, `low_sales`, `private_event`; stored with `cancelled_at`. A cancelled showtime leaves the exclusion constraint, so its slot can be reused | PRD "Showtimes" 6. `cancelled_at` added to §6.2 (analytics and the activity log need when). |
| A movie runtime change, or a theater hours change, never touches existing showtimes | Sold tickets stay valid (U4b's same rule); only new scheduling and moves are checked. |
| Prices: `{ front, middle, back }` `MoneyRequest`s, default the theater's `defaultPrices`; `amount` 1–1,000,000; all three in the same currency (`EGP`) | §7.10; U4b's rules. |
| `fromPrice` = the lowest zone price among zones with at least one seat in the hall's current layout (`HallSummary.zoneSeatCounts`), computed at read | §7.10; never stored. |
| `seat_capacity` = `HallSummary.seatCount` when created; refreshed by the `showtime_capacity` participant for the hall's scheduled showtimes with `starts_at > now` when a layout is saved | §8 "Capacity". |
| Hall rules: delete blocked by any showtime row (`has_showtimes`); retire blocked by a scheduled showtime with `ends_at > now` (`has_future_showtimes`, a running show counts) | PRD "Halls" 5, §9. |
| Theater and movie deletion are blocked by any showtime row (`has_showtimes`); FKs with no action back it | PRD "Theaters and movies" 2; U4b and U6 follow-ups. |
| Move notifications: for each ticket holder an email (`showtime.moved`) and, with a phone, an SMS (`showtime.moved_sms`), queued in the move's transaction with one `MessagingService.queueMany()` call | PRD "Notifications"; one multi-row insert, never one per holder. |
| Templates show times as `formatCairoDisplay()` (`Fri 16 Oct 2026, 19:30`), a new `common/time` helper | Only `common/time` converts instants to wall clocks (`CLAUDE.md`). |
| The three booking seams are abstract classes (DI tokens) in `showtimes`; `ShowtimesModule` binds the defaults, and U10/U14 rebind them to bookings' and seating's implementations | Design §5: showtimes calls bookings, bookings never calls showtimes' repository. |
| `HALL_IN_USE` is decided here: the `hall_in_use` participant lists the hall's scheduled showtimes with `ends_at > now` and keeps those `ShowtimeSeatClaimService.showtimeIdsWithLiveClaims()` names | The task scope ("HALL_IN_USE for showtimes that have not ended"); U10 only supplies the claims, so the rule has one owner. Design §9 said U10 registers the participant: updated. |
| `HallReadService.findByIds()` (3 queries) is added to U5's module | `ShowtimeReadService` needs hall names and zone seat counts of many showtimes' halls in a fixed number of queries; U5 had no batch summary read. |
| Open questions from the draft: none. Decided here beyond it: the `hall_in_use` participant and the third seam (above), conflicts found in memory before the insert as well as by the constraint, and the dry run simulating the batch (a date that fits takes its slot for the later dates) | The batch and its dry run must agree; the in-memory check saves a savepoint round trip, the constraint stays the authority. |
| Timeline `GET /admin/showtimes` is a cursor page (`starts_at, id`, kind `instant`, sort key `toISOString()`) wrapped with the day's window and halls; cancelled showtimes included unless filtered | `CLAUDE.md` "cursor on every list"; the PRD timeline shows cancelled slots. |
| No-op `PATCH` answers `200`, no audit row, no message | Same as U2a, U4b, U5. |

## Modules and files

**`src/modules/showtimes/`** — `ShowtimesModule`, imports `TheatersModule`, `HallsModule`,
`CatalogModule` (`MessagingModule` is global). Providers: `ShowtimesRepository`,
`ShowtimeSchedulingService`, `ShowtimesService`, `ShowtimeReadService`, `ShowtimeLifecycleHooks`,
`{ provide: ShowtimeCancellationService, useClass: NoBookingsShowtimeCancellation }`,
`{ provide: ShowtimeTicketHolderService, useClass: NoTicketHolders }`. Exports
`ShowtimeReadService`, `ShowtimeCancellationService`, `ShowtimeTicketHolderService`. `AppModule`
imports `ShowtimesModule`.

| File | Holds |
|---|---|
| `enums.ts` | `SHOWTIME_STATUSES = ['scheduled','cancelled']`, `CANCEL_REASONS = ['technical_issue','print_not_delivered','low_sales','private_event']`, `CHECK_RESULTS = ['available','conflict','outside_opening_hours','time_does_not_exist','in_past']`, `NOT_SCHEDULABLE_REASONS`, `NOT_EDITABLE_REASONS = ['started','ended','cancelled']` |
| `types.ts` | `ShowtimeStatus`, `CancelReason`, `CheckResult`, `ShowtimeRow`, `NewShowtimeRow`, `ShowtimeSpan`, `ShowtimeView`, `ShowtimeConflict`, `DateCheck`, `SuggestedStart`, `ScheduleRequest`, `BatchItemResult`, `ShowtimeChanges`, `TimelineFilter`, `ScheduledShowtimeFilter`, `NextShowtimeFilter`, `ShowtimeTicketHolder`, `ShowtimeCancellationInput`, `ShowtimeCancellationOutcome` |
| `showtimes.constants.ts` | `CLEANING_GAP_MINUTES = 20`, `SUGGESTION_STEP_MINUTES = 5`, `MAX_SUGGESTIONS = 3`, `MAX_BATCH_DATES = 31`, `MAX_DATE_SPAN_DAYS = 31`, `SHOWTIME_GAP_CONSTRAINT = 'ex_showtimes_hall_cleaning_gap'`, `MAX_PRICE_AMOUNT = 1_000_000` |
| `showtime-time.ts` | pure: `startInstantFor(cinemaDate, startTime)`, `showtimeSpan(startsAt, runtimeMinutes)`, `fitsWindow(span, window)`, `overlaps(span, others)`, `suggestStarts(cinemaDate, requested, runtimeMinutes, window, busy, now)`, `fromPrice(prices, zoneSeatCounts)` |
| `showtimes.repository.ts` | `insert`, `findById`, `findByIds`, `findByIdForUpdate`, `update`, `overlapping(hallId, from, to)` (gist), `listTimeline(filter, page)`, `countTimeline(filter)`, `listScheduled(filter)`, `nextScheduledPerMovie(filter)` (`DISTINCT ON (movie_id)`), `movieIdsScheduled(filter)`, `lockFutureInHall(hallId, now)` (`FOR UPDATE`, id order), `refreshCapacity(hallId, seatCount, now)`, `hallIdsWithShowtimes(ids)`, `hallIdsWithUnendedShowtimes(ids, now)`, `listUnendedInHall(hallId, now)`, `existsForTheater(id)`, `existsForMovie(id)` |
| `showtime-scheduling.service.ts` | `ShowtimeSchedulingService`: resolve movie/hall/theater, schedulability, per-date checks, suggestions (dry run, create and move share it) |
| `showtimes.service.ts` | `ShowtimesService`: `check`, `createBatch`, `update` (move, prices, cancel), `get`, `timeline` |
| `showtime-read.service.ts` | the exported reads |
| `showtime-lifecycle.hooks.ts` | `ShowtimeLifecycleHooks.onModuleInit()`: registers the five blockers and participant; registers the two templates |
| `showtime-cancellation.service.ts` | `abstract class ShowtimeCancellationService`, `class NoBookingsShowtimeCancellation` |
| `showtime-ticket-holder.service.ts` | `abstract class ShowtimeTicketHolderService`, `class NoTicketHolders` |
| `templates/showtime-moved.template.ts`, `templates/showtime-moved-sms.template.ts` | `showtimeMovedTemplate` (email), `showtimeMovedSmsTemplate` (sms) |
| `showtime-response.mapper.ts` | `toAdminShowtimeResponse`, `toShowtimePricesResponse`, `toDateCheckResponse` |
| `admin-showtimes.controller.ts` | `@Controller('admin/showtimes')`: timeline, create, get, patch |
| `admin-showtime-checks.controller.ts` | `@Controller('admin/showtime-checks')`: dry run |
| `dto/` | requests: `showtime-id.params.ts`, `timeline.query.ts`, `showtime-prices.request.ts`, `check-showtimes.request.ts`, `create-showtimes.request.ts`, `update-showtime.request.ts`; responses: `showtime-prices.response.ts`, `admin-showtime.response.ts` (`AdminShowtimeResponse`, `ShowtimeMovieRefResponse`, `ShowtimeHallRefResponse`), `admin-showtime-detail.response.ts`, `showtime-timeline.response.ts` (`ShowtimeTimelineResponse`, `TimelineHallResponse`, `OpeningWindowResponse`), `showtime-conflict.response.ts`, `suggested-start.response.ts`, `showtime-check.response.ts` (`ShowtimeCheckResponse`, `DateCheckResponse`), `showtime-batch.response.ts` (`ShowtimeBatchResponse`, `BatchItemResponse`) |
| `showtimes.module.ts` | the module |

Also: `src/modules/messaging/messaging.service.ts` gains `queueMany()`;
`src/common/time/time.ts` gains `formatCairoDisplay()`.

## Migration (prefix `0080`)

**`0080_01_create_showtimes`** — RLS enabled; no defaults; times from the `Clock`.

```sql
CREATE TABLE showtimes (
  id BIGSERIAL PRIMARY KEY,
  movie_id BIGINT NOT NULL,
  theater_id BIGINT NOT NULL,
  hall_id BIGINT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  cleaning_ends_at TIMESTAMPTZ NOT NULL,
  cinema_date DATE NOT NULL,
  price_front INT NOT NULL,
  price_middle INT NOT NULL,
  price_back INT NOT NULL,
  currency VARCHAR(3) NOT NULL,
  seat_capacity SMALLINT NOT NULL,
  status VARCHAR(16) NOT NULL,
  cancel_reason VARCHAR(32) NULL,
  cancelled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_showtimes_movie_id FOREIGN KEY (movie_id) REFERENCES movies (id),
  CONSTRAINT fk_showtimes_theater_id FOREIGN KEY (theater_id) REFERENCES theaters (id),
  CONSTRAINT fk_showtimes_hall_id_theater_id FOREIGN KEY (hall_id, theater_id)
    REFERENCES halls (id, theater_id),
  CONSTRAINT chk_showtimes_span CHECK (ends_at > starts_at),
  CONSTRAINT chk_showtimes_cleaning CHECK (cleaning_ends_at = ends_at + interval '20 minutes'),
  CONSTRAINT chk_showtimes_prices CHECK (price_front BETWEEN 1 AND 1000000
    AND price_middle BETWEEN 1 AND 1000000 AND price_back BETWEEN 1 AND 1000000),
  CONSTRAINT chk_showtimes_currency CHECK (currency IN ('EGP')),
  CONSTRAINT chk_showtimes_seat_capacity CHECK (seat_capacity BETWEEN 1 AND 300),
  CONSTRAINT chk_showtimes_status CHECK (status IN ('scheduled', 'cancelled')),
  CONSTRAINT chk_showtimes_cancel_reason CHECK (cancel_reason IN
    ('technical_issue', 'print_not_delivered', 'low_sales', 'private_event')),
  CONSTRAINT chk_showtimes_cancellation CHECK (
    (status = 'scheduled' AND cancel_reason IS NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL)),
  CONSTRAINT ex_showtimes_hall_cleaning_gap EXCLUDE USING gist
    (hall_id WITH =, tstzrange(starts_at, cleaning_ends_at) WITH &&)
    WHERE (status = 'scheduled')
);
```

All FKs are `NO ACTION`: deleting a theater (cascading its halls) or a movie that has showtimes
fails in the database even if a blocker were missing. `cinema_date` is written by the service
(`cinemaDateOf(starts_at)`), not CHECKed: Postgres's and Node's time-zone data must not have to
agree for an insert to succeed.

| Index | Query it serves |
|---|---|
| `ex_showtimes_hall_cleaning_gap` (gist, partial) | The 20-minute rule; `overlapping(hallId, from, to)`: `hall_id = ? AND status = 'scheduled' AND tstzrange(starts_at, cleaning_ends_at) && tstzrange(?, ?)` (conflict naming, dry run, suggestions) |
| `idx_showtimes_hall_id_theater_id_starts_at (hall_id, theater_id, starts_at)` | Covers `fk_showtimes_hall_id_theater_id`; hall blockers `hall_id IN (…)`; `lockFutureInHall`/`refreshCapacity` `hall_id = ? AND theater_id = ? AND starts_at > ?`; `listUnendedInHall` |
| `idx_showtimes_theater_id_cinema_date_starts_at (theater_id, cinema_date, starts_at)` | Covers `fk_showtimes_theater_id`; timeline `theater_id = ? AND cinema_date = ? ORDER BY starts_at, id`; U8 by theater and date range; theater blocker |
| `idx_showtimes_movie_id_cinema_date_starts_at (movie_id, cinema_date, starts_at)` | Covers `fk_showtimes_movie_id`; U8 by movie and date range; movie blocker |
| `idx_showtimes_cinema_date_starts_at (cinema_date, starts_at)` | U8 ticker `cinema_date = ? AND starts_at > ?` across movies; `movieIdsScheduled` by date range |

## Behaviour

**Resolve and check** (`ShowtimeSchedulingService`, shared):

1. `HallReadService.findById(hallId)` → null `404 NOT_FOUND` (`details.entity: 'hall'`); its
   `theaterId`. In writes: `TheaterReadService.lockForShare(theaterId)` →
   `CatalogReadService.lockMovieForShare(movieId)` (null → `404`, `entity: 'movie'`) →
   `HallReadService.lockForShare(hallId)`. The dry run reads without locks
   (`TheaterReadService.findById`, `CatalogReadService.findMoviesByIds`).
2. Schedulability → `409 SHOWTIME_NOT_SCHEDULABLE { reasons }`.
3. `TheaterHoursService.hoursFor([theaterId], minDate, maxDate)` (one call) and one
   `overlapping(hallId, cinemaDayBounds(minDate).startsAt, cinemaDayBounds(maxDate).endsAt + 20 min)`
   (one query): every date is checked in memory, no query per date.
4. Per date: `startInstantFor` (catch `TIME_DOES_NOT_EXIST`) → `in_past` →
   `fitsWindow` → `overlaps` (the conflict list) → result.

**Dry run** (`POST /admin/showtime-checks`): steps 1–4 plus suggestions; no write, no lock.

**Batch create** (`POST /admin/showtimes`, request transaction): steps 1–3 with locks; prices =
request or theater default. For each date in ascending order: a non-conflict failure is recorded
without a write; otherwise `savepoint(() => insert + audit 'showtime.created')`; a gap violation
→ `conflict` with the follow-up `overlapping()` for that date. Then: nothing created, or a
failure with `skipUnavailable: false` → throw `SHOWTIMES_NOT_CREATED` (everything rolls back);
else `201`. The in-memory conflict check of step 3 is not trusted for writes: the insert is.

**Update** (`PATCH /admin/showtimes/{id}`, request transaction):

1. `findById` → `404`. Theater `lockForShare` → (move) `lockMovieForShare` →
   `findByIdForUpdate` → (move) hall `lockForShare`.
2. `cancelled` → `SHOWTIME_NOT_EDITABLE cancelled`. Move or prices with `starts_at <= now` →
   `started`. Cancel with `ends_at <= now` → `ended`.
3. **Move**: new start from `cinemaDate ?? current cinema_date` and `startTime`; same as the
   current start and no price change → no-op. `TIME_DOES_NOT_EXIST` (422) /
   `VALIDATION_FAILED` (in the past) / `SHOWTIME_NOT_SCHEDULABLE` / `OUTSIDE_OPENING_HOURS` (422,
   `details.window` or `null`) → `savepoint(update starts_at, ends_at, cleaning_ends_at,
   cinema_date)`; a gap violation → `409 SHOWTIME_CONFLICT { conflicts }`. Then
   `ShowtimeTicketHolderService.listTicketHolders(id)` → one `queueMany()` (email per holder with
   an email, SMS per holder with a phone, `related: { customerId, bookingId }`) → audit
   `showtime.moved`.
4. **Prices**: update the three columns → audit `showtime.prices_changed`. New holds only (§7.10).
5. **Cancel**: `ShowtimeCancellationService.cancelBookings({ showtime, reason, actor })` (under the
   showtime `FOR UPDATE`, §7.7) → status `cancelled`, `cancel_reason`, `cancelled_at = now` →
   audit `showtime.cancelled` with the outcome's counts.
6. `200 AdminShowtimeResponse`.

**Lifecycle hooks** (`ShowtimeLifecycleHooks.onModuleInit`):

| Registry call | Key | Rule |
|---|---|---|
| `HallLifecycleRegistry.addDeletionBlocker` | `has_showtimes` | `hallIdsWithShowtimes(ids)` |
| `HallLifecycleRegistry.addRetirementBlocker` | `has_future_showtimes` | `hallIdsWithUnendedShowtimes(ids, now)`: scheduled, `ends_at > now` |
| `HallLifecycleRegistry.addLayoutParticipant` | `showtime_capacity` | `beforeLock`: `lockFutureInHall`; `afterSave`: `refreshCapacity(hallId, layout.seatCount, now)` (one `UPDATE`) |
| `HallLifecycleRegistry.addLayoutParticipant` | `hall_in_use` | `blockingShowtimes`: `listUnendedInHall(hallId, now)` filtered by `ShowtimeSeatClaimService.showtimeIdsWithLiveClaims(ids)` (one call), with movie titles from one `findMoviesByIds` |
| `TheaterLifecycleRegistry.addDeletionBlocker` | `has_showtimes` | `existsForTheater(id)` |
| `MovieLifecycleRegistry.addDeletionBlocker` | `has_showtimes` | `existsForMovie(id)` |

It also registers `showtimeMovedTemplate` and `showtimeMovedSmsTemplate` with
`MessageTemplateRegistry`. Params (`ShowtimeMovedParams`): `bookingReference`, `movieTitle`,
`theaterName`, `hallName`, `previousStartsAt`, `startsAt` (both `formatCairoDisplay`);
`secretParams: []`; the email links to `links.page('/bookings/' + bookingReference)`.

**Audit events** (`AuditService.record`, in the write's transaction, actor = the staff
principal, entity `showtime`; names and scalars only):

| Action | Changed fields / metadata |
|---|---|
| `showtime.created` | `{ movieId, hallId, theaterId, cinemaDate }` |
| `showtime.moved` | `['startsAt']` (+ prices fields if both); `{ previousStartsAt, startsAt, notifiedCount }` (ISO) |
| `showtime.prices_changed` | `['priceFront', …]` the changed ones |
| `showtime.cancelled` | `{ reason, refundedBookingCount, releasedHoldCount, notifiedCount }` |

## Endpoints

All under `/api/v1`, `@Admin()`, `@ApiTags('Admin: showtimes')`, summary, description and
`@ApiErrorResponses(...)` (U1 adds access, idempotency and `429`).

| Route | Idem. | Request | Response | Errors |
|---|---|---|---|---|
| `GET /admin/showtimes` | — | `TimelineQuery` | `200 ShowtimeTimelineResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `GET /admin/showtimes/{id}` | — | `ShowtimeIdParams` | `200 AdminShowtimeDetailResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /admin/showtime-checks` | none stored (`@NoIdempotencyStorage()`) | `CheckShowtimesRequest` | `200 ShowtimeCheckResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `SHOWTIME_NOT_SCHEDULABLE` |
| `POST /admin/showtimes` | **S** | `CreateShowtimesRequest` | `201 ShowtimeBatchResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `SHOWTIME_NOT_SCHEDULABLE`, `SHOWTIMES_NOT_CREATED` |
| `PATCH /admin/showtimes/{id}` | **S** | `UpdateShowtimeRequest` | `200 AdminShowtimeResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `SHOWTIME_NOT_SCHEDULABLE`, `SHOWTIME_NOT_EDITABLE`, `SHOWTIME_CONFLICT`, `OUTSIDE_OPENING_HOURS`, `TIME_DOES_NOT_EXIST` |

**Request DTOs**

- `ShowtimeIdParams`: `id` positive integer.
- `TimelineQuery` extends `PageQuery`: `theaterId` (positive int, required), `date`
  (`isCalendarDate`, required, the cinema date), optional `hallId`, optional `status`
  (`IsIn(SHOWTIME_STATUSES)`).
- `ShowtimePricesRequest`: `front`, `middle`, `back`: `MoneyRequest` (U4b).
- `CheckShowtimesRequest`: `movieId`, `hallId` (positive ints); `dates` (`CalendarDate[]`, 1–31,
  `ArrayUnique`, each `isCalendarDate`; span ≤ 31 days, else `VALIDATION_FAILED` on `dates`);
  `startTime` (`^([01]\d|2[0-3]):[0-5]\d$`).
- `CreateShowtimesRequest`: the above plus optional `prices` (`ShowtimePricesRequest`) and
  `skipUnavailable` (boolean, required).
- `UpdateShowtimeRequest`: optional `cinemaDate`, `startTime`, `prices`, `status` (`IsIn(['cancelled'])`),
  `cancelReason` (`IsIn(CANCEL_REASONS)`). At least one; `cinemaDate` needs `startTime`;
  `status` and `cancelReason` together and alone.

**Response DTOs** (times `formatCairoIso`)

- `ShowtimePricesResponse` (`@ApiSchema({ name: 'ShowtimePrices' })`, reused by U8/U10):
  `front`, `middle`, `back`: `MoneyResponse`.
- `AdminShowtimeResponse`: `id`, `movie` (`ShowtimeMovieRefResponse` = `{ id, title, status,
  runtimeMinutes, ageRating }`), `theaterId`, `hall` (`{ id, name }`), `startsAt`, `endsAt`,
  `cleaningEndsAt`, `cinemaDate`, `startTime` (`HH:mm` as entered), `status`, `cancelReason`,
  `cancelledAt`, `prices`, `fromPrice` (`MoneyResponse`), `seatCapacity`, `hasStarted`,
  `hasEnded`, `movable`, `cancellable`, `createdAt`, `updatedAt`.
- `AdminShowtimeDetailResponse`: the above plus `theater` (`{ id, name, status }`).
- `ShowtimeTimelineResponse`: `theater` (`{ id, name, status }`), `cinemaDate`, `window`
  (`OpeningWindowResponse` = `{ opensAt, closesAt }` or `null`), `specialDateLabel`, `halls`
  (`TimelineHallResponse[]` = `{ id, name, status, seatCount }`: active halls plus any hall with a
  showtime that day, by name), `items` (`AdminShowtimeResponse[]`), `nextCursor`, `total`. A
  page costs a fixed number of queries.
- `ShowtimeConflictResponse`: `showtimeId`, `movieTitle`, `startsAt`, `endsAt`, `cleaningEndsAt`.
- `SuggestedStartResponse`: `startTime` (`HH:mm`), `startsAt`.
- `ShowtimeCheckResponse`: `movie` (ref), `hall` (`{ id, name }`), `theaterId`, `startTime`,
  `results` (`DateCheckResponse[]` = `{ cinemaDate, result: CheckResult, startsAt, endsAt,
  cleaningEndsAt` (null for `time_does_not_exist`), `window`, `conflicts`, `suggestions }`).
- `ShowtimeBatchResponse`: `results` (`BatchItemResponse[]` = `{ cinemaDate, result: 'created' or a
  failing `CheckResult`, showtime: AdminShowtimeResponse | null, conflicts }`),
  `createdCount`, `skippedCount`.

## Error codes added

| Code | HTTP | Details |
|---|---|---|
| `SHOWTIME_NOT_SCHEDULABLE` | 409 | `{ reasons: ('movie_not_now_showing' \| 'hall_not_active' \| 'no_prices')[] }` |
| `SHOWTIMES_NOT_CREATED` | 409 | `{ results: { cinemaDate, result, conflicts: { showtimeId, startsAt }[] }[] }` |
| `SHOWTIME_NOT_EDITABLE` | 409 | `{ reason: 'started' \| 'ended' \| 'cancelled' }` |

Existing codes gain their shapes: `SHOWTIME_CONFLICT` `{ conflicts: ShowtimeConflict[] }`,
`OUTSIDE_OPENING_HOURS` `{ window: { opensAt, closesAt } | null }`, `TIME_DOES_NOT_EXIST`
`{ date, time }` (U1). An unhandled `23P01` elsewhere stays `409 CONFLICT`.

## Services

**Exported by `ShowtimesModule`** (for U8, U10, U14):

```ts
class ShowtimeReadService {
  findById(id: number): Promise<ShowtimeView | null>;                        // any status
  findByIds(ids: readonly number[]): Promise<ReadonlyMap<number, ShowtimeView>>;
  listScheduled(filter: ScheduledShowtimeFilter): Promise<readonly ShowtimeView[]>;
    // status scheduled; by startsAt, id; from..to ≤ 31 days; fixed query count (U8 by movie, by theater)
  nextScheduledPerMovie(filter: NextShowtimeFilter): Promise<ReadonlyMap<number, ShowtimeView>>;
    // per movie the first scheduled showtime with startsAt > after on cinemaDate (U8 ticker)
  movieIdsScheduled(filter: ScheduledShowtimeFilter): Promise<ReadonlySet<number>>; // U8 date filter
  listUnendedInHall(hallId: number): Promise<readonly HallBlockingShowtime[]>;
    // scheduled, endsAt > now, by startsAt (U10's HALL_IN_USE participant filters by live claims)
}
// ScheduledShowtimeFilter = { from: CalendarDate; to: CalendarDate; movieIds?: readonly number[];
//   theaterIds?: readonly number[] /* U8 passes active theaters */; startsAfter?: Date }
// NextShowtimeFilter = { cinemaDate: CalendarDate; after: Date; movieIds?: readonly number[];
//   theaterIds?: readonly number[] }
// ShowtimeView = { id; movieId; theaterId; hallId; hallName: string; startsAt: Date; endsAt: Date;
//   cinemaDate: CalendarDate; status: ShowtimeStatus; cancelReason: CancelReason | null;
//   prices: ZonePrices; fromPrice: Money; seatCapacity: number; createdAt: Date; updatedAt: Date }

abstract class ShowtimeCancellationService {      // U14 rebinds; default NoBookingsShowtimeCancellation
  abstract cancelBookings(input: ShowtimeCancellationInput): Promise<ShowtimeCancellationOutcome>;
}
// ShowtimeCancellationInput = { showtime: ShowtimeView; reason: CancelReason; actor: StaffPrincipal }
//   (called in the request transaction with the showtime locked FOR UPDATE)
// ShowtimeCancellationOutcome = { refundedBookingCount; releasedHoldCount; notifiedCount }

abstract class ShowtimeTicketHolderService {      // U10/U11 rebind; default NoTicketHolders → []
  abstract listTicketHolders(showtimeId: number): Promise<readonly ShowtimeTicketHolder[]>;
}
// ShowtimeTicketHolder = { bookingId; bookingReference; customerId: number | null;
//   email: string | null; phone: string | null }   (confirmed bookings, one batched query)

abstract class ShowtimeSeatClaimService {         // U10 rebinds; default NoSeatClaims → empty set
  abstract showtimeIdsWithLiveClaims(showtimeIds: readonly number[]): Promise<ReadonlySet<number>>;
}
// called by the hall_in_use layout participant with the hall locked FOR UPDATE (HALL_IN_USE)
```

Also exported by path: `ShowtimePricesResponse`, `toShowtimePricesResponse()`, `fromPrice()`,
`SHOWTIME_STATUSES`, `CANCEL_REASONS`.

**Added to shared modules**: `MessagingService.queueMany(inputs: readonly QueueMessageInput[]):
Promise<readonly QueuedMessage[]>` (same checks as `queue()`; ids from one `nextval` series,
one multi-row `INSERT`, one drain hook); `formatCairoDisplay(instant: Date): string`
(`ccc d LLL yyyy, HH:mm`, Cairo).

**Consumed** (exact names):

- U5: `HallsModule`, `HallReadService.findById()`, `.lockForShare()`, `.listByTheaters()`,
  `HallLifecycleRegistry.addDeletionBlocker()`, `.addRetirementBlocker()`,
  `.addLayoutParticipant()`, `HallBlocker`, `HallLayoutParticipant`, `HallBlockingShowtime`,
  `HallSummary`, `HallLayout`, `ZoneSeatCounts`.
- U6: `CatalogModule`, `CatalogReadService.lockMovieForShare()`, `.findMoviesByIds()`,
  `MovieSchedulingInfo`, `MovieRef`, `MovieLifecycleRegistry.addDeletionBlocker()`,
  `MovieDeletionBlocker`.
- U4b: `TheatersModule`, `TheaterReadService.findById()`, `.lockForShare()`,
  `TheaterHoursService.hoursFor()`, `TheaterLifecycleRegistry.addDeletionBlocker()`,
  `TheaterDeletionBlocker`, `TheaterSummary`, `ZonePrices`, `OpeningWindow`, `CinemaDateHours`,
  `MoneyRequest`.
- U3: `MessagingService.queue()` (via `queueMany`), `MessageTemplateRegistry.register()`,
  `MessageTemplate`, `LinkBuilder`, `renderSimpleHtml()`, `QueueMessageInput`, `QueuedMessage`.
- U1: `TransactionContext.executor()`, `TransactionRepository.run()`, `.savepoint()`, `Strict()`,
  `NoIdempotencyStorage()`, `Admin()`, `CurrentPrincipal()`, `StaffPrincipal`,
  `AuditService.record()`, `Clock`, `cinemaDateOf()`, `cinemaDayBounds()`, `addDays()`,
  `wallClockToInstant()`, `addToInstant()`, `formatCairoIso()`, `isCalendarDate()`,
  `CalendarDate`, `Money`, `money()`, `MoneyResponse`, `PageQuery`, `toPageRequest()`, `toPage()`,
  `PageResponseOf()`, `AppError`, `ApiErrorResponses()`, `isPostgresError()` and `SQLSTATE` (`common/database/postgres-errors`) to recognise the `23P01` on `ex_showtimes_hall_cleaning_gap`.
- U2a (tests only): `createStaffMember()`, `staffToken()`, `listHttpRoutes()`, `samplePath()`.

## Tests

**Unit** (`test/unit/modules/showtimes/`, `test/unit/common/time/`):

- `showtime-time.test.ts` (pure): `startInstantFor('2026-10-16','00:30')` = 2026-10-17 00:30+03:00
  and `cinemaDateOf` of it = 2026-10-16; `('2026-10-16','05:59')` next day, `('2026-10-16','06:00')`
  same day; `('2026-04-23','00:30')` → `TIME_DOES_NOT_EXIST`; `('2026-10-29','23:30')` → first
  occurrence (+03:00); `showtimeSpan` across the April gap keeps the real runtime;
  `fitsWindow` at both edges (end exactly at close fits, one minute over doesn't); `overlaps` at
  19, 20 and 21 minutes; `suggestStarts` grid, ordering, gaps skipped, ≤ 3, none for a closed
  date; `fromPrice` ignores a zone with no seats.
- `showtimes.service.test.ts` (repository, seams and other modules' services mocked): check
  order of per-date results; `skipUnavailable` both ways; `SHOWTIMES_NOT_CREATED` when nothing
  fits; move no-op writes nothing; `SHOWTIME_NOT_EDITABLE` reasons by the `Clock`; cancel calls
  the seam once, under the lock, before the status update; a non-gap `23P01`/`23505` re-throws.
- `showtime-lifecycle.hooks.test.ts`: five registrations with the right keys, two templates.
- Templates: render with `storageLinks`, subject and SMS text contain the display times.
- DTO validation: dates 0 and 32, duplicate dates, span 32 days, `startTime` `24:00`/`7:30`,
  `cinemaDate` without `startTime`, cancel without a reason or with prices, empty `PATCH`.
- `common/time/time.test.ts`: `formatCairoDisplay` in summer and winter time.
- Unit "datastore down → 503" for `ShowtimesService.createBatch`.

**Integration** (`test/integration/modules/showtimes/`, real app and Postgres, `TestClock`;
theaters, halls and movies created through U4b/U5/U6 routes; seams overridden only by
`test/support/showtimes/scripted-ticket-holders.ts` and `recording-cancellation.ts`, our own
implementations of our own interfaces):

- **Exclusion constraint** (direct SQL through `TransactionContext`): in one hall, a start 19 minutes
  after the previous showtime's `ends_at` → `23P01`; 20 minutes, i.e. `starts_at = cleaning_ends_at` → ok;
  another hall → ok; a cancelled showtime doesn't block. **Concurrency**: 10 parallel
  `POST /admin/showtimes` (different keys, overlapping by 10 minutes, `skipUnavailable: false`)
  → exactly one `201`, nine `409 SHOWTIMES_NOT_CREATED` whose conflict names the winner; one row.
- **Opening hours**: start before opening, end after closing, a closed weekday, a special date
  that closes early → `outside_opening_hours`; ending exactly at closing → created.
- **Cinema day**: Fri 16 Oct + `00:30` → `cinemaDate 2026-10-16`, `startsAt
  2026-10-17T00:30:00+03:00`, in the 16 Oct timeline; 24 Apr 2026 + `06:30` → `2026-04-24`.
- **Summer time**: 23 Apr 2026 + `00:30` → per-date `time_does_not_exist` in dry run and batch,
  `422 TIME_DOES_NOT_EXIST` on a move; 29 Oct 2026 + `23:30` → `+03:00` (first occurrence).
- **Batch**: 5 dates with one conflicting and one outside hours, `skipUnavailable: true` → `201`,
  3 created, per-item results in date order, 3 audit rows; same with `false` → `409`, zero rows;
  the transaction stayed usable after the caught `23P01` (later dates created); replay with the
  same key → `Idempotent-Replayed`; no key → `IDEMPOTENCY_KEY_REQUIRED`; prices default to the
  theater's and override when given; `seatCapacity` = hall seats.
- **Dry run writes nothing**: row counts of `showtimes`, `idempotency_keys`, `audit_events`,
  `messages` unchanged, with and without a key; suggestions are free, on the grid, inside hours.
- **Schedulability**: coming soon / archived movie, draft / retired hall, theater without prices
  and no prices given → `409 SHOWTIME_NOT_SCHEDULABLE` with the reasons; unknown ids → `404`.
- **Move**: re-checks hours and gap (moving next to itself is fine); `SHOWTIME_CONFLICT` names the
  blocker; after start (`TestClock`) → `SHOWTIME_NOT_EDITABLE started`; recomputes `endsAt`,
  `cinemaDate`; with two scripted holders (one with phone) → 2 emails + 1 SMS rows queued in one
  insert, rolled back with a failing move; prices change only the row's prices.
- **Cancel**: until end allowed, after → `ended`; second cancel → `cancelled`; the recording seam
  is called once with the reason; the freed slot can be rescheduled.
- **Hall, theater, movie rules**: a hall with any showtime → `DELETE` `409 HALL_NOT_DELETABLE
  ['has_showtimes']` and `deletable: false`; retire with a not-ended scheduled showtime → `409
  HALL_NOT_RETIRABLE ['has_future_showtimes']`, after it ends (`TestClock`) or is cancelled →
  `200 retired`; a layout save refreshes `seat_capacity` of future showtimes only; draft theater
  with a showtime → `THEATER_NOT_DELETABLE ['has_showtimes']`; movie with a showtime →
  `MOVIE_NOT_DELETABLE ['has_showtimes']`.
- **Locks**: a hall retire waiting on a create's `FOR SHARE` sees the new showtime and is refused
  (recorded order of events); archiving a movie concurrently with a create serialises.
- **Reads**: `listScheduled`, `nextScheduledPerMovie`, `findByIds` issue the same number of
  queries for 1 and 20 showtimes; `fromPrice` follows the layout's zones; the timeline pages
  (25 showtimes → 20 + 5) with `window` and `halls`.
- **Access**: every route from `listHttpRoutes()` under `/api/v1/admin/showtime*` (asserted to be
  the 5 above) → `403 FORBIDDEN` with a box-office token, `401` with none.
- **Contract**: `npm run contract` regenerates `contracts/openapi.yaml` with the 5 operations,
  `ShowtimePrices` and the three codes.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass, proving issue #8: the exclusion constraint refuses overlaps closer than
  20 minutes in one hall, also under concurrent inserts; scheduling outside opening hours is
  refused; a showtime after midnight belongs to the previous cinema date; a nonexistent
  wall-clock time on the summer-time night is refused; batch create reports per-item results with
  savepoints; dry run writes nothing; hall retire and delete rules; every admin showtime route
  refuses a box-office token with `FORBIDDEN`.
- `docs/system-design.md` §6.2 (`cancelled_at`, CHECKs, indexes), §8 (cinema-date input
  convention, per-date results, lock order with the movie) and §14.3 (three codes) updated;
  follow-ups recorded for U10 (`ShowtimeTicketHolderService`, `HALL_IN_USE` participant over
  `listUnendedInHall`), U14 (`ShowtimeCancellationService`, cancellation preview, manage-panel
  sales figures) and U8 (`ShowtimeReadService`); `docs/gh-8-showtimes/spec.md` is this draft.
