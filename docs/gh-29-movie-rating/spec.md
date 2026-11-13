---
title: "#29 P2 — Movie rating score"
owner: Mohamed Tarek
status: Built
last_verified: 2026-11-13
tags: [catalog, discovery, movies, rating, seed, contract, frontend-gaps]
---

# #29 P2 — Movie rating score

Issue: #29 (API Data Gaps Report, 2026-11-08), package P2. Docs folder:
`docs/gh-29-movie-rating/`. Migration range `0290_11` to `0290_19` (one used). Builds on U6
(catalog: `movies`, `MoviesService`, `CatalogAssembler`, the admin movie DTOs, the audit of
changed field names), U8a (discovery: `MovieCard`, `MovieDetails`, similar movies, the home-page
draft) and the development seed. Design: `docs/system-design.md` §5, §6.2, §9, §11, §14;
PRD v2 C2, C3, A2.

## Goal

The movie details hero shows a rating score, for example "8.4" with a star, and under it, small,
where the score comes from ("elCinema users"). An admin types both into the movie editor; the
customer pages read them. Report item 14.

The PRD had removed "Movie scores" (the v1 "Maqady rating" with votes and sorting). The
frontend report asks for a score again; the owner asked for the report to be fixed. This package
brings back a **curated, admin-entered score from an outside source**, not Maqady's own ratings:
no votes, no reviews, no sorting or filtering by score. PRD v2 is amended in the same change
(intro table, out-of-scope list, C2, C3, A2).

## Scope

- Migration `0290_11_add_movies_rating`: `movies.rating NUMERIC(3,1) NULL` (0 to 10) and
  `movies.rating_source VARCHAR(80) NULL` (trimmed, not empty), with a CHECK that a source needs
  a rating.
- Admin (`AdminMoviesController`, `MoviesService`):
  - `POST /admin/movies` and `PATCH /admin/movies/{id}` accept `rating` and `ratingSource`.
  - `GET /admin/movies/{id}` (and every route answering `AdminMovie`) returns both.
  - The `movie.updated` audit event names `rating` and `ratingSource` in `changedFields` when
    they change (names only, never values).
- Public (`CatalogAssembler`, `DiscoveryResponseMapper`):
  - `GET /movies/{id}` returns `rating` and `ratingSource`.
  - The shared `MovieCard` returns `rating`: `GET /movies`, `GET /movies/{id}/similar`,
    `GET /theaters/{id}/showtimes` (its movies) and `GET /home` (`nowShowing`, `comingSoon`).
- Contract: `contracts/openapi.yaml` regenerated; `contracts/drafts/home-page.openapi.yaml`
  gains the optional `MovieCard.rating`, additively, with a changelog note naming #29.
- Seed: `SeedMovie` gains optional `rating` and `ratingSource`. The `movies` step sends them on
  create and back-fills them on an existing movie whose `rating` is null. `SeedAdminMovie`
  reads `rating`. Dataset values are P5's.

## Out of scope

- Maqady's own ratings: votes, reviews, an average, a "rate this movie" action (PRD: out of
  scope for v1, unchanged).
- Sorting or filtering the movie lists by score (no index is added for it).
- The score on the home carousel (`FeaturedMovieDetails`) and on the ticker: the report asks for
  it on the details hero, and PRD C1 keeps "No score" on the slides.
- The score in the admin movie list (`AdminMovieListItem`), the admin people filmography and the
  search results (`SearchMovie` is its own schema, not `MovieCard`). Follow-up if the frontend
  asks.
