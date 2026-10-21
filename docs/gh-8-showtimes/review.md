---
title: U7 — Review of showtimes scheduling
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, showtimes, scheduling, cleaning-gap, exclusion-constraint, summer-time, cinema-day, admin]
---

# U7 — Review of showtimes scheduling

Issue #8, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`3792e1d..26a895b` on `unit/gh-8-showtimes`. The unit's own work is `e7ee46b..26a895b`; the
commits before it are the merge of the reviewed U8a tip (`main-jf8hqi`). The review checked the
unit against design §6.2 (`showtimes`), §6.3, §7.1, §7.10, §8, §9 and §11 (admin showtime
routes), PRD v2 "Showtimes", "Halls and seat maps" 4–5, "Theaters and movies" 2 and A5, the
spec, and the `CLAUDE.md` stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. The behaviour fix has tests that failed before
it. The integration suites ran on this tree's own database (`maqady_u7_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **A cinema date near the end of the calendar answered `500 INTERNAL`.** `IsCinemaDate` accepted any real `YYYY-MM-DD` date. For `9999-12-31` the cinema day ends on 10000-01-01, which `addDays()` writes as `+010000-01-01`, and `cinemaDayBounds()` then throws. For any date from `9999-12-01`, U4b's `hoursFor()` range guard adds 30 days and compares the strings, and `+010000-…` sorts before `9999-…`, so it throws as well. This hit the dry run, the batch create, a move (`cinemaDate`) and the timeline (`date`). | A new integration test, `refuses a cinema date too close to the end of the calendar, on every route`, in `admin-showtimes.controller.test.ts`, plus cases in `dto/showtime-requests.test.ts`. Before the fix the dry run answered `500 INTERNAL` for `9999-12-31`. A scratch call of `ShowtimesService.check()` for `9999-12-30` threw `hoursFor() answers at most 31 dates.` | Fixed in `e3389cc`. `IsCinemaDate` now also requires the date `MAX_DATE_SPAN_DAYS` (31) days later to be a `YYYY-MM-DD` date. The last accepted date is `LAST_CINEMA_DATE` (`9999-11-30`), and the test shows it works end to end in the dry run and the timeline. Later dates are `400 VALIDATION_FAILED`. The spec's DTO line says so. |
| R2 | minor | **The booking seams told later units to rebind them in the wrong place.** The doc comments on `ShowtimeCancellationService`, `ShowtimeTicketHolderService` and `ShowtimeSeatClaimService` said U14 and U10/U11 would bind the tokens "in the module that owns them". In Nest a module's own provider wins over an imported one. So a binding made only in the bookings module would leave `ShowtimesModule`'s defaults in force. Cancelling a showtime would refund nobody, a move would notify nobody, and `HALL_IN_USE` would never fire. The integration suites would not catch this, because they swap the seams with `overrideProvider`. | A scratch Nest testing module had a host module with its own default provider, importing an owner module that exports another binding of the same abstract token. The host's consumer received the default. The scratch test was deleted. | Fixed in `875a418`. The seam comments, the `ShowtimesModule` comment, README "Showtimes" and the spec (Decisions and Follow-ups) now say to replace the bindings in `ShowtimesModule`'s own `providers` (`useExisting` the implementation the owning module exports, with that module imported). Only documentation changed. |
| R3 | minor | **Inline types in a service file.** `ShowtimesService` declared each batch date's outcome (`{ check; conflicts }[]`) and the `OUTSIDE_OPENING_HOURS` window detail (`{ opensAt; closesAt }`) inline. `CLAUDE.md` forbids non-trivial inline types in service files. | `grep` of the service file. | Fixed in `55ab175`. They are now `BatchDateOutcome` and `OpeningWindowDetail` in `showtimes/types.ts`. Behaviour is unchanged, and the unit suite stays green. |

No finding stays open.

## Checked and found sound

- **The cleaning gap.** `ex_showtimes_hall_cleaning_gap` is a partial gist exclusion over
  `tstzrange(starts_at, cleaning_ends_at)`, which is half-open by default, so touching ranges are
  allowed (20 minutes) and 19 minutes is refused. `chk_showtimes_cleaning` adds
  `interval '20 minutes'`, an absolute duration on `timestamptz`, so it agrees with
  `addToInstant()` across summer-time changes. A cancelled row leaves the constraint.
- **Concurrency.** The lock order was traced for a create, a move, a cancel, a layout save
  (`lockFutureInHall` → hall `FOR UPDATE`), a hall retire or delete, a theater status or hours
  write, and a movie archive or delete. No cycle was found. Row locks taken `FOR UPDATE` without
  a change do not make the exclusion check wait (the check waits only on uncommitted
  inserts and updates). So the per-hall advisory lock, taken after the hall's `FOR SHARE`,
  serialises the only pair that can deadlock: two conflicting inserts or moves in one hall. A
  cancel racing a create in the freed slot makes the create wait, then succeed. A capacity
  refresh cannot overlap a create, because the create holds the hall `FOR SHARE`.
