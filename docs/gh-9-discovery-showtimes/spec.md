---
title: U8b — Discovery showtimes - the real ticker, hall counts, showtime reads, show-date filter, seed showtimes
owner: Mohamed Tarek
status: Implemented
last_verified: 2026-10-20
tags: [discovery, showtimes, ticker, halls, cinema-day, prices, show-date, seed, public]
---

# U8b — Discovery showtimes

Issue: #9 (the second half of U8 Discovery). Docs folder: `docs/gh-9-discovery-showtimes/`.
Migration prefix `0085` (no migration: see "Migrations"). Built on U8a
(`docs/gh-9-home-and-browse/spec.md`, its seams and follow-ups), U7 Showtimes
(`docs/gh-8-showtimes/spec.md`, `ShowtimeReadService`) and U5 Halls (`docs/gh-6-halls/spec.md`,
`HallReadService`), all merged into `main-jf8hqi` before this unit started. Design:
`docs/system-design.md` §5, §6.1, §7.10 (prices), §8 (cinema day), §11 (public routes), §14;
PRD v2 C1–C5, "Showtimes", "Prices", "Time"; the contract agreed with the frontend,
`contracts/drafts/home-page.openapi.yaml` (`TickerItem`, `TheaterCard.hallCount`).

## Goal

The customer site gets everything that needs showtimes: the home page ticker and hall counts
become real, a movie's page shows its showtimes over 7 cinema days with a theater picker and its
side panel (next show today, how many cinemas, "from" price), a theater's page shows its halls and
its showtimes, and the Movies page gets its "show date" filter. `npm run seed` schedules a week
of showtimes, so the frontend developer sees all of it on a local database.

## Scope

- Replace the U8a seams in `DiscoveryModule`: `NoShowtimesTickerSource` by
  `ShowtimesTickerSource`, `NoHallsCountSource` by `ActiveHallCountSource`.
- Two new public routes, `GET /movies/{id}/showtimes` and `GET /theaters/{id}/showtimes?date=`,
  in a new `ShowtimeBrowseController`, tag `Discovery`, complete Swagger.
- `GET /movies?showDate=` (Any, Today, Tomorrow, This weekend; Now showing tab only).
- `GET /movies/{id}` gains `showtimeSummary` (the side panel); `GET /theaters/{id}` gains `halls`.
- `npm run seed` gains the `showtimes` step (7 cinema days, after halls and publishing).
- Re-run the `/home` comparison against the draft with a non-empty ticker (tests and `qa.md`).

## Out of scope

- "Sold out" on a showtime chip: it needs seat claims (U10). Follow-up: U10 adds `soldOut` to
  `PublicShowtime` (an additive field) from its availability read.
- `GET /showtimes/{id}` and the seat map (U10), search (U18).
- Changing any showtime, hall, theater or catalog rule. Nothing of U5, U7 or U6 changes.

## Decisions

