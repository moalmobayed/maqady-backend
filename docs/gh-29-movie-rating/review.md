---
title: "#29 P2 — Review of the movie rating score"
owner: Mohamed Tarek
status: Passed — 2026-11-13, no open blocker or major findings
last_verified: 2026-11-13
tags: [review, catalog, discovery, movies, rating, seed, contract, frontend-gaps]
---

# #29 P2 — Review of the movie rating score

Issue #29 (API Data Gaps Report, item 14), spec [`spec.md`](spec.md), QA [`qa.md`](qa.md).
Reviewed range: `245fb2d..9703c31` on `unit/gh-29-movie-rating`, against the report item, the
spec, `docs/system-design.md` (data model, D-33) and the `CLAUDE.md` stack rules, anti-patterns
and testing policy.

Each finding was reproduced before it was fixed. Each fix has a test that failed before it,
except F3, which adds coverage and changes no behavior.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| F1 | minor | **A score written with an exponent answered `500 INTERNAL`.** `rating` was validated with class-validator's `IsNumber({ maxDecimalPlaces: 1 })`. That reads the decimals from `toString()`, and for a number below 1e-6, such as JSON `1e-7`, `toString()` gives `"1e-7"`. The `split('.')[1].length` then throws a `TypeError` inside the `ValidationPipe` instead of refusing the value, so `PATCH /admin/movies/{id} {"rating":1e-7}` answered `500` rather than `VALIDATION_FAILED` on `rating`. The theaters module had already met this on coordinates and has `HasAtMostDecimals` for it. | A unit case (`1e-7`, `5e-10`) in `catalog-requests.test.ts` that failed with `TypeError: Cannot read properties of undefined (reading 'length')`, and an integration case in `admin-movies.controller.test.ts` that got `{ status: 500, code: 'INTERNAL' }`. | Fixed in `b24408a`. `rating` uses `HasAtMostDecimals(1)` (which takes an optional `ValidationOptions`, so it keeps the message "rating must be a number with at most one decimal place"), with `Min(0)` and `Max(10)`. |
| F2 | minor | **A source the validator accepted could overflow `VARCHAR(80)` and answer `500`.** `ratingSource` used `MaxLength(80)`, which counts characters the way `validator`'s `isLength` does: it leaves out U+FE0E and U+FE0F (presentation selectors). `"a️"` repeated 80 times counts 80 there and 160 in Postgres, so the insert failed with `22001` and the API answered `500`. The theaters module counts with `HasLength` for this reason. | An integration case (80 × `a️`, with a rating) that got `{ status: 500, code: 'INTERNAL' }`. | Fixed in `b24408a`. `ratingSource` uses `HasLength(1, 80)`, which counts code points as `VARCHAR(n)` does. The message is unchanged ("must be shorter than or equal to 80 characters"). The spec's Decisions name both validators. |
| F3 | minor | **No test asserted the score on the `GET /home` cards.** The spec and the builder's summary say `MovieCard.rating` reaches `/home`, and the home-page draft gained it as an optional field, but the integration tests only checked `/movies`, `/movies/{id}/similar` and `/movies/{id}`. The draft validator on `/home` only ever saw `rating: null`, so a non-null score was never checked against the draft schema. The behavior was right (QA has curl evidence), but a regression would not have failed a test. | Reading the test diff: `home.controller.test.ts` had no `rating` assertion. | Fixed in `b24408a` (coverage only). A new `/home` integration test rates one Now showing movie, checks the response still validates against the draft `HomeResponse`, that every card carries `rating`, and that only the rated card has a non-null one (8.4). |
| F4 | minor (pre-existing, out of scope) | **The other movie texts have F2's flaw.** `title`, `synopsis`, `language`, `country`, `productionCompany`, `budgetLabel` and `filmingLocations` are `VARCHAR(n)` columns validated with `MaxLength(n)`, so a text full of U+FE0F can still answer `500`. This package did not add these fields. | Reading `dto/movie-fields.ts` against the column lengths in `maqady_p2_dev` (`information_schema.columns`). The mechanism is the one F2 reproduced. | **Open.** Outside #29 P2 (ground rule 5: flag, do not fix). The fix is the same as F2 (`HasLength`) across the catalog DTOs, as its own change. |

## Checked, with nothing to report

- **Report item 14.** `GET /movies/{id}` returns `rating` (number or null) and `ratingSource`;
  the shared `MovieCard` returns `rating` on `/movies`, `/similar`, theater showtimes and
  `/home`. Every card goes through `DiscoveryResponseMapper.movieCard`, and every movie read
  goes through `MOVIE_COLUMNS` in `movies.repository.ts`, so no path drops the field.
- **Migration.** `0290_11_add_movies_rating` adds two nullable columns without a default, so
  existing rows pass every new CHECK (`NULL` passes `BETWEEN`, the trimmed check and the
  "needs a rating" check). It is in `migration-list.ts`. `NUMERIC(3,1)` is read as a number by
  the shared parser (`pg-type-parsers.ts`), so `diffMovie` compares numbers and an unchanged
  score writes no audit row. `NUMERIC` is not money, so the "no DECIMAL" rule does not apply.
- **Rules.** A source without a rating is refused on create and on edit, judged on the movie
  after the write, before anything is written, and backed by a CHECK. JavaScript's `trim()`
  removes everything `btrim()` does, so a trimmed source always passes `chk_movies_rating_source`.
- **Audit.** `movie.updated` names `rating` and `ratingSource`, never their values.
- **Queries.** No new query and no N+1: the two columns join the existing column list.
- **Contract.** `contracts/openapi.yaml` is regenerated and clean. In the home-page draft,
  `MovieCard.rating` is optional and nullable, with a changelog note, so the change is
  additive. Nothing else on `/home` changed. The draft contract test still passes, now also
  with a non-null score (F3).
- **Contacts, counts, pagination.** Not touched by this package.
- **Seed.** `rating` and `ratingSource` are optional on `SeedMovie`. The seed sends them on
  create and back-fills an unrated movie with one `PATCH`. No dataset has values yet (that is
  P5's work), so both datasets seed exactly as before. No photos were added, so there are no
  licence questions.