- **The forecast.** The dry run's single conflict query covers `cinemaDayBounds(first).startsAt`
  to `cinemaDayBounds(last).endsAt + 20 min`. A showtime that passes the hours check starts at or
  after 06:00 and ends by the cinema day's end (`closes_minute ≤ 1800`). So every slot it could
  overlap is in that range, and the forecast, the suggestions and the constraint agree. For
  writes, a forecast `conflict` is still attempted, and a forecast `available` that hits a
  `23P01` becomes `conflict` with a fresh follow-up query. The claim that the dates of one
  request never overlap holds: the same wall-clock start on two cinema dates is at least 23 hours
  apart, and a runtime is at most 600 minutes.
- **Time.** `startInstantFor()` puts `00:00`–`05:59` on the next calendar day, and only
  `common/time` converts. Checked by hand: 16 Oct + `00:30` belongs to 16 Oct, 23 Apr 2026 +
  `00:30` is `TIME_DOES_NOT_EXIST` (Cairo jumps at 00:00 on Friday 24 April), and 29 Oct +
  `23:30` is the first occurrence. `cinema_date` is always `cinemaDateOf(starts_at)`, which
  equals the requested cinema date for every start that exists.
- **Transactions and idempotency.** The create and the update join the request transaction.
  Each insert and each move runs in a savepoint, and only `23P01` on the gap constraint is
  caught. `SHOWTIMES_NOT_CREATED` is thrown, so everything, including the idempotency key, rolls
  back. The dry run is `@NoIdempotencyStorage()` and takes no locks. Messages are queued in the
  move's transaction, and the drain is asked for after the commit.
- **Access and data.** All five routes are `@Admin()` under the global guards, and the access
  test enumerates them from `listHttpRoutes()`. Audit rows carry field names, ids and ISO times
  only. The unit logs nothing. Message payloads are encrypted by U3.
- **Database conventions.** The migration has named FKs, all `NO ACTION`, each covered by an
  index whose leading columns match. It has CHECKs mirroring `enums.ts`, `INT` money with
  `currency`, `TIMESTAMPTZ`, no defaults, a comment on every index naming its query, and RLS.
  No `SELECT *`. Every multi-row read is one query (`whereIn` or ranges), and the timeline, the
  manage panel and `ShowtimeReadService` cost a fixed number of queries.
- **Errors and types.** Services throw only `AppError` and never `HttpException`. Every `catch`
  re-throws or maps. Apart from R3, the unit's interfaces live in `types.ts`.
- **Swagger.** Every operation has a tag, a summary, a description and its error codes, with
  examples for the new detail shapes. Nullable fields (`cancelReason`, `cancelledAt`, `window`,
  `specialDateLabel`, `showtime`, the null spans of `time_does_not_exist`) are marked, nullable
  `$ref`s are wrapped in `allOf`, and enums are named.
- **Acceptance.** Each item of the acceptance list has a passing test. The constraint refuses 19
  minutes, accepts 20 and refuses the second of two concurrent raw inserts. Of 10 parallel
  creates, one wins and nine name it. The opening-hours refusals are tested. 00:30 is on the
  previous cinema date. `TIME_DOES_NOT_EXIST` is refused in the dry run, the batch and a move.
  The batch gives per-item results after a caught `23P01`. The dry run leaves the counts of four
  tables unchanged. The hall retire and delete rules are tested, and a box-office token gets
  `403` on all five routes.

## Notes, not findings

- **U4b's `hoursFor()` range guard** compares `addDays(from, 30)` with `to` as strings. It is
  correct for four-digit years only. This unit no longer sends it anything else (R1), and other
  callers were not checked here because they are outside this unit. A follow-up for U4b, if wanted.
- **Process.** The builder stopped its QA server with `pkill -f "node dist/main.js"`, a pattern
  that could match another agent's server. It is not a code finding. QA in other trees should
  stop the process it started by its PID.

## Gates

Run fresh on `875a418` (the last code change; the commit that adds this file changes only
`docs/`), and again on the final commit with the same results:

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, Prettier clean |
| Test | `npm test` | unit 101 suites, 1213 passed; integration 60 suites, 558 passed; no failures, no skips |
| Build | `npm run build` | exit 0 |
| Contract | `npm run contract`, then `git status` | exit 0; `contracts/openapi.yaml` unchanged, tree clean |