- Dataset values (the real 2026 films' scores): P5.
- Other report items (facets, theaters, gallery, WhatsApp, screen size, showtimes): other
  packages.

## Decisions

| Decision | Why |
|---|---|
| `rating NUMERIC(3,1)`, `CHECK (rating BETWEEN 0 AND 10)`; read as a JS number by the shared NUMERIC parser | A score is a decimal with one place (8.4), not money, so NUMERIC is allowed (CLAUDE.md forbids DECIMAL only for money; `pg-type-parsers.ts` already parses NUMERIC as a float for averages and coordinates). NUMERIC keeps 8.4 exact in the database, where a REAL would store 8.3999996 |
| `rating_source VARCHAR(80)`, trimmed and non-empty (`chk_movies_rating_source`), and `chk_movies_rating_source_needs_rating CHECK (rating_source IS NULL OR rating IS NOT NULL)` | A source names where a score comes from; without a score there is nothing to attribute. A score without a source is allowed: the UI then shows the score alone |
| API: `rating` is a JSON number 0 to 10 with at most one decimal place (`IsNumber({ maxDecimalPlaces: 1 })`, `Min(0)`, `Max(10)`), or null to clear. `8.45`, `11`, `-1`, `"8.4"` (text) and `NaN` are `VALIDATION_FAILED` on `rating` | The column keeps one place; refusing 8.45 rather than rounding it means the admin sees exactly what customers see |
| API: `ratingSource` is text up to 80 characters, trimmed; empty text is null; null clears | The convention of every optional text of the movie editor (`TrimToNull`) |
| "A source needs a rating" is judged on the movie **as it would be after the write**: on create, `ratingSource` without `rating`; on edit, the sent value or else the stored one for each field. A source left without a rating is `VALIDATION_FAILED` on `ratingSource` ("ratingSource needs a rating"), before anything is written. So `{ "rating": null }` on a movie that has a source is refused; `{ "rating": null, "ratingSource": null }` clears both | One explicit rule, the same as the CHECK, with a field-level error the editor can show. Clearing the score never silently drops the source the admin typed |
| Audit: `rating` and `ratingSource` join the movie's field-to-column map (`movie-changes.ts`), so a change appears in `movie.updated.changedFields` by its API name, and a change to the same value writes nothing | The existing audit rule (design §13.5: field names, never values) |
| `MovieCard.rating` added to the shared card, **optional** in the schema (`required: false`), nullable, always sent by this API | `GET /movies` and `/movies/{id}/similar` answer `MovieCard`, the schema `GET /home` shares. Splitting the card in two schemas would be a worse contract than one card with one more field. The home-page draft takes it additively (optional property, changelog note), as the #29 rules allow; the frontend shows the star where its design has one |
| `MovieDetails.rating` and `MovieDetails.ratingSource` required and nullable | `MovieDetails` is not in the home-page draft; every field of it is always sent |
| `MovieSummary` (the catalog's card read model) gains `rating`; `MovieDetails` (read model) gains `ratingSource`; `AdminMovie` gains both | One read model per screen, as U6 built them |
| Seed: `rating` / `ratingSource` sent on create when the dataset has them; on a movie that already exists with `rating: null`, one `PATCH` sets both (with whatever else `completeMovie` changes). A movie that already has a rating is left alone, as the seed leaves every other value an admin may have edited | The seed only adds what is missing (design: idempotent steps). The staging movies seeded before this package get their scores on the next run once P5 fills the dataset |

## Modules and files

- `src/migrations/0290_11_add_movies_rating.ts` (and its row in
  `src/common/database/migration-list.ts`).
- `src/modules/catalog/`: `types.ts` (`MovieRow`, `MovieFieldChanges`, `MovieSummary`,
  `MovieDetails`, `AdminMovie`), `catalog.constants.ts` (`MAX_MOVIE_RATING`,
  `TEXT_LIMITS.ratingSource`), `movie-rules.ts` (`ratingSourceWithoutRating()`),
  `movie-changes.ts`, `movies.repository.ts` (the two columns), `movies.service.ts`,
  `catalog-assembler.service.ts`, `catalog-response.mapper.ts`, `admin-movies.controller.ts`,
  `dto/movie-fields.ts`, `dto/update-movie.request.ts`, `dto/admin-movie.response.ts`.
- `src/modules/discovery/`: `dto/movie-card.response.ts`, `dto/movie-details.response.ts`,
  `discovery-response.mapper.ts`.
- `src/modules/seed/`: `types.ts`, `seed.steps.ts`.
- `contracts/openapi.yaml`, `contracts/drafts/home-page.openapi.yaml`.

## Migrations

`0290_11_add_movies_rating` (expand only; the previous release names its columns and never
writes these, so it runs beside it):

```sql
ALTER TABLE movies
  ADD COLUMN rating NUMERIC(3,1) NULL,
  ADD COLUMN rating_source VARCHAR(80) NULL,
  ADD CONSTRAINT chk_movies_rating CHECK (rating BETWEEN 0 AND 10),
  ADD CONSTRAINT chk_movies_rating_source
    CHECK (btrim(rating_source) = rating_source AND length(rating_source) >= 1),
  ADD CONSTRAINT chk_movies_rating_source_needs_rating
    CHECK (rating_source IS NULL OR rating IS NOT NULL);
```

Column comments say what each holds. No index: nothing filters or sorts by score. `down` drops
both columns (their constraints go with them).

## Endpoints

### `POST /admin/movies`, `PATCH /admin/movies/{id}` (admin)

Request, new optional fields:

| Field | Type | Rules |
|---|---|---|
| `rating` | number \| null | 0 to 10, at most one decimal place; null clears |
| `ratingSource` | string \| null | up to 80 characters, trimmed, empty is null; needs a rating on the movie after the write |

Errors: `VALIDATION_FAILED` on `rating` (range, decimals, type) or on `ratingSource` (length,
type, "needs a rating"). Response: `AdminMovie` (below). A `PATCH` that changes either records
`movie.updated` with `changedFields` naming it.

### `GET /admin/movies/{id}` and every route answering `AdminMovie` (admin)

`AdminMovie` gains `rating` (number \| null, example 8.4) and `ratingSource` (string \| null,
example "elCinema users").

### `GET /movies/{id}` (public)

`MovieDetails` gains `rating` (number \| null: the score out of 10 shown with a star on the
hero; null hides it) and `ratingSource` (string \| null: shown small under the score; null shows
the score alone).

### `GET /movies`, `GET /movies/{id}/similar`, `GET /theaters/{id}/showtimes`, `GET /home` (public)

`MovieCard` gains optional `rating` (number \| null), always sent: the same score as the
details page, for cards whose design shows a star.

## Tests

Unit (`test/unit/`, collaborators mocked):

- `modules/catalog/dto/catalog-requests.test.ts`: `rating` 0, 10, 8.4 and null accepted; 10.1,
  -0.5, 8.45, `"8.4"`, `NaN` refused on `rating`; `ratingSource` trimmed, empty to null, 81
  characters refused; both accepted on create and on update.
- `modules/catalog/movie-rules.test.ts`: `ratingSourceWithoutRating()` for every combination.
- `modules/catalog/movie-changes.test.ts`: `diffMovie` maps `rating` and `ratingSource` to their
  columns and leaves an unchanged score out.
- `modules/catalog/movies.service.test.ts`: create stores both; create refuses a source without a
  rating before inserting; update records `changedFields: ['rating', 'ratingSource']`; clearing
  the rating of a movie with a source is refused, clearing both is written; a source added to a
  movie that already has a rating is accepted.
- `modules/seed/seed.steps.test.ts`: the `movies` step sends the score on create; back-fills it
  with one `PATCH` on an existing movie whose rating is null; leaves a rated movie alone; sends
  nothing for a dataset movie without a score; every dataset's scores fit the admin API (so P5's
  values are checked as they land).

Integration (`test/integration/`, real Postgres, real wiring):

- `modules/catalog/admin-movies.controller.test.ts` ("rating score" block): create with a score
  and source answers them and `GET` returns them; `PATCH` changes them and the `audit_events` row
  names the fields; `{ rating: null }` with a source stays refused (`VALIDATION_FAILED` on
  `ratingSource`) and nothing changes; both null clears; out-of-range and two-decimal scores
  are refused; the CHECK constraints refuse a direct write of a source without a score and of a
  score of 10.5.
- `modules/discovery/catalog-browse.controller.test.ts` ("rating score" block): `GET /movies/{id}`
  returns `rating` and `ratingSource`; the cards of `GET /movies` and
  `GET /movies/{id}/similar` return `rating` (a number for the rated movie, null for the other).
- `modules/seed/seed.steps.test.ts`: the real `movies` step through `SeedApiClient` over HTTP
  against the real app creates movies with and without a score; after the scores are emptied in
  the database (as on staging), a second run back-fills them, keeps a score an admin set, and the
  audit row names `rating` and `ratingSource`.
- `modules/discovery/dto/discovery-contract.test.ts` (unchanged): every `/home` schema, with the
  new optional `MovieCard.rating`, equals the draft.
- `modules/seed/seed.command.test.ts` (unchanged): both datasets still seed and re-seed.

## Acceptance

- Gates: typecheck, lint, the whole suite, build, and the contract regenerated with a clean
  `git status`.
- Tests prove: the rating validation (range, one decimal, null clears); a rating without a
  source is fine and a source without a rating is refused; the public details and cards return
  the value; the admin audit row names the field; the seed sets and back-fills a rating.
- `docs/gh-29-movie-rating/qa.md` records curl evidence of every changed route.