| Decision | Why |
|---|---|
| Discovery reads showtimes only through U7's exported `ShowtimeReadService` and halls only through U5's `HallReadService`; it still owns no table | Design §5: modules talk through exported services; U7 built `listScheduled()`, `nextScheduledPerMovie()` and `movieIdsScheduled()` for this unit. |
| Customers see a showtime only when it is `scheduled`, its theater is `active` and its movie is Now showing. A cancelled showtime, a draft or paused theater's, and a Coming soon, draft or archived movie's never appear | PRD "Theaters and movies" 1, 3 (Coming soon is "listed, no sales"); scope. U8 passes the active theaters' ids to every showtime read (U7: "U8 passes active theaters"). |
| The ticker: per Now showing movie, its first scheduled showtime of today's cinema date that starts after the Clock's now (any active theater), soonest first, ties by showtime id | Draft `TickerItem` and `/home` description; PRD C1 "next bookable showtime today". A showtime that has started can't be booked (PRD "Seats and holds" 6). |
| The showtime lists show the cinema days' scheduled showtimes that have **not ended**, each with `hasStarted`; ended ones are left out | PRD C3 time chips have a "Started" state ("Showtimes that have started can't be booked"); an ended show is no use to a customer. |
| Lists are grouped by `cinemaDate`, the stored cinema date (U7 writes it), never by the calendar date of `startsAt`, so a 00:30 show is under the previous date | PRD "Time" 2; design §8. |
| `GET /movies/{id}/showtimes` always answers the 7 cinema days from today's (today first, empty days included) with a theater picker (`theaters`, each with its `showtimeCount`) | PRD C3 "7 cinema days, a theater picker with counts". The frontend filters by theater itself; 7 days of one movie are a few dozen rows. |
| A Coming soon movie answers `200` with 7 empty days; a draft, archived or unknown movie `404 NOT_FOUND` | Same visibility as `GET /movies/{id}` (U8a); Coming soon has no sales. |
| `GET /theaters/{id}/showtimes` answers the 7 cinema days from today's; with `date` only that cinema date. A well-formed `date` outside those 7 days answers that one day with no movies (not an error); a malformed one is `400 VALIDATION_FAILED` | PRD C5 "7 cinema days, each film with its time chips". An open page whose "today" has rolled over at 06:00 must not error; past days are never shown. |
| Movies of a theater day are ordered by their first showtime that day, then movie id; theaters of a movie day by name (ignoring case), then id | "Each film with its time chips" reads in time order; the theater order of U8a. |
| A chip carries the three zone `prices` and the `fromPrice`: U7's cheapest zone price among the zones the hall's layout has seats in | Design §7.10; PRD "Prices" 4; reuse `ShowtimePrices` (U7) and `Money`. |
| The side panel (`showtimeSummary` on `GET /movies/{id}`): `nextShowToday` (the ticker's rule for this movie, with its theater and hall), `cinemaCount` (active theaters with a showtime still to start in the 7 days) and `fromPrice` (the lowest `fromPrice` among those showtimes; null when none) | PRD C3 "the real next show today, how many cinemas show it, and From EGP x". Bookable showtimes only: a started one can't be bought. |
| `showDate`: `today` = today's cinema date, `tomorrow` = the next one, `weekend` = this weekend's Friday and Saturday cinema dates (on a Friday, today and tomorrow; on a Saturday, today only); a movie matches with a scheduled showtime of an active theater on those dates that starts after now | PRD C2 show date filter; PRD "Time" 3 "This weekend means Friday and Saturday". |
| `showDate` is only for the Now showing tab: with `status=coming_soon` it is `400 VALIDATION_FAILED` on `showDate`. With it, `tabCounts.nowShowing` is the filtered total and `tabCounts.comingSoon` ignores it | PRD C2 "show date (… Now showing tab only)"; the Coming soon label must not drop to 0 because of a filter that tab doesn't have. |
| `hallCount` counts `active` halls; the theater page lists them as `halls` (`{ id, name, seatCount, wheelchairCount }`, by name), and its `hallCount` is that list's length (read once) | PRD C1 "hall count", C5 "Hall 3 · 186 seats · 4 wheelchair spaces"; draft halls and retired halls are not open to customers. |
| The seed's `showtimes` step reads each published theater's admin timeline for the 7 dates, asks the dry run (`POST /admin/showtime-checks`) about the dates still missing, and creates the `available` ones (`POST /admin/showtimes`, `skipUnavailable: false`); a started slot, a closed night or a slot outside a night's hours is simply not created | Idempotent through the real admin API like the U8a steps; never a `409` on a re-run, and every rule of U7 applies. |
| Every new read costs a fixed number of queries whatever the number of showtimes, theaters and movies | `CLAUDE.md` "No N+1"; the integration suites count them. |

## Modules and files

`src/modules/discovery/` (changed and new):

| File | Holds |
|---|---|
| `discovery.module.ts` | imports `ShowtimesModule` and `HallsModule` too; binds `HomeTickerSource` → `ShowtimesTickerSource`, `TheaterHallCountSource` → `ActiveHallCountSource`; adds `ShowtimeBrowseService`, `ShowtimeBrowseController`; exports `ShowtimeBrowseService` too |
| `home-ticker.source.ts` | the seam `HomeTickerSource` and `ShowtimesTickerSource` (replaces `NoShowtimesTickerSource`) |
| `theater-hall-count.source.ts` | the seam `TheaterHallCountSource` and `ActiveHallCountSource` (replaces `NoHallsCountSource`) |
| `showtime-browse.service.ts` | `ShowtimeBrowseService`: a movie's and a theater's showtimes, the side panel, the show-date movie ids |
| `show-dates.ts` | pure: `cinemaDatesFrom(today, count)`, `showDateRange(showDate, today)` |
| `showtime-browse.controller.ts` | `GET /movies/{id}/showtimes`, `GET /theaters/{id}/showtimes` |
| `enums.ts` | `SHOW_DATES = ['today', 'tomorrow', 'weekend']` |
| `discovery.constants.ts` | adds `SHOWTIME_DAYS = 7`, `WEEKEND_WEEKDAYS` (Friday 5, Saturday 6) |
| `types.ts` | adds `ShowDate`, `CinemaDateRange`, `PublicShowtimeView`, `ShowtimeTheaterRef`, `MovieShowtimesView` and its groups, `TheaterShowtimesView` and its groups, `NextShowView`, `MovieShowtimeSummary`, `PublicMovieView`; `PublicTheaterView.halls`; `MovieListFilterInput.showDate` |
| `movie-browse.service.ts` | `listMovies()` takes `showDate`; `findMovie()` returns `PublicMovieView` (the movie and its side panel) |
| `theater-browse.service.ts` | `find()` adds the active halls |
| `discovery-response.mapper.ts` | the new response builders |
| `dto/discovery.queries.ts` | `MovieListQuery.showDate`; `TheaterShowtimesQuery` |
| `dto/public-showtime.response.ts` | `PublicShowtimeResponse` (`PublicShowtime`), `ShowtimeTheaterRefResponse` (`ShowtimeTheaterRef`) |
| `dto/movie-showtimes.response.ts` | `MovieShowtimesResponse` and its parts |
| `dto/theater-showtimes.response.ts` | `TheaterShowtimesResponse` and its parts |
| `dto/movie-details.response.ts` | adds `showtimeSummary` (`MovieShowtimeSummaryResponse`, `NextShowResponse`) |
| `dto/public-theater.response.ts` | adds `halls` (`PublicHallResponse`) |

`src/modules/seed/`: `seed.steps.ts` adds the `showtimes` step last; `seed-data.ts` adds
`SEED_SHOWTIMES`; `seed.constants.ts` adds `SEED_SHOWTIME_DAYS = 7`; `types.ts` adds the seed's
showtime types; `seed.command.ts` passes the Clock's now to the steps (`SeedContext.now`).

## Migrations

None. Every query this unit causes is U7's or U5's and already has its index:
`idx_showtimes_movie_id_cinema_date_starts_at` (a movie's 7 days),
`idx_showtimes_theater_id_cinema_date_starts_at` (a theater's days),
`idx_showtimes_cinema_date_starts_at` (the ticker and the show-date filter),
`idx_halls_theater_id_name` (U5, a theater's halls). The `0085` prefix stays unused.

## Endpoints

All `GET`, `@Public()` at the controller, tag `Discovery`, the default rate limit (300 a minute
per route per IP, design §10.6), `Cache-Control: public, max-age=60` (`no-store` on an error,
`DiscoveryCacheInterceptor`), errors `429 RATE_LIMITED`, `500 INTERNAL`,
`503 SERVICE_UNAVAILABLE`, plus those listed. Times are Cairo time with offset (`formatCairoIso`).

| Route | Operation id | Query / params | Response | Errors |
|---|---|---|---|---|
| `/movies/{id}/showtimes` | `listMovieShowtimes` | `id` | `MovieShowtimes` | `400 VALIDATION_FAILED`, `404 NOT_FOUND` |
| `/theaters/{id}/showtimes` | `listTheaterShowtimes` | `id`, `date?` (`YYYY-MM-DD`) | `TheaterShowtimes` | `400 VALIDATION_FAILED`, `404 NOT_FOUND` |
| `/movies` (changed) | `listPublicMovies` | adds `showDate?` (`today`, `tomorrow`, `weekend`) | `MovieCardPage` | `400 VALIDATION_FAILED` (also `showDate` with `status=coming_soon`) |
| `/movies/{id}` (changed) | `getPublicMovie` | — | `MovieDetails` + `showtimeSummary` | as before |
| `/theaters/{id}` (changed) | `getPublicTheater` | — | `PublicTheater` + `halls` | as before |
| `/home` (changed data, same shape) | `getHome` | — | `HomeResponse`: `ticker` filled, `cinemas[].hallCount` real | as before |

### Shared shapes

- `PublicShowtime` (a time chip): `{ id, startsAt, endsAt, cinemaDate, hall: { id, name }
  (ShowtimeHallRefResponse, U7), prices: ShowtimePrices { front, middle, back: Money },
  fromPrice: Money, hasStarted: boolean }`.
- `ShowtimeTheaterRef`: `{ id, name, district, city }`.

### `GET /movies/{id}/showtimes` — `MovieShowtimes`

```
{ movieId, cinemaDate /* today's */,
  theaters: [{ id, name, district, city, showtimeCount }]   // the picker: theaters with a listed showtime, by name
  days: [{ cinemaDate, showtimeCount,                       // exactly 7, today first
           theaters: [{ theater: ShowtimeTheaterRef, showtimes: PublicShowtime[] }] }] }
```

### `GET /theaters/{id}/showtimes?date=` — `TheaterShowtimes`

```
{ theaterId, cinemaDate /* today's */,
  days: [{ cinemaDate,                                       // 7 from today, or the one `date`
           movies: [{ movie: MovieCard, showtimes: PublicShowtime[] }] }] }
```

### `GET /movies/{id}` — `showtimeSummary` (`MovieShowtimeSummary`)

`{ nextShowToday: NextShow | null, cinemaCount: integer ≥ 0, fromPrice: Money | null }`;
`NextShow = { id, startsAt, cinemaDate, theater: ShowtimeTheaterRef, hall: { id, name },
fromPrice: Money }`.

### `GET /theaters/{id}` — `halls` (`PublicHall[]`)

`{ id, name, seatCount, wheelchairCount }` of each `active` hall, by name; `hallCount` equals
`halls.length`.

### `GET /home` — `ticker`

Unchanged shape, exactly the draft's `TickerItem { movie: { id, title }, nextShowtime: { id,
startsAt, cinemaDate, theater: { id, name } } }`, now from `ShowtimesTickerSource`.

## Error codes

No new code. `VALIDATION_FAILED` (a bad id, `date`, `showDate`, or `showDate` with
`status=coming_soon`), `NOT_FOUND` (a movie or theater that is not public), `RATE_LIMITED`,
`INTERNAL`, `SERVICE_UNAVAILABLE`.

## Services

**Exported by `DiscoveryModule`** (U8a's, still there, and new):

```ts
abstract class HomeTickerSource {                // bound to ShowtimesTickerSource
  abstract tickerFor(now: Date, cinemaDate: CalendarDate): Promise<readonly HomeTickerEntry[]>;
}
abstract class TheaterHallCountSource {          // bound to ActiveHallCountSource
  abstract countsOf(theaterIds: readonly number[]): Promise<ReadonlyMap<number, number>>;
}
class DiscoveryResponseMapper { /* U8a's builders plus publicShowtime(), movieShowtimes(),
  theaterShowtimes(), showtimeSummary(), publicHall() */ }
class ShowtimeBrowseService {                    // new; for U18 search if it lists showtimes
  movieShowtimes(movieId: number): Promise<MovieShowtimesView>;              // NOT_FOUND unless public
  theaterShowtimes(theaterId: number, date?: CalendarDate): Promise<TheaterShowtimesView>;
  summaryOf(movie: { id: number; status: PublicMovieStatus }): Promise<MovieShowtimeSummary>;
  movieIdsShowing(showDate: ShowDate): Promise<readonly number[]>;
}
```

**Consumed from U7**: `ShowtimesModule`, `ShowtimeReadService.listScheduled()`,
`.nextScheduledPerMovie()`, `.movieIdsScheduled()`; `ShowtimeView`; `ShowtimePricesResponse`,
`ShowtimeHallRefResponse`. **From U5**: `HallsModule`, `HallReadService.listByTheaters()`,
`HallSummary`. **From U6**: `CatalogReadService.findMoviesByIds()`, `.findPublicMoviesByIds()`,
`isPublicStatus()`. **From U4b**: `TheaterReadService.listActive()`, `.findActive()`. **From
U1**: `Clock`, `cinemaDateOf()`, `addDays()`, `weekdayOfCinemaDate()`, `formatCairoIso()`,
`MoneyResponse`, `AppError`, `ApiErrorResponses`.

### Query cost

Fixed whatever the number of rows, one after the other:

- ticker: the active theaters (5), the next showtimes (1, plus 3 for their halls when there are
  any), the movies (1, plus 1 for posters when any has one).
- hall counts: 1 for the halls, plus 2 (rows, seat marks) when there are any.
- `/movies/{id}/showtimes`: the movie (1–2), the active theaters (5), the showtimes (1 + 3).
- `/theaters/{id}/showtimes`: the theater (5), the showtimes (1 + 3), the movie cards (U6's
  fixed count).
- `/movies?showDate=`: adds the active theaters (5) and the movie ids (1).
- `/movies/{id}`: adds the side panel's theaters (5) and showtimes (1 + 3) for a Now showing movie.

## Seed

The `showtimes` step runs last (after `featured`). `SEED_SHOWTIMES` lists, per published theater,
the slot start times and their movie (all Now showing): 13:30, 16:15, 19:00 and 21:45 everywhere,
plus an after-midnight slot (00:15 Downtown, 00:20 New Cairo) that fits only the Thursday and
Friday nights those theaters stay open late. For each slot it:

1. reads the theater's timeline (`GET /admin/showtimes?theaterId=&date=&status=scheduled`) for the
   7 cinema dates from today's, once per theater;
2. counts as kept the dates that already have a scheduled showtime in the slot's hall at that
   start time;
3. dry-runs the missing dates (`POST /admin/showtime-checks`) and creates the `available` ones in
   one batch (`POST /admin/showtimes`, `skipUnavailable: false`).

A second run creates nothing. On a Thursday before 13:30 the step creates 4 slots × 5 theaters ×
7 days + 2 late slots × 2 nights = 144 showtimes.

## Changes to earlier code

- `src/modules/discovery/*` (U8a): as listed above. `NoShowtimesTickerSource` and
  `NoHallsCountSource` are removed (their unit tests replaced); `FixedTickerSource` stays in
  `test/support/discovery.ts`.
- `src/modules/seed/*` (U8a): the `showtimes` step and `SeedContext.now`.
- `test/integration/modules/discovery/theater-browse.controller.test.ts` (U8a): the fixed query
  count of `/theaters` grows by the hall counts' 3 queries and `/home`'s bound by the ticker's;
  `test/integration/modules/seed/seed.command.test.ts`: runs at a fixed Clock and expects the new
  step and a non-empty ticker; the U8a unit tests of `MovieBrowseService`, `TheaterBrowseService`
  and the seam defaults follow the new constructors.
- `docs/system-design.md`: §5 `discovery` row, §11 discovery paragraph, §18 D-32, §21 U8 row.
- `README.md`: the seed's `showtimes` step and the discovery notes.

## Tests

Unit (`test/unit/modules/discovery/`, collaborators mocked):

- `show-dates.test.ts`: 7 dates from today; `today`, `tomorrow`; `weekend` on each weekday
  (Monday to Thursday the coming Friday and Saturday, Friday both from today, Saturday today
  only, Sunday the next Friday and Saturday).
- `showtime-browse.service.test.ts`: grouping by the stored `cinemaDate` (a 00:30 show under the
  previous date), 7 days with empty ones, theater order and counts, ended showtimes left out and
  started ones marked, only active theaters asked for, a Coming soon movie empty and a draft
  `NOT_FOUND`; theater days with `date`, outside the window, movies ordered by first showtime,
  non-Now-showing movies dropped, `NOT_FOUND`; the side panel; the show-date range and `startsAfter`.
- `home-ticker.source.test.ts`: only active theaters and today's date after now are asked for;
  only Now showing movies kept; soonest first, ties by id; nothing without theaters.
- `theater-hall-count.source.test.ts`: counts active halls, 0 for a theater without, no query for
  no theaters.
- `movie-browse.service.test.ts`: `showDate` passes the movie ids, refuses Coming soon, tab counts;
  `findMovie()` adds the side panel. `theater-browse.service.test.ts`: halls and their count.
- `dto/discovery.queries.test.ts`: `showDate` values; `TheaterShowtimesQuery.date`.

Integration (`test/integration/modules/discovery/`, the real app and Postgres, a `TestClock`):

- `showtime-browse.controller.test.ts`: a movie's 7 days grouped by cinema date with prices and
  `fromPrice`, the 00:30 show under the previous date, cancelled showtimes, draft and paused
  theaters and ended showtimes absent, `hasStarted`, the picker counts; Coming soon `200` empty,
  draft, archived and unknown `404`; a theater's days, `date`, outside the window, movies only Now
  showing, draft and paused theaters `404`, a bad `date` `400`; the responses validate against the
  generated contract; a fixed query count for 1 and many showtimes.
- `home-ticker.source.test.ts`: through `GET /home`: only movies with a showtime still ahead today,
  soonest first, the next one of each, never a started, cancelled, tomorrow's, Coming soon,
  draft-theater or paused-theater showtime; every item validates against the draft's `TickerItem`
  and the whole response against `HomeResponse`; `hallCount` counts active halls only.
- `catalog-browse.controller.test.ts` (added): `showDate` today, tomorrow and weekend with tab
  counts; `showDate` with Coming soon `400`; the side panel.
- `theater-browse.controller.test.ts` (added): the theater page halls.
- `test/integration/modules/seed/seed.command.test.ts`: at a fixed Thursday 10:00, the first run
  creates 144 showtimes, the second none (`showtimes` counted with the other tables), and `/home`
  then has a ticker that validates against the draft.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests prove: the ticker shows only movies with a showtime still ahead in the current cinema
  day, soonest first, and validates against `TickerItem` from the draft; a showtime after midnight
  belongs to the previous cinema date in the movie and theater showtime lists; cancelled
  showtimes, draft movies and non-active theaters never appear; the seed runs twice without
  duplicating showtimes.
- `docs/gh-9-discovery-showtimes/qa.md`: curl of every route added or changed on the seeded
  database, and the `/home` comparison against the draft with a non-empty ticker.

## Follow-ups

- **U10** (holds and live map, #11): add `soldOut` to `PublicShowtime` from the availability
  read (PRD C3 "Sold out" chip state); it is an additive change to the contract.
- **Frontend and owner**: the draft `contracts/drafts/home-page.openapi.yaml` is now fully covered
  with real data (qa.md); deleting it is still the owner's call (U8a follow-up).
