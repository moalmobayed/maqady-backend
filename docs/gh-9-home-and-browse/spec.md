---
title: U8a — Home and browsing reads - GET /home, genres, movies, similar, people, theaters, seed
owner: Mohamed Tarek
status: Implemented
last_verified: 2026-10-20
tags: [discovery, home, movies, genres, people, theaters, open-state, seed, public]
---

# U8a — Home and browsing reads

Issue: #9 (the first half of U8 Discovery). Docs folder: `docs/gh-9-home-and-browse/`. Migration
prefix `0085` (no migration: see "Migrations"). Built on the reviewed tips of U4b Theaters
(`docs/gh-5-theaters/spec.md`) and U6 Catalog (`docs/gh-7-catalog/spec.md`), merged into this
branch before the unit's own work. Design: `docs/system-design.md` §5 (modules), §6.1, §8
(cinema day), §9, §11 (public routes), §13.2, §14; PRD v2 C1–C5, "Theaters and movies", "Time";
the contract agreed with the frontend, `contracts/drafts/home-page.openapi.yaml`.

## Goal

The frontend engineer is building the customer home page now. `GET /home` returns exactly the
`HomeResponse` of the agreed draft from the real catalog and theaters, and the browsing pages
behind it (Movies, Movie details, Theaters, Theater details) get their reads. A development seed
(`npm run seed`) fills a local database with realistic Cairo and Giza data, so the home page has
something to show.

U8b (another workflow, after U5 Halls and U7 Showtimes) adds everything that needs showtimes:
the ticker's data, hall counts and halls, `GET /movies/{id}/showtimes`,
`GET /theaters/{id}/showtimes`, the "show date" filter and the showtime seed data. This unit
leaves a seam for each (see "Seams for U8b").

## Scope

- `src/modules/discovery/` (`DiscoveryModule`): three public controllers, the services that
  read through `CatalogReadService`, `TheaterReadService` and `TheaterHoursService`, the response
  mapper, the response DTOs and the two seams (`HomeTickerSource`, `TheaterHallCountSource`).
- Eight public routes, tag `Discovery`, complete Swagger.
- A small, generic hook in `common/swagger` for component schemas Nest can't express
  (`GenreWithCount` is an `allOf` in the draft).
- `npm run seed`: `src/cli/seed.ts` and `src/modules/seed/`.
- Exact dev dependencies `ajv` 8.18.0 and `ajv-formats` 3.0.1 (both already in the tree through
  `@angular-devkit`), for the test that validates a real `/home` response against the draft.

## Out of scope

- Anything that needs showtimes or halls (U8b, above). `hallCount` is `0` and `ticker` is `[]`
  until then, from the default seam providers.
- `GET /search` (U18), the Movies page "show date" filter, the movie side panel (next show
  today, cinemas showing it, "from" price): U8b.
- Changing catalog or theater rules. Nothing of U4b or U6 is changed except as listed under
  "Changes to earlier code".

## Decisions

