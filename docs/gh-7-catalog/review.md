---
title: U6 — Review of the catalog unit
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, catalog, movies, people, credits, youtube, photos, featured, publishing]
---

# U6 — Review of the catalog unit

Issue #7, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`9c73568..c5e1922` on `unit/gh-7-catalog`, against design §6.2 (catalog tables), §9 (catalog,
YouTube, image pipeline), §11 (admin movie and people routes), PRD v2 A2 and A3, the spec, and
the `CLAUDE.md` stack rules, anti-patterns and testing policy.

The review was cut off once by a usage limit and then resumed. The first pass committed R1 and R2;
the second checked those two commits, kept them, merged `main-jf8hqi` (U2b, U3's second round,
U2a's second round) into the branch in `3e82f6a`, and went on from there. In the merge, the
conflicts in `README.md`, `docs/INDEX.md`, `AppModule`, the Swagger tags and design §14.3 kept
both sides, and `contracts/openapi.yaml` was regenerated with `npm run contract`.

Each finding was reproduced before it was fixed, and every fix has a test that failed before it.
The integration suites ran on this tree's own database (`maqady_u6_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **`null` passed validation on fields that can't be cleared.** `@IsOptional()` lets `null` through, so `PATCH /admin/movies/{id}` with `ageRating: null` and `PATCH …/videos/{videoId}` with `kind: null` hit a NOT NULL violation and answered `500`; `position: null` on a photo or video silently moved it to the top; `roles: null` on a person cleared the roles; `status: null` and `genreIds: null` were accepted as no-ops. | New integration tests sending each `null`, which answered `500` or `200` before the fix. | Fixed in `83c5ca8`. These fields use `OptionalNotNull()`: absent skips validation, `null` is refused with `VALIDATION_FAILED` on the field. |
| R2 | major | **A person-side write missed a movie credited while it waited for its locks.** `DELETE /admin/people/{id}` and `PUT /admin/people/{id}/credits` read the person's movies, locked them, then locked the person. A movie-side credits replace that credited the person on another movie and committed in between was not locked: the delete cascaded (or the replace removed) that credit without renumbering the movie's list or touching its "Last edited by", leaving a gap in its positions. | Two integration tests that hold a row lock so the movie-side replace commits between the read and the person lock; the credited movie's positions had a gap and its `updated_at` was stale. | Fixed in `69a55ad`. Both re-read the person's credits after the person lock, then lock, renumber and touch any movie credited meanwhile. The spec's lock-order row says so. |
| R3 | minor | **`PUT /admin/people/{id}/credits` moved the "Last edited by" of movies it didn't change.** It renumbered and touched every movie in the person's old and new filmography, so re-sending an unchanged credit on movie A, while adding one on movie B, made A show the person's editor as its last editor (PRD A2 "real Last edited by"). It also rewrote every kept credit's character name. | A probe on the real app: admin 1 credits a person on A; admin 2 sends A unchanged plus a credit on B; A's `updatedBy` became admin 2. Then a new integration test (`leaves the "Last edited by" of movies whose credits it doesn't change`), which failed with A's `updatedAt` and `updatedBy` changed. | Fixed in `bd67afc`. Only movies where a credit is removed, added or gets a new character name are renumbered and touched, and only differing character names are written. Spec row updated. |
| R4 | minor | **A birth date was judged against the cinema day, not the calendar date.** `PeopleService` refused a `birthDate` after `cinemaDateOf(now)`, the business day that turns over at 06:00 Cairo time. Between midnight and 06:00 that is still yesterday, so today's date was refused as "in the future". | A probe with the clock at `2026-10-16T22:30Z` (01:30 on 17 October in Cairo, summer time UTC+3): `birthDate: '2026-10-17'` answered `400`. Then a new integration test, which failed the same way. | Fixed in `4161de2`. The check compares with the Cairo wall-clock date (`formatCairoIso(now).slice(0, 10)`). Spec note updated. |
| R5 | minor | **Bulk archive writes one audit insert per movie.** `PATCH /admin/movies` calls `AuditService.record()` once per archived movie (and once more per freed carousel position), so archiving 100 movies sends up to 105 single-row `INSERT`s. Reads are batched; only these writes loop. | A probe counting `insert into "audit_events"` statements through Knex's `query` event: 1 for one movie, 10 for ten. | **Open.** `AuditService` (U1) has no batch method, and adding one changes shared code outside this unit. The loop is bounded by `MAX_BULK_ARCHIVE = 100` and runs in one transaction. Follow-up: a `recordMany()` on `AuditService`, then one call here. |

No blocker was found. Both major findings (R1, R2) are fixed.

## Checked, with nothing to report

- **Access.** All 23 routes carry `@Admin()`; none is `@Public()`. The access test walks
  `listHttpRoutes()` and asserts the 23, `403` for a box-office token and `401` without one.
- **Lock order and races.** Movie writes lock `FOR NO KEY UPDATE` (conflicts with U7's
  `FOR SHARE`, so a status change waits for scheduling; the test proves it), deletes `FOR UPDATE`.
  Traced: movie delete against a photo upload's `link` (the upload answers `NOT_FOUND`), movie
  delete against a person-side replace naming it (`VALIDATION_FAILED`), person delete against a
  movie-side replace (the `FOR KEY SHARE` lock makes the delete wait, or the replace finds the
  person gone), two featured positions at once (`uq_movies_featured_position` backstop, tested),
  two poster uploads (the second deletes the first under the lock), the 30th photo and 20th video
  under the movie lock. A person-side replace that misses a movie-side credit still uncommitted
  is equivalent to the two running in the other order.
- **Publishing and carousel rules.** Judged on the merged state: transitions, the four publish
  requirements (genres included, which no CHECK can hold), hero and backdrop ownership, the
  16:9 backdrop rule from U4a's `KIND_RULES`, freeing the position on draft or archive, refusing
  to drop the hero of a featured movie. The CHECKs and composite FKs back them.
- **YouTube parsing.** Host allow-list on `URL.hostname`, no user info or port, exact 11-character
  id; a host such as `constructor` reaches an inherited property of the lookup object but every
  rule flag is then `undefined`, so it is refused.
- **SQL.** No `SELECT *`; every list is cursor-paginated; the assembler reads every related table
  once with `whereIn`, and the query-count tests hold for 1 and 10 movies. Repositories alone
  inject Knex. Migrations are raw SQL, every FK named and covered, every index commented.
- **Errors and types.** Services throw only `AppError`; no inline interfaces outside `types.ts`; no
  logging in the module, and audit rows carry field names, never values.
- **Swagger and contract.** Every route has its error codes with examples, nullable and enum
  markings match the responses; `GenreRef` and `Video` match the home-page draft (tested).
- **Exported surface.** `CatalogReadService` and `MovieLifecycleRegistry` are exported as the spec
  states, with `toVideoResponse()`, `toGenreRefResponse()` and the enums for U8.

## Gates

Run fresh on the final commit: `npm run typecheck`, `npm run lint`, `npm test` (unit and
integration suites with their pass counts), `npm run build`, `npm run contract` with no diff, and
a clean `git status`.
