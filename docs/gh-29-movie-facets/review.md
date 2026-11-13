---
title: "P1 (#29) — Review of the Movies list facets"
owner: Mohamed Tarek
status: Passed — 2026-11-13, no open blocker or major findings
last_verified: 2026-11-13
tags: [review, discovery, movies, facets, genres, people, show-date, frontend-gaps]
---

# P1 (#29) — Review of the Movies list facets

Issue #29 (API Data Gaps Report, items 1 to 3), spec [`spec.md`](spec.md), QA [`qa.md`](qa.md).
Reviewed range: `631a017..8ebe887` on `unit/gh-29-movie-facets`, against the report items, the
spec, `docs/system-design.md` (§8 cinema dates, §11 discovery) and the `CLAUDE.md` stack rules,
anti-patterns and testing policy.

The finding was reproduced with a failing test before it was fixed.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| F1 | minor | **The show-date counts could be non-zero on the Coming soon tab.** The spec, the Swagger description of `ShowDateFacet.count` ("Always 0 on the Coming soon tab") and the `showDate` filter (`400` with `status=coming_soon`) all say show dates belong to Now showing. The facet counted any public movie of the tab with a showtime still to start. Archiving a movie keeps its showtimes, and `MOVIE_STATUS_TRANSITIONS` lets an archived movie return to Coming soon. Such a movie then counted under Today, Tomorrow or This weekend on the Coming soon tab, and no `showDate` request could list it. | A new integration case in `movie-facets-showtimes.test.ts`: Archived Reel (23:00 show tonight at an active theater) is moved back to Coming soon. `GET /movies?status=coming_soon` answered `showDates` counts `[1, 0, 1]` instead of `[0, 0, 0]`. | Fixed in `93858c8`. `MovieBrowseService.facetsOf()` counts show dates only on the Now showing tab, which also skips the id query on Coming soon. The options and their cinema dates are still listed. The spec says so. |

## Checked, with nothing to report

- **Report items 1 to 3.** `facets` sits at the root of `GET /movies` next to `items`, `total`
  and `tabCounts`. It has every genre with its count (item 1), the cast with counts, capped at
  30 with `peopleTotal` (item 2), and Today, Tomorrow and This weekend with their cinema dates
  and counts (item 3). All are computed in SQL over the whole filtered tab, never only the page.
  The integration test walks every page and finds the same counts on each.
- **Counts.** Genre counts read `movie_genres` joined to the filtered movies. Its primary key
  `(movie_id, genre_id)` stops double counting. The cast uses `count(DISTINCT m.id)`, so an
  actor who is also a voice in one movie counts that movie once. `count(*) OVER ()` runs before
  `LIMIT`, so `peopleTotal` is correct past the cap. Drafts and archived movies never count:
  every query goes through `publicFiltered()`, which only reads `coming_soon` and `now_showing`.
  Each facet ignores its own filter and keeps the others, and the code matches the spec's table.
- **Show dates against the filter.** The filter and the facet share one `showDateOptions()`
  read, so they cannot disagree. Its covering range, today to the last weekend date, is at most
  7 cinema dates, within `MAX_READ_RANGE_DAYS`. `listActiveIds()` reads the same rows as
  `listActive()` (`listByStatus('active')`), so the filter keeps its old meaning.
  Cinema dates come back as `YYYY-MM-DD` strings (the shared DATE parser), so comparing ranges
  as strings is correct. The integration suite checks each count against the filter's `total`.
- **N+1 and query cost.** Every facet is one grouped query or one `= ANY(?)` query. The cast
  photos are one batched `findByIds`. The integration tests count queries before and after
  adding 12 movies, and before and after adding showtimes, and the counts do not change.
- **Swagger and schema.** `MovieFacets`, `GenreFacet` (extends `GenreRef`), `PersonFacet` and
  `ShowDateFacet` match what the mapper builds. `GenreFacet` has `id`, `name`, `slug` and `count`.
  `PersonFacet.photo` is the shared `Image` or null. `cinemaDates` is `date[]`. `npm run
  contract` leaves `contracts/openapi.yaml` unchanged.
- **Scope.** There is no migration, so `migration-list.ts` is unchanged. `/home`, `tabCounts`,
  `GET /genres`, the home-page draft and the seed are not touched. The response change is
  additive, and `showDateOptions()` replaced `movieIdsShowing()` with no other caller. No
  contact data, PII or logging is involved. Repositories name their columns, and types live in
  `types.ts`.
- **Tests.** The integration tests run on real Postgres with no mocks. The unit tests mock only
  collaborators. The assertions are exact values (ids, counts, order, the cap and the 32 → 30
  cut), not restatements of the implementation.

## Gates (after the fix)

`npm run typecheck` exit 0; `npm run lint` exit 0 (Prettier clean); `npm test` exit 0:
unit 180 suites, 1970 tests passed; integration 111 suites, 979 tests passed. `npm run build`
exit 0. `npm run contract` exit 0, `contracts/openapi.yaml` unchanged. `git status` clean.

The first full run had one suite fail without failing a test:
`migration.repository.test.ts`'s `afterAll` (`DROP DATABASE … WITH (FORCE)`) went over Jest's
5 s hook timeout while the shared Postgres was under load. The suite passed alone (9/9), and the
second full run above was green. The suite is not part of this package.