| Decision | Why |
|---|---|
| Discovery reads only through the exported `CatalogReadService`, `TheaterReadService` and `TheaterHoursService`; it has no repository and no table | Design §5: modules talk through exported services. Both units built those reads for U8. |
| Every route is `@Public()` at the controller and has the default rate limit (300 a minute per route per IP) | §11 lists them Public; §10.6 gives every route the default limit; none is a search. |
| Public means `coming_soon` or `now_showing` movies and `active` theaters. A draft, archived or unknown movie and a draft, `sales_paused` or unknown theater answer `404 NOT_FOUND` | PRD "Theaters and movies" 1 and 3; §9 "Customers see only active theaters". |
| `GET /home` and every discovery read send `Cache-Control: public, max-age=60` | The draft says home responses may be cached 60 seconds; the other reads change no faster. |
| Lists are cursor-paginated (`{ items, nextCursor, total }`, default 20, at most 100) — including `/genres` and `/theaters`, which page in memory over the whole set the read services return (ten genres; theaters in the tens) | §11 and `CLAUDE.md`: every list endpoint. The in-memory page uses the same cursor codec and stays stable while rows are added. |
| `GET /movies/{id}/similar` returns `{ items }` with at most 4 movies, not a page | PRD C3 "up to 4": a bounded recommendation, not a list the client pages through. |
| `GET /movies?genres=` takes genre **slugs**, comma-separated; an unknown slug is `VALIDATION_FAILED` on `genres` | The draft's `GenreRef.slug` is "for links such as `/movies?genres=sci-fi`"; genres are a fixed seeded list, so an unknown slug is a broken link worth reporting. |
| `GET /movies?people=` takes person ids, comma-separated (at most 20) | PRD C3 "each name opens Movies filtered by that person". |
| `GET /movies` also returns `tabCounts` (both tabs' totals with the same filters) | PRD C2 "Tabs … with counts". |
| `GET /genres?status=` counts one tab; without it, both | The home page counts both (the draft's `movieCount`); the Movies page counts the open tab. |
| Theater order is alphabetical by name, ignoring case, then id; home `cinemas` and `/theaters` share it | Draft: "every theater open for sales, alphabetical". One comparator, so the in-memory cursor and the order agree. |
| `/theaters?openNow=true` keeps theaters open at the Clock's now; `parking=true` keeps theaters with `free_parking` or `valet_parking` | PRD C4 filters "Open now" and "Parking (free or valet)". |
| Contacts follow `showContactsPublic`: when off, `mainPhone` is null, `phones` is `[]` and `email` is null | PRD C5; the draft's `mainPhone` "Null when the theater hides its contacts". |
| The theater page lists special dates of the next 7 cinema days, today included | PRD C5 "special dates in the next 7 days". |
| Image alt texts: poster "<title> poster", backdrop the title, a movie photo its caption or the title, a person photo the name, a theater cover the theater name, a gallery photo its caption or the theater name | The conventions of U6's and U4b's admin mappers; the draft examples. |
| The ticker and hall counts come from injectable seams with empty defaults | The fields are always present (the draft requires them); U8b swaps the providers. |
| `npm run seed` drives the real HTTP API of an in-process app (validation, transactions, idempotency, audit rows and the image pipeline all apply), signed in as a seed admin it creates through `StaffService` | "Through the real services where practical": the admin routes are the most complete path, and the seed admin lets the frontend developer sign in to the dashboard too. |
| The seed refuses `NODE_ENV=production`, a `STORAGE_DRIVER` other than `local` and an `EMAIL_DRIVER` other than `simulated` | A development tool must never write to real storage or send email. |

## Modules and files

`src/modules/discovery/`:

| File | Holds |
|---|---|
| `discovery.module.ts` | imports `CatalogModule`, `TheatersModule`, `MediaModule`; providers: the services, the mapper and the two seams' default providers; exports `HomeTickerSource`, `TheaterHallCountSource`, `DiscoveryResponseMapper` |
| `discovery.constants.ts` | `HOME_LIST_LIMIT = 12`, `DISCOVERY_CACHE_CONTROL`, `SPECIAL_DATES_AHEAD_DAYS = 7`, `MAX_PEOPLE_FILTER = 20`, `MAX_GENRES_FILTER = 10`, `PARKING_FACILITIES` |
| `types.ts` | `HomeView`, `HomeTickerEntry`, `GenreWithCount`, `MovieListFilterInput`, `MovieListView`, `TheaterListFilter`, `TheaterCardView`, `PublicTheaterView` |
| `home-ticker.source.ts` | the seam `HomeTickerSource` and its default `NoShowtimesTickerSource` |
| `theater-hall-count.source.ts` | the seam `TheaterHallCountSource` and its default `NoHallsCountSource` |
| `home.service.ts` | `HomeService.getHome()` |
| `movie-browse.service.ts` | `MovieBrowseService`: genres with counts, the movie list, a movie, similar movies, people |
| `theater-browse.service.ts` | `TheaterBrowseService`: theater cards (home), the theater list, a theater |
| `in-memory-page.ts` | pure: `pageInMemory()` (a cursor page of an already sorted array), `compareByNameThenId()` |
| `discovery-response.mapper.ts` | `DiscoveryResponseMapper` (needs `MediaService` for image URLs): every response DTO of the unit |
| `home.controller.ts` | `GET /home` |
| `catalog-browse.controller.ts` | `GET /genres`, `/movies`, `/movies/{id}`, `/movies/{id}/similar`, `/people` |
| `theater-browse.controller.ts` | `GET /theaters`, `/theaters/{id}` |
| `dto/` | the request queries and response DTOs below |

`src/common/swagger/composed-schemas.ts`: `defineComposedSchema(name, schema)` registers a
component schema written by hand and returns its `$ref`; `buildOpenApiDocument()` adds the
registered schemas to `components.schemas`.

`src/modules/seed/` and `src/cli/seed.ts`: see "Seed".

## Migrations

None. The unit reads tables U4b and U6 own through their services, and every query it causes
already has its index (`idx_theaters_status_name`, `idx_movies_status_release_date`,
`idx_movie_genres_genre_id_movie_id`, `idx_people_full_name`, the trigram indexes). The `0085`
prefix stays reserved for U8.

## Endpoints

All `GET`, `@Public()`, tag `Discovery`, `Cache-Control: public, max-age=60`, errors
`429 RATE_LIMITED`, `500 INTERNAL`, `503 SERVICE_UNAVAILABLE`, plus those listed.

| Route | Operation id | Query / params | Response | Errors |
|---|---|---|---|---|
| `/home` | `getHome` | — | `HomeResponse` | — |
| `/genres` | `listGenres` | `status?`, `cursor?`, `limit?` | `GenreWithCountPage` | `400 VALIDATION_FAILED` |
| `/movies` | `listPublicMovies` | `status?` (default `now_showing`), `genres?` (slugs), `q?` (2–100), `people?` (ids), `cursor?`, `limit?` | `MovieCardPage` | `400 VALIDATION_FAILED` |
| `/movies/{id}` | `getPublicMovie` | `id` | `MovieDetails` | `400`, `404 NOT_FOUND` |
| `/movies/{id}/similar` | `listSimilarMovies` | `id` | `SimilarMovies` | `400`, `404 NOT_FOUND` |
| `/people` | `listPublicPeople` | `q?` (2–100), `roleGroup?`, `cursor?`, `limit?` | `PublicPersonPage` | `400 VALIDATION_FAILED` |
| `/theaters` | `listPublicTheaters` | `openNow?`, `parking?` (`true`/`false`), `cursor?`, `limit?` | `PublicTheaterPage` | `400 VALIDATION_FAILED` |
| `/theaters/{id}` | `getPublicTheater` | `id` | `PublicTheater` | `400`, `404 NOT_FOUND` |

### `GET /home` — `HomeResponse`

Exactly the draft (`contracts/drafts/home-page.openapi.yaml`); schema names as there.

- `serverTime`: the Clock's now, Cairo time with offset. `cinemaDate`: `cinemaDateOf(now)`.
- `featured` (≤ 5, by `position`): `FeaturedMovie { position, movie: FeaturedMovieDetails { id,
  title, synopsis, genres, runtimeMinutes, ageRating, releaseDate, status }, heroVideo: Video,
  backdrop: Image | null }` from `CatalogReadService.listFeatured()`.
- `ticker`: `TickerItem { movie: { id, title }, nextShowtime: { id, startsAt, cinemaDate,
  theater: { id, name } } }[]` from `HomeTickerSource` (empty until U8b).
- `genres`: `GenreWithCount` (`allOf: [GenreRef, { movieCount }]`) for every genre,
  alphabetical; `movieCount` counts Now showing plus Coming soon movies.
- `nowShowing`, `comingSoon`: `MovieCardList { items: MovieCard[] (≤ 12), total }`; Now showing
  newest release first, Coming soon soonest first (ties by id). `MovieCard { id, title, poster,
  genres, runtimeMinutes, ageRating, releaseDate, status }`.
- `cinemas`: `TheaterCard { id, name, district, city, address, cover, openState, mainPhone,
  hallCount, facilities }` for every `active` theater, alphabetical. `openState` from
  `TheaterHoursService.openStates(ids, now)`; `mainPhone` is the phone at position 0, or null
  (none, or contacts hidden); `facilities` all of them in `FACILITIES` order.

Enums: `MovieStatus` (`coming_soon`, `now_showing`), `AgeRating`, `VideoKind`, `Facility`.

### `GET /genres` — `GenreWithCountPage`

`{ items: GenreWithCount[], nextCursor, total }`, alphabetical by name then id; `movieCount` is
public movies of `status` (both tabs when absent). Cursor sort key: the name.

### `GET /movies` — `MovieCardPage`

`{ items: MovieCard[], nextCursor, total, tabCounts: { nowShowing, comingSoon } }`. Filters AND
together; `genres` and `people` match any of their values; `q` matches a title or a credited
person's name, case-insensitively. Order as on the home page; the cursor's sort key is the
release date (U6's `listPublicMovies`). `tabCounts` are both tabs' totals with the same filters.

### `GET /movies/{id}` — `MovieDetails`

`{ id, title, status, synopsis, runtimeMinutes, releaseDate, ageRating, language, country,
productionCompany, budgetLabel, filmingLocations, genres, poster, backdrop, heroVideo (Video or
null), videos: Video[], photos: MoviePhoto[] { id, kind, caption, image }, credits:
MovieCreditResponse[] { id, role, characterName, position, person: { id, fullName, photo } } }`
in display order. The frontend groups credits (Director, Writers, Stars) by `role`.

### `GET /movies/{id}/similar` — `SimilarMovies`

`{ items: MovieCard[] }`: up to 4 Now showing movies sharing the most genres, then newest
release; never the movie itself. `404` when the movie isn't public.

### `GET /people` — `PublicPersonPage`

`{ items: PublicPerson[] { id, fullName, photo, roles: CreditRole[] }, nextCursor, total }`:
people credited on a public movie, by name then id (the Movies page cast filter).

### `GET /theaters` — `PublicTheaterPage`

`{ items: PublicTheaterListItem[], nextCursor, total }`. An item is the `TheaterCard` fields plus
`latitude`, `longitude` (the map), `today` (`TodayHoursResponse`, today's cinema date) and
`weeklyHours` (`DayHoursResponse[]`, Monday first). Alphabetical; the cursor's sort key is the
name.

### `GET /theaters/{id}` — `PublicTheater`

`{ id, name, address, district, city, latitude, longitude, transitInfo, parkingInfo, email,
phones: Phone[], facilities, cover, photos: TheaterGalleryPhoto[] { id, caption, image },
openState, today, weeklyHours, specialDates: SpecialDateResponse[] (next 7 cinema days),
hallCount }`.

## Error codes

No new code. `VALIDATION_FAILED` (bad query or id), `NOT_FOUND` (a movie or theater that is not
public), `RATE_LIMITED`, `INTERNAL`, `SERVICE_UNAVAILABLE`.

## Services

**Exported by `DiscoveryModule`** (for U8b):

```ts
abstract class HomeTickerSource {
  // Now showing movies with a bookable showtime left in `cinemaDate`, each with its next one,
  // soonest first. The default returns []. U8b provides { provide: HomeTickerSource, useClass }.
  abstract tickerFor(now: Date, cinemaDate: CalendarDate): Promise<readonly HomeTickerEntry[]>;
}
// HomeTickerEntry = { movie: { id; title }; nextShowtime: { id; startsAt: Date;
//   cinemaDate: CalendarDate; theater: { id; name } } }

abstract class TheaterHallCountSource {
  // Active halls per theater; every id asked for is in the map. The default answers 0.
  abstract countsOf(theaterIds: readonly number[]): Promise<ReadonlyMap<number, number>>;
}

class DiscoveryResponseMapper {          // for U8b's showtime reads
  movieCard(movie: MovieSummary): MovieCardResponse;
  theaterCard(card: TheaterCardView): TheaterCardResponse;
  // and the other response builders of this unit
}
```

**Consumed from U6**: `CatalogModule`, `CatalogReadService.listGenres()`,
`.countPublicMoviesByGenre()`, `.countPublicMovies()`, `.listPublicMovies()`,
`.findPublicMoviesByIds()`, `.findPublicMovie()`, `.listFeatured()`, `.listSimilar()`,
`.listPublicPeople()`; `GenreRefResponse`, `VideoResponse`, `toVideoResponse()`,
`MovieCreditResponse`, `CreditedPersonResponse`; `PUBLIC_MOVIE_STATUSES`, `AGE_RATINGS`,
`CREDIT_ROLES`, `ROLE_GROUPS`, `MOVIE_PHOTO_KINDS`, `MIN_SEARCH_LENGTH`, `MAX_SEARCH_LENGTH`.

**Consumed from U4b**: `TheatersModule`, `TheaterReadService.listActive()`, `.findActive()`;
`TheaterHoursService.openStates()`, `.hoursFor()`, `.weeklyHours()`, `.specialDates()`;
`TheaterPhoneResponse` (`Phone`), `OpenStateResponse` (`OpenState`), `TodayHoursResponse`,
`DayHoursResponse`, `SpecialDateResponse`, `toOpenStateResponse()`, `toPhoneResponse()`,
`toTodayHoursResponse()`, `toDayHoursResponse()`, `toSpecialDateResponse()`, `FACILITIES`.

**Consumed from U4a / U1**: `MediaService.toImageResponse()`, `ImageResponse`; `Clock`,
`cinemaDateOf()`, `addDays()`, `formatCairoIso()`; `PageQuery`, `toPageRequest()`,
`encodeCursor()`, `decodeCursor()`; `ApiErrorResponses`, `REQUEST_ID_RESPONSE_HEADER`;
`@Public()`; `AppError`.

### Query cost

Every route costs a fixed number of queries whatever the number of rows (no N+1), read one
after the other (the pool holds 5 connections). `/theaters` is 10: the active theaters, their
phones, facilities, photos and images (`TheaterReadService`), then the open-state hours (2),
today's hours (2) and the weekly hours (1); hall counts cost nothing by default. `/home` adds the
carousel, the genres and their counts, and both movie rows with their cards (17 on an empty
catalog). `/movies` and `/movies/{id}` cost U6's fixed counts. The integration suites count the
queries of `/theaters` for 1 and 4 theaters and of `/movies` for pages of 2 and 4 movies.

## Seams for U8b

- `HomeTickerSource`: replace `NoShowtimesTickerSource` with a showtimes-backed source in
  `DiscoveryModule.providers`.
- `TheaterHallCountSource`: replace `NoHallsCountSource` with U5's count of active halls.
- `npm run seed`: append steps to `SEED_STEPS` (`src/modules/seed/seed.steps.ts`): halls go
  before `publish-theaters` (U5 makes an active hall a publish requirement), showtimes last.

## Seed

`npm run seed` (`nest build && node dist/cli/seed.js`) for development databases:

1. Refuses `NODE_ENV=production`, `STORAGE_DRIVER` ≠ `local`, `EMAIL_DRIVER` ≠ `simulated` and a
   `SEED_ADMIN_PASSWORD` the password policy refuses. App logs are lowered to `warn` for the run.
2. Boots the real app on `127.0.0.1` at a free port, migrating first as `main.ts` does.
3. Finds or creates the seed admin `seed-admin@maqady.local` ("Seed Admin") through
   `StaffService.createActiveMember()` with `SEED_ADMIN_PASSWORD` (default `Maqady-seed-2026`),
   and signs in through `POST /admin/auth/sessions`.
4. Runs the steps, each idempotent: it finds what exists by name (theaters, people) or title
   (movies) through the admin list routes, creates only what is missing, replaces the whole-set
   parts (hours, phones, facilities, prices, credits) with the same values, uploads an image only
   where none is set, adds a video only when its YouTube id is missing, and changes a status or a
   carousel position only when it differs.
   - `theaters`: 6 theaters (Zamalek, Downtown, Heliopolis and New Cairo in Cairo; Sheikh Zayed
     and Dokki in Giza) with weekly hours (all closing after midnight, later on Thursday and
     Friday nights for two), prices, phones, facilities, a generated 16:9 cover, gallery photos
     and, for Zamalek, holiday hours 3 days ahead. Sheikh Zayed hides its contacts.
   - `publish-theaters`: publishes them (one kept as a draft, to show it never appears).
   - `people`: 18 people with roles and generated square photos.
   - `movies`: 12 movies across the genres (7 Now showing, 4 Coming soon, 1 draft) with
     details, release dates relative to today, a generated 2:3 poster, stills (the first is the
     backdrop), two YouTube videos (Blender Foundation open movies, so the embeds play; the
     first is the hero) and credits.
   - `featured`: 5 carousel positions with hero videos.
5. Prints one line per step (created and kept counts) and the seed admin's email.

Placeholder images are generated with sharp (a gradient and the title), so no binary is
committed; they go through the real image pipeline into the local storage driver.

## Changes to earlier code

- `src/common/swagger/openapi-document.ts`: adds the composed schemas to the document (one
  line); new `src/common/swagger/composed-schemas.ts`.
- `src/common/swagger/swagger.constants.ts`: the `Discovery` tag.
- `src/app.module.ts`: imports `DiscoveryModule`.
- `package.json`: `seed` script; dev dependencies `ajv`, `ajv-formats`.
- `.env.example`: `SEED_ADMIN_PASSWORD`.
- `README.md` (scripts, environment, "Development seed", the discovery and test-support notes)
  and `docs/system-design.md` (§5 `discovery` row, §11 discovery paragraph, §21 the U8a/U8b
  split, decision D-31).
- Before this unit's own work, the reviewed U4b and U6 branches were merged into this branch
  (conflicts kept both sides; U6's decision renumbered D-30 because U9 already held D-29). No
  code of either was changed, and their tests stay green.

## Follow-ups

- **U8b**: replace `NoShowtimesTickerSource` (ticker) and `NoHallsCountSource` (count of active
  halls); add the theater page's halls, `GET /movies/{id}/showtimes`,
  `GET /theaters/{id}/showtimes`, the Movies page "show date" filter and the movie side panel
  (next show today, cinemas showing it, "from" price); append halls (before `publish-theaters`)
  and showtimes to `SEED_STEPS`.
- **Frontend and owner**: the draft says to delete `contracts/drafts/home-page.openapi.yaml` once
  the generated contract covers it, which it now does (qa.md "Contract comparison"). This unit
  was told not to edit it; deleting it means moving the comparison tests to the committed
  contract.
- `TheaterBrowseService` reads today's hours and the open-state hours in two `hoursFor()` calls
  (4 queries); one call over the open-state range would save 2 queries per theater read if the
  free host ever needs it.

## Tests

Unit (`test/unit/modules/discovery/`, collaborators mocked):

- `in-memory-page.test.ts`: pages of 1, n and n+1 items; the cursor resumes after the last
  item, also when that item has gone; a tampered or wrong-kind cursor is `VALIDATION_FAILED`;
  name order ignores case and ties break by id.
- `home.service.test.ts`: assembles the view from mocked reads; asks the movie lists for 12;
  passes the Clock's now to the open states and the ticker; `cinemaDate` at 00:30 is the
  previous date; genre counts default to 0.
- `movie-browse.service.test.ts`: slugs to ids; an unknown slug is `VALIDATION_FAILED`; tab
  counts; `NOT_FOUND` for a movie that isn't public, for details and similar.
- `theater-browse.service.test.ts`: `openNow` and `parking` filters; hidden contacts; special
  dates asked for today to today + 6; `NOT_FOUND`.
- `home-ticker.source.test.ts`, `theater-hall-count.source.test.ts`: the defaults.
- `dto/discovery.queries.test.ts`: comma-separated slugs and ids (a repeated parameter
  joined), empty lists, `true`/`false`, and every refused value with one message per field.
- `test/unit/modules/seed/seed.command.test.ts`: production, Supabase storage, Resend email and a
  weak `SEED_ADMIN_PASSWORD` are refused, without echoing the password.
- `test/unit/common/swagger/composed-schemas.test.ts`: a composed schema registers once; the
  same name with another shape throws.

Integration (`test/integration/modules/discovery/`, real app and Postgres, local storage):

- `home.controller.test.ts`: a real `/home` response with posters, a backdrop, a cover and hero
  videos validates against `HomeResponse` loaded from the draft (ajv, nullable mapped to
  `null` alternatives); featured order by position and at most 5; 13 movies per tab give 12
  items and `total: 13` in the right order; drafts, archived movies and draft or paused
  theaters never appear; genre `movieCount` counts only public movies; the open state of a
  card follows the Clock across a closing at 01:00 after midnight; `Cache-Control`; a token is
  not needed.
- `catalog-browse.controller.test.ts`: genres paging and the `status` count; movies filters
  (status, genre slugs, unknown slug, `q`, `people`), paging without repeats and `tabCounts`;
  details with videos, photos and credits in order and `404` for draft, archived and unknown;
  similar; people.
- `theater-browse.controller.test.ts`: list order ignoring case, paging, `openNow` at three
  Clock instants around midnight, `parking`; details with hidden and shown contacts, gallery
  captions and alt texts, special dates of the next 7 days only (today + 7 left out); `404` for
  a draft, a paused and an unknown theater; a fixed query count.
- A second suite in `home.controller.test.ts` replaces `HomeTickerSource` with a fixed source
  (`test/support/discovery.ts` `FixedTickerSource`, standing in for U8b's like
  `theaters-probe.module.ts` stands in for U5) to prove the `TickerItem` mapping and schema.
- `dto/discovery-contract.test.ts`: the generated `/home` operation and every schema it reaches
  equal the draft's (prose removed, a lone `allOf` read as its `$ref`); every discovery operation
  has the tag, a summary, a description and `security: []`.
- `test/integration/modules/seed/seed.command.test.ts`: the seed on an empty database creates
  the theaters, movies, people and images; a second run creates nothing new (row counts
  equal); `/home` then shows 5 featured, the theaters and both tabs.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass: a real `/home` validates against the draft's `HomeResponse`; featured
  order and the limits of 5 and 12 with correct totals; drafts, archived movies and non-active
  theaters never appear; open state follows the Clock across a closing after midnight; genre
  counts count only public movies; movie details and similar; theaters list and details; the
  seed runs twice without duplicating.
- `docs/gh-9-home-and-browse/qa.md`: curl of every route on the seeded database, and the
  comparison of the generated `/home` with the draft.
