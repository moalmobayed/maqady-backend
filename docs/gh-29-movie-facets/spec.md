---
title: P1 (#29) — Movies list facets - genre counts, cast list and show-date options
owner: Mohamed Tarek
status: Built
last_verified: 2026-11-13
tags: [discovery, movies, facets, genres, people, show-date, frontend-gaps]
---

# P1 (#29) — Movies list facets: genre counts, cast list and show-date options

Issue: #29 (API Data Gaps Report, 2026-11-08), items 1 to 3. Docs folder:
`docs/gh-29-movie-facets/`. Migration prefix range `0290_01` to `0290_09` (none used, see
**Migrations**). Builds on U6 (`CatalogReadService`, the public movie filters), U7
(`ShowtimeReadService`) and U8a/U8b (`MovieBrowseService`, `ShowtimeBrowseService`, the
show-date rules in `src/modules/discovery/show-dates.ts`). Design: `docs/system-design.md` §5,
§8 (cinema dates), §11 (discovery), §14.2 (database access); PRD v2 C2.

## Goal

The Movies page sidebar shows, for the tab and filters the customer has chosen, how many movies
each genre has ("Action 3, Comedy 6"), the actors of those movies to filter by, and how many
movies are showing Today, Tomorrow and This weekend. Pagination hides the full result, so the
numbers are computed on the server over every matching movie, never only the page.

## Scope

`GET /movies` gains one root property, `facets`, beside `items`, `nextCursor`, `total` and
`tabCounts` (all unchanged). Facets are computed over every public movie of the current tab
(`status`) that matches the current filters (`q`, `genres`, `people`, `showDate`). Each facet
ignores its own filter (standard faceting), so the sidebar can show the alternatives to what is
selected; it keeps every other filter.

| Facet | Ignores | Keeps | Value |
|---|---|---|---|
| `genres` | `genres` | `status`, `q`, `people`, `showDate` | every genre (10, seeded), alphabetical like `GET /genres`, each with `count` (0 allowed) |
| `people` | `people` | `status`, `q`, `genres`, `showDate` | the cast (credits in role `actor` or `voice`) of the matching movies, `count` = how many of them each person is in; by `count` desc, then name, then id; at most `PEOPLE_FACET_LIMIT` = 30 |
| `peopleTotal` | as `people` | as `people` | how many cast members match before the cap |
| `showDates` | `showDate` | `status`, `q`, `genres`, `people` | `today`, `tomorrow`, `weekend` in that order, each with `count` and its `cinemaDates` |

`showDates` uses exactly the rules of the `showDate` filter (`showDateRange()` on the Clock's
cinema date, design §8): a movie counts for an option when it has a scheduled showtime at an
`active` theater, on one of the option's cinema dates, that starts after now. An after-midnight
showtime belongs to the previous cinema date; "this weekend" is Friday and Saturday (from today
on a Friday, today only on a Saturday). Only Now showing movies can be scheduled (U7), so on the
Coming soon tab every count is 0; the options and their dates are still listed.

Drafts and archived movies never count anywhere (the public filters only read `coming_soon` and
`now_showing`).

### Changed code

- `catalog` (additive): `MoviesRepository.publicIds(filter)` and
  `MoviesRepository.publicCastCounts(filter, limit)`; `CatalogReadService.listPublicMovieIds()`
  and `CatalogReadService.countPublicCast()`; types `CastCountRow`, `PublicCastCount`,
  `PublicCastCounts`.
- `showtimes` (additive): `ShowtimesRepository.movieDatesScheduled(filter)` and
  `ShowtimeReadService.movieDatesScheduled(filter)`: the distinct (movie, cinema date) pairs of
  the scheduled showtimes matching the filter; type `ScheduledMovieDate`.
- `theaters` (additive): `TheaterReadService.listActiveIds()`, the active theaters' ids in one
  query (the full details cost six).
- `discovery`: `ShowtimeBrowseService.movieIdsShowing(showDate)` is replaced by
  `showDateOptions()`, which reads the active theater ids and the pairs of the widest range once
  and answers every option with its cinema dates and movie ids; the `showDate` filter now takes
  its option's ids from it. `showDateRanges(today)` joins `show-dates.ts`.
  `MovieBrowseService.listMovies()` reads the genres once (for slug resolution and the facet),
  computes the facets and returns them in `MovieListView.facets`. The mapper adds
  `MovieFacetsResponse`.

### Query cost

A fixed number of queries, whatever the number of movies, genres, people or showtimes (GROUP BY
and `= ANY(?)`, no query per row): on top of the list and the tab counts, one genre list, the
active theaters' ids (`TheaterReadService.listActiveIds()`), one pairs query, one genre-count
query, one cast query (with `count(*) OVER ()` for `peopleTotal`), one photo query (skipped when
no photo) and one id query for the show-date counts (skipped when no movie is showing): 12 in
all on the seeded database (see `qa.md`). The discovery cache
(`Cache-Control: public, max-age=60`) is unchanged.

## Out of scope

- `tabCounts` (unchanged), `GET /genres` (unchanged; its `movieCount` stays the tab total),
  `GET /home` (unchanged; the draft contract is not touched), `GET /people` (unchanged).
- Directors, writers and crew in the people facet: the report asks for actors.
- Keeping a selected person in `people` when they fall outside the top 30: the client already
  knows the person it selected; `GET /people?q=` finds anyone else.
- Items 4 to 15 of the report (other packages).

## Migrations

None. Every facet query runs on existing indexes: `movie_genres` by `movie_id` (its primary
key, `pk_movie_genres`), `uq_movie_credits_movie_id_person_id_role` (credits by movie), the
`people` primary key, and the showtime indexes the `showDate` filter already uses
(`idx_showtimes_theater_id_cinema_date_starts_at`, `idx_showtimes_cinema_date_starts_at`). No new index is needed, so no `0290` migration exists.

## API

### `GET /movies` (changed: new root field `facets`)

Query parameters unchanged. Response `MovieCardPage`:

```json
{
  "items": [ ... ],
  "nextCursor": null,
  "total": 4,
  "tabCounts": { "nowShowing": 4, "comingSoon": 1 },
  "facets": {
    "genres": [
      { "id": 1, "name": "Action", "slug": "action", "count": 1 },
      { "id": 4, "name": "Comedy", "slug": "comedy", "count": 0 }
    ],
    "people": [
      { "id": 4, "fullName": "Karim Fahmy", "photo": null, "count": 2 }
    ],
    "peopleTotal": 1,
    "showDates": [
      { "value": "today", "count": 2, "cinemaDates": ["2026-10-16"] },
      { "value": "tomorrow", "count": 2, "cinemaDates": ["2026-10-17"] },
      { "value": "weekend", "count": 3, "cinemaDates": ["2026-10-16", "2026-10-17"] }
    ]
  }
}
```

New schemas (all fields required):

- `MovieFacets { genres: GenreFacet[], people: PersonFacet[] (maxItems 30), peopleTotal: integer ≥ 0, showDates: ShowDateFacet[] }`
- `GenreFacet { id: integer, name: string, slug: string, count: integer ≥ 0 }`
- `PersonFacet { id: integer, fullName: string, photo: Image | null, count: integer ≥ 1 }`
- `ShowDateFacet { value: ShowDate (today | tomorrow | weekend), count: integer ≥ 0, cinemaDates: date[] }`

Errors unchanged (`400 VALIDATION_FAILED`, `503 SERVICE_UNAVAILABLE`).

## Tests

Unit (`test/unit/modules/discovery/`, collaborators mocked):

- `movie-browse.service.test.ts`: each facet gets the filters minus its own; genre facet lists
  every genre in order with 0 for none; show-date counts intersect each option's ids with the
  matching movies; the filter takes its option's ids; the cap is passed; nothing is asked of the
  id query when no movie is showing.
- `show-dates.test.ts`: `showDateRanges()` on a Friday, a Saturday and a Sunday.
- `show-dates.test.ts` also covers `cinemaDatesOf()`.
- `showtime-browse.service.test.ts`: `showDateOptions()` reads one widest range, groups the
  pairs per option by cinema date (a Sunday after midnight reaches the coming weekend), and asks
  nothing without active theaters.

Earlier unit tests changed with the behaviour: `movie-browse.service.test.ts` now expects the
genres read once on every list (they feed the facet) and the showtimes asked on every list;
`showtime-browse.service.test.ts` replaces the `movieIdsShowing()` cases with
`showDateOptions()`. The integration tests of the `showDate` filter are unchanged and green.

Integration (`test/integration/modules/discovery/`, real Postgres):

- `movie-facets.controller.test.ts`: more movies than one page; genre counts equal the number of
  matching movies per genre across pages; a genre filter keeps the other genres' counts but
  narrows people; `q` and `people` narrow genres; people lists the cast (actor
  and voice, not crew) with correct counts, ordered, capped with `peopleTotal`; drafts and
  archived movies never count; the query count is the same before and after 12 more movies
  with cast are added.
- `movie-facets-showtimes.test.ts`: on the showtime world (Friday 16 October 2026 at 18:00), the
  show-date counts follow the Clock: started and cancelled showtimes, draft and paused theaters
  and archived movies don't count, an after-midnight showtime counts for its cinema date, the
  weekend on a Friday, a Saturday and a Sunday; each count equals the `showDate` filter's
  total; the counts ignore `showDate` but follow `genres` and `q`, and `showDate` narrows the
  genre counts; the Coming soon tab has zeros; the query count does not grow with showtimes.
- `theater-read.service.test.ts` (theaters): `listActiveIds()` matches `listActive()` in one
  query.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; `npm run contract`
  leaves `contracts/openapi.yaml` unchanged after it is committed.
- The tests above pass and fail when the behaviour breaks.
- `docs/gh-29-movie-facets/qa.md` records curl evidence against a seeded database.

## Follow-ups

- `ShowtimeReadService.movieIdsScheduled()` has no production caller any more (the filter reads
  `movieDatesScheduled()`); it keeps its integration test. Remove both in a cleanup change.
- A rough index check on staging data once it is reseeded: the cast query groups credits of
  every matching movie; at today's catalog size (tens of movies) it is a few milliseconds, and
  `uq_movie_credits_movie_id_person_id_role` serves the join.
