---
title: U8a — Review of the home and browsing reads
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, discovery, home, movies, theaters, caching, seed, public]
---

# U8a — Review of the home and browsing reads

Issue #9, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`1bd08df..81aca11` on `unit/gh-9-home-and-browse`. The unit's own work is `6a4786c..81aca11`;
the commits before it are the merges of the reviewed U4b and U6 tips. The review checked the unit
against design §8 (cinema day), §9, §11 (public routes) and §13.2, the home-page draft
`contracts/drafts/home-page.openapi.yaml`, PRD v2 C1–C5, the spec, and the `CLAUDE.md` stack
rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed, and every fix has a test that failed before it.
The integration suites ran on this tree's own database (`maqady_u8a_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **Discovery errors went out with `Cache-Control: public, max-age=60`.** Nest's `@Header()` sets its header before the handler runs, and the global exception filter does not reset it. So a `404` (a movie not yet published, a paused theater), a `400` and a `503` (database down) on any of the eight public routes told every shared cache (CDN, proxy) to keep the error for a minute. The first reader after an outage, or after a movie was published, would keep getting the cached error. | New integration tests in `catalog-browse.controller.test.ts` and `theater-browse.controller.test.ts` request `/movies/{draft}`, `/movies/{archived}/similar`, `/movies/abc`, `/movies?status=archived`, `/genres?status=draft`, `/people?roleGroup=extras`, `/theaters/{draft}`, `/theaters/0` and `/theaters?openNow=yes`. Before the fix they received `public, max-age=60`. | Fixed in `d553154`. `DiscoveryCacheInterceptor` runs on the three discovery controllers and replaces the `@Header()` decorators. It sets `public, max-age=60` when the handler succeeds and `no-store` when it throws. Validation runs inside the handler, so its errors are covered too. A unit test, `discovery-cache.interceptor.test.ts`, covers `NOT_FOUND`, `VALIDATION_FAILED`, `SERVICE_UNAVAILABLE` and an unexpected error. The spec and design §11 now say so. |
| R2 | minor | **The seed could leave an admin with a known password on a hosted database.** `npm run seed` creates the active admin `seed-admin@maqady.local` with the README's default password. It refused only `NODE_ENV=production`, real storage and real email. A developer `.env` with `DATABASE_URL` pointing at a hosted database, `NODE_ENV` unset and local storage would pass every check. | A new case in `test/unit/modules/seed/seed.command.test.ts` uses a `db.….supabase.co` URL. Before the fix `seedRefusals()` returned `[]`. | Fixed in `4718e32`. The seed now refuses a `DATABASE_URL` whose host is not loopback (`localhost`, `127.0.0.1`, `::1`), a Unix socket (no host) or a single-label Docker Compose host such as `postgres`. A non-loopback IPv6 address and an unparsable URL are refused too. The refusal never echoes the URL, which holds the database password. README "Development seed" and the spec say so. |

## Checked and found sound

- **Access.** All three controllers are `@Public()` at the class level and stay under the global
  JWT, rate-limit and access guards. An invalid bearer token on `/home` is ignored, as the
  integration test shows. Every route has the default rate limit. A public person shows only the
  id, name, photo and roles, with no birth date, place or bio. Theater phones and email follow
  `showContactsPublic`.
- **Visibility.** A movie is public only when it is `coming_soon` or `now_showing`: in the
  carousel (`listFeatured` filters on status), the lists, the counts, the details page,
  similar movies (Now showing only, the movie itself excluded) and the people list. A theater is
  public only when it is `active`. Anything else is `NOT_FOUND` with the same body as an unknown
  id.
- **Time.** `serverTime`, `cinemaDate`, the open states, "today" and the 7-day special-date
  window are all judged at one Clock instant by `cinemaDateOf()`. Only `addDays()` is used on
  calendar dates, so the unit does no offset arithmetic of its own. Summer time is handled in
  `common/time` and U4b's opening hours, which these reads call.
- **Pagination.** `pageInMemory()` resumes from the cursor's `(name, id)` with the same collator
  that sorts, so it never repeats or skips an item. A wrong-kind or tampered cursor is
  `VALIDATION_FAILED` (`toPageRequest(query, 'text')` here, and the catalog's own checks for
  `/movies` and `/people`).
- **Query cost.** Every read costs a fixed number of queries whatever the number of rows, and
  repositories are reached only through the exported read services. There is no `SELECT *` and
  no N+1. The query-count tests for 1 and 4 theaters, and for pages of 2 and 4 movies, hold.
- **Validation.** One message per bad field. Repeated parameters are joined. `genres` slugs are
  checked by pattern before they are echoed in the unknown-slug message.
- **Contract.** The `/home` operation and the 18 schemas it reaches match the draft, as
  `discovery-contract.test.ts` and ajv validation of a real response show. Every discovery
  operation has a tag, a summary, a description, `security: []` and its error responses.
- **Types and errors.** The unit's interfaces live in `discovery/types.ts` and `seed/types.ts`,
  and its services throw only `AppError`. The seed's plain `Error`s are in CLI code, not in a
  service. Every `catch` re-throws or maps.

## Notes, not findings

- `TheaterBrowseService.cardsOf()` reads the weekly hours three times (open states, today and
  the week). The spec already lists folding these into fewer reads as a follow-up.
- The `GenreWithCount.movieCount` description says "Now showing plus Coming soon". On
  `/genres?status=` it counts one tab, and the operation's description says so. The schema text
  is the draft's, so it was left as the draft wrote it.
- On a re-run the seed fills only what is missing. It does not "replace the whole-set parts with
  the same values", as the spec's Seed step 4 words it. The result is the same: nothing is
  duplicated and nothing is changed.

## Gates

Run fresh against the final committed state. The outputs are recorded in the review result:
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then `npm run contract`
followed by `git status`.
