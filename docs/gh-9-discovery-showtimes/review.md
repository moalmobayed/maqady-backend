---
title: U8b — Review of the discovery showtimes
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, discovery, showtimes, ticker, halls, show-date, seed, public]
---

# U8b — Review of the discovery showtimes

Issue #9, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`77e7754..075b969` on `unit/gh-9-discovery-showtimes`, against `docs/system-design.md` (§7.10,
§8, §11), `docs/gh-9-home-and-browse/spec.md` and its follow-ups,
`contracts/drafts/home-page.openapi.yaml`, `docs/reference/prd-v2.md` and `CLAUDE.md`.

## Findings

| # | Severity | Finding | How it was verified | Resolution |
|---|---|---|---|---|
| 1 | minor | `GET /theaters/{id}/showtimes` put the movies of a day in the order of their first showtime and then by **showtime id**. The spec says the tie goes by **movie id**. Two movies whose first showtimes start at the same time, in different halls, came out in the order the showtimes were created. | New unit test `orders movies whose first showtimes start together by movie id, not showtime id` (`test/unit/modules/discovery/showtime-browse.service.test.ts`). It failed before the fix: movie 8 (showtime 1) came before movie 7 (showtime 2). | Fixed in `f808aae`: the day's movie groups are now sorted by first start, then movie id. The test passes. |
| 2 | minor | The fixed-query-count test of `GET /theaters/{id}/showtimes` only added showtimes of a movie the theater already showed. Reading the movie cards once per movie (N+1) would still have passed it. | Changed the service on purpose so `nowShowing()` calls `findPublicMoviesByIds()` once per movie: the original test still passed. The strengthened test schedules a movie the theater didn't show before and checks that it is listed. Against the same per-movie change it fails (12 queries expected, 14 received). The change was reverted afterwards. | Fixed in `09e951f` (test only). With the real code the suite passes 12/12. |

No blocker or major findings. What else was checked and found correct:

- **Visibility.** Only scheduled showtimes, of `active` theaters (their ids are passed to every
  U7 read) and Now showing movies, are shown. Cancelled showtimes, draft and paused theaters, and
  draft, archived and Coming soon movies are left out on every route. The ticker filters by Now
  showing after the per-movie `DISTINCT ON`, which is correct because each movie keeps its own
  row.
- **Cinema day.** Lists group by the stored `cinema_date`. Today comes from `cinemaDateOf()`, so
  the 06:00 rollover and summer time are handled. `cinemaDatesFrom()` and `showDateRange()` are
  pure date arithmetic, with no instant math.
- **Time rules match.** `hasStarted` is `startsAt <= now`, and the ticker, side panel and
  show-date filter use `starts_at > now`. Ended showtimes (`endsAt <= now`) are left out.
- **`showDate` with an empty match.** No movie matches → `m.id = ANY('{}')`, which matches
  nothing, never "no filter". Coming soon is refused with `VALIDATION_FAILED` on `showDate`.
  `tabCounts.comingSoon` ignores the filter.
- **No N+1.** Every read is a fixed number of batched queries, and the integration suites count
  them (finding 2 tightened one of those counts).
- **Security.** Every new route is `@Public()` on purpose (read-only, design §11). Responses carry
  only public fields: no staff ids, no theater status, no contacts. No writes, so no idempotency
  concerns. No logging was added.
- **Swagger.** Every new schema has examples; nullable fields (`nextShowToday`, `fromPrice`) are
  marked nullable. 400/404/429/500/503 are declared. `ShowtimeTheaterRef` (discovery) and U7's
  `ShowtimeTheaterRefResponse` have different schema names, so neither overwrites the other.
  `npm run contract` leaves `contracts/openapi.yaml` unchanged.
- **Conventions.** No migration (every query is U7's or U5's and already has an index). Types
  live in `types.ts`. Services throw `AppError`. The seed's plain `Error` is the CLI's own, like
  U8a's steps.
- **Seed.** The step is idempotent: slots are keyed by hall, cinema date and start time, and only
  dry-run `available` dates are created. A run twice at a fixed Clock creates 144 showtimes,
  then 0.

## Gates (fresh, at the final commit)

`npm run typecheck` and `npm run lint` are clean. `npm test`: 1261 unit and 586 integration
tests pass, none fail or are skipped. `npm run build` passes. `npm run contract` followed by
`git status` shows a clean tree.
