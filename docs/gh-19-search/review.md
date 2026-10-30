---
title: U18 — Review of the Search unit
owner: Mohamed Tarek
status: Passed — 2026-10-30, no open blocker or major findings
last_verified: 2026-10-29
tags: [review, search, pg_trgm, discovery, admin, bookings, customers, rate-limit, roles]
---

# U18 — Review of the Search unit

Issue #19, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`25f8886..7321682` on `unit/gh-19-search`. Reviewed against design §5, §11 (the search routes),
§13.2 and §21 (anonymisation), PRD v2 "Search", "Search results" (customer and admin) and the
role table, the spec, and the `CLAUDE.md` stack rules, anti-patterns and testing policy.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **A local mobile did not rank its own number first.** For a staff search of `01012345678`, the account or booking holding `+201012345678` got the substring tier (2), the same tier as any international number that contains those digits (`+3901012345678`). Ties are broken newest first, so a newer unrelated row came before the number the query stands for. This breaks the spec's ranking rule that the whole value comes first. | A red integration test in `admin-search.controller.test.ts` ("ranks the number a local mobile stands for as the whole value…"). It registers a newer customer with `+3901012345678` and makes a newer counter sale to `+3901198765432`. Before the fix it failed: customers came back as `[13, 1]` instead of `[1, 13]`. | Fixed in `d9df385`. `SearchTerms` now carries `phone`, the E.164 form of a local mobile. On a phone column, `tierSql()` gives tier 0 when the value equals it. Unit assertions were added in `search-terms.test.ts`. The spec's ranking decision and design §13.2 now say so. |
| R2 | minor | **Part of a local mobile finds nothing.** Phones are stored in E.164. The local-to-E.164 rewrite only applies when the whole query is an 11-digit local mobile. So `0101234` (the start of `01012345678`) does not match `+201012345678`. Digits typed without the leading `0` (`1012345`) do match. | Read: `searchTermsOf()` sets `phone` and `phoneContains` only when `LOCAL_MOBILE_PATTERN` matches the whole query. The unit test already asserts `searchTermsOf('0101234567').phoneContains` is null. The stored `+201012345678` does not contain `0101234`. | **Open, accepted.** This is the same rule U14 (`GET /admin/bookings?q=`, `adminSearchOf()`) and U15 (`GET /admin/customers?q=`) use. The spec has the search's "See all" open those lists with the same `q`, so changing only the search would make the two disagree. If it is wanted, a follow-up should change all three together. Not a correctness bug: the full local number, the full E.164 number and any run of digits after `+20` all match. |

No blocker or major finding was found. R1 is fixed red-before-green. R2 stays open as a documented
follow-up shared with U14 and U15. Every gate was re-run on the final commit.

## Checked, with nothing to report

- **Access.** `GET /search` is `@Public()` with `@RateLimit('search')` (60 a minute per IP;
  `search.rate-limit.test.ts` proves the 61st answers `429 RATE_LIMITED` with `Retry-After`).
  `GET /admin/search` is `@Staff()`. A customer token and no token both get `401`. Box office
  gets `null` for the catalog groups, which are never queried (unit test). This matches design
  §11: every movies, people and theaters route is `@Admin()`. `grep` over the `@Staff()` routes
  shows box office reaches only bookings, customers, the box office and scans.
- **Public visibility.** Public results use `PUBLIC_MOVIE_STATUSES`, the same list discovery
  uses. This covers the title branch, the cast branch, the people listing and the roles of a
  person. Theaters must be `active`, as `TheaterReadService` requires. The integration tests
  cover drafts, archived movies, people credited only on drafts, and draft or sales-paused
  theaters (also by district). They would fail if any one of these filters were removed.
- **Anonymisation (§21).** Live customers only (`deleted_at IS NULL`). Booking contacts are
  cleared by `CustomerBookingsService.clearContactsOf()`, so old details find nothing. A
  booking is still found by its reference, with an empty contact. Tested for both roles.
- **SQL safety.** Every value goes through a named binding. Column fragments and the status
  list are code constants. Knex's named-binding parser leaves `::text` casts alone. Probe
  queries (`mission: impossible`, `:q`, `:limit`, `a\b`, `50%`, `off_`, `o'brien`, Arabic
  titles, 100 characters, `ab ::text cd`) all answered `200` with the expected hits on both
  routes. The probe was a throwaway test and was removed. `%`, `_` and `\` are escaped, and
  `standard_conforming_strings` is on.
- **No N+1, no `SELECT *`, no inline types, no plain `Error` or `HttpException`.** One ranked
  query per group plus one `MediaService.findByIds` per group with images. The public query
  count is pinned by a test (3 or 4). Booking rows come from `itemsByIds()`, which makes one
  `findByIds` call and one `BookingViews.ofMany` call.
- **Settlement and statuses.** `settleAllDue()` runs before the booking hits (unit-tested
  order), outside any transaction, exactly as `AdminBookingsService.list()` does.
- **Caching and logs.** The public route uses `DiscoveryCacheInterceptor` (`public,
  max-age=60`; errors get `no-store`, tested). The staff route is `private, no-store`. The request
  logger logs the route template, never the query string, so `q` (possibly an email or phone)
  stays out of the logs. Search writes no audit rows.
- **Migration `0190_01`.** Indexes and comments only. Every index is commented with its query
  path. It is listed in `migration-list.ts`. `down` restores the exact comments that 0070, 0150
  and 0160 set (compared line by line). The planner test shows the trigram indexes serve
  both `ILIKE` and `<%`.
- **Swagger and contract.** Both routes document their errors (`400`, `429`, `500`, `503`; plus
  `401` and `403` for staff). The catalog groups are `nullable: true` and required. `npm run
  contract` leaves `contracts/openapi.yaml` unchanged.
- **Time.** `joinedAt` and booking times are formatted in Cairo time with the offset, through the
  shared helpers. The search does no date math.
