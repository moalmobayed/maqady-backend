---
title: U18 — Search - public search and staff search filtered by role
owner: Mohamed Tarek
status: Built
last_verified: 2026-10-29
tags: [search, pg_trgm, discovery, admin, bookings, customers, rate-limit, roles]
---

# U18 — Search: public search and staff search filtered by role

Issue: #19. Docs folder: `docs/gh-19-search/`. Migration prefix `0190`. Depends on U15 (live and
anonymised customers, `0160` trigram indexes) and, through it, U14 (`AdminBookingsService`,
`AdminBookingResponseMapper`, the `0150` trigram indexes on booking contacts), U11
(`SettlementService.settleAllDue()`), U6 (catalog tables, `idx_movies_title_trgm`,
`idx_people_full_name_trgm`), U4 (theaters, `MediaService`) and U1 (the `search` rate limit, the
access decorators). Design: `docs/system-design.md` §5, §6, §10.3, §10.4, §10.6, §11 (search
routes), §13.2, §14, §21 (anonymisation); PRD v2 "Search", "Search results" (customer and admin),
A6, A7, the role table and "Box office nav".

## Goal

A customer or guest types in the nav search and gets, grouped, the published movies (by title or
cast), the people credited on them and the theaters open for sales (by name or area), best match
first, tolerating a typo. A staff member types in the dashboard's top bar and gets bookings (by
reference, contact name, email or phone) and customers, plus, for admins only, movies, people
and theaters in any status. Nothing reaches a role or a visitor that their screens would not
show them, and an anonymised customer cannot be found by the details they had.

## Scope

- Migration `0190_01_add_search_indexes`: trigram indexes on theater names and districts, and
  fresh comments on the existing search indexes naming the search queries that now use them.
- A new read-only feature module `search` (`src/modules/search/`) with:
  - `GET /search?q=` (`@Public()`, rate limited by the named `search` limit, 60 per minute per IP);
  - `GET /admin/search?q=` (`@Staff()`; the groups depend on the role).
- Additive in `bookings`: `AdminBookingsService.itemsByIds(ids)`, so booking hits are U14's admin
  list rows.
- Swagger tags `Search` and `Admin: search`; contract regenerated.

## Out of scope

- A "See all" page per group: the frontend links to the existing lists with the same `q`
  (`/movies?q=`, `/people?q=`, `/admin/bookings?q=`, `/admin/customers?q=`, the admin catalog
  lists), and each group says whether there are more (`hasMore`).
- Searching staff accounts, showtimes, halls, payments or messages: not in PRD "Search".
- Search analytics or suggestions (autocomplete): not in the PRD.
- Tuning `pg_trgm.word_similarity_threshold`: the default (0.6) is used, see Decisions.

## Decisions

| Decision | Why |
|---|---|
| A module `search` with its own `SearchRepository` that reads `movies`, `movie_credits`, `people`, `person_roles`, `theaters`, `customers` and `bookings` in ranked queries, and hydrates through exported services (`MediaService` images, `AdminBookingsService.itemsByIds()` booking rows, `SettlementService.settleAllDue()`) | Ranking across a table's columns with the trigram operators can only be done in SQL, and one query per group is the no-N+1 rule. The same deviation as `analytics` (design §5, U16): a read-only module reads in its own queries, writes nothing, and every row it shows from another module (bookings) goes through that module's service. Recorded in design §5 |
| `q` is trimmed and needs 2 to 100 characters (`VALIDATION_FAILED` otherwise; no NUL). Matching is case-insensitive | Design §13.2; the same bounds as the admin list searches (U14, U15) |
| A hit is a case-insensitive substring match (`ILIKE '%q%'`, wildcards escaped) **or**, for a query of 3 or more characters, a typo-tolerant match on a name or title: `q <% column` (pg_trgm word similarity at least `pg_trgm.word_similarity_threshold`, 0.6 by default) | PRD: "case-insensitive and accepts part of a word"; acceptance: typos tolerated. Word similarity compares the query with the best-matching part of the title, so "Incepton" finds "Inception" and "ahmd helmy" finds "Ahmed Helmy". Under 3 characters a trigram match means almost nothing. Emails, phones and references are never fuzzy: a near-miss there is a different person or booking. Both operators are served by the same trigram GIN indexes |
| Ranking: each matched column gets a tier: exact (whole value, any case) 0, prefix 1, substring 2, typo-tolerant only 3. Within a tier, the entity's first column wins (a title before a cast name, a theater name before its district, a name before an email before a phone). Then higher word similarity, then a stable order (title or name, or newest first for bookings and customers, then id) | "Ranked by similarity" (design §13.2): a typed match always outranks a fuzzy one, and among fuzzy ones the closest comes first, so a typo still puts the intended item first |
| Public: Coming soon and Now showing movies only; people credited on one of them only (as `GET /people`); theaters with status `active` only (as `GET /theaters`). A draft or archived movie, a draft or sales-paused theater, or a person known only from drafts never appears, also not as a movie's matched cast member | Discovery's visibility rules (U8, design §11: "shows only Coming soon and Now showing movies and active theaters") |
| Public groups: up to 5 hits each; staff groups: up to 10 each; each group carries `hasMore` | Design §13.2. `hasMore` costs nothing (`LIMIT n + 1`) and tells the frontend to show "See all" |
| A movie found by its cast carries `matchedPerson { id, fullName }`; one found by its title has `matchedPerson: null`. A movie is listed once, with its best match | PRD: "movies (title or cast)": the result explains why a movie is there |
| Staff search by role: **box office** gets `bookings` and `customers`; **admin** gets those plus `movies`, `people` and `theaters` in every status (drafts included). For box office the three catalog groups are `null` and are never queried | PRD: "Admin search results (both roles): … limited to what the role may see"; box office's nav is Bookings, Customers and Scan tickets, and every movies, people and theaters route is `@Admin()` (design §11). `null` (not an empty list) tells the frontend the group is not available to this role |
| Bookings: a whole reference in any case (`mq-7k3p9q`) finds exactly that booking (`uq_bookings_reference`); anything else matches the booking's contact name (substring or typo-tolerant), email or phone (substring; a local mobile `01012345678` also matches `+201012345678`). Any status, as the admin bookings list. Hits are U14's `AdminBookingListItem` rows, after `settleAllDue()` | The same search as `GET /admin/bookings?q=` (U14), ranked; the same row shape and statuses as the Bookings table, so no stale Pending |
| Customers: live accounts only (`deleted_at IS NULL`), by name (substring or typo-tolerant), email or phone (substring, the local mobile rule). Hits are a short `AdminSearchCustomer` (id, name, email, phone, status, verified, joined) | The admin Customers list's rules (U15). The drawer (`GET /admin/customers/{id}`) has the numbers; search only finds the account |
| An anonymised customer is never found: the account row is excluded and has no name, email or phone; their bookings' contact fields were cleared (design §21), so their old name, email or phone finds none of their bookings. Such a booking is still found by its reference | Design §21 keeps the bookings for accounting; the reference carries no personal data |
| Public search is `@RateLimit('search')` (60 per minute per IP, `RATE_LIMIT_SEARCH`) and may be cached for 60 seconds (`Cache-Control: public, max-age=60`, an error `no-store`), like every discovery read. Staff search has the default limit and `Cache-Control: private, no-store` | Design §10.6. Staff search answers with personal data, so no shared cache may keep it; staff at one counter share an IP, so the tighter public limit would throttle them |
| Every query of a request runs one after the other on the pool (no transaction: GET) | The codebase's rule for reads that may share a connection; each query is small |

## Modules and files

`src/modules/search/`:

| File | Holds |
|---|---|
| `search.module.ts` | Imports `MediaModule`, `BookingsModule`; exports `SearchService` |
| `search.controller.ts` | `GET /search` |
| `admin-search.controller.ts` | `GET /admin/search` |
| `search.service.ts` | `SearchService.searchPublic(q)`, `searchStaff(q, role)` |
| `search.repository.ts` | The five ranked queries |
| `search-terms.ts` | `searchTermsOf(q)` (patterns, the local mobile, the reference, fuzzy or not) and the tier and match SQL fragments |
| `search-response.mapper.ts` | Response DTOs from the service results |
| `search.constants.ts`, `enums.ts`, `types.ts` | Limits and lengths; the staff groups by role; row and result types |
| `dto/search.query.ts` | `SearchQuery` |
| `dto/search.response.ts` | `SearchResults`, the movie, person and theater groups and hits |
| `dto/admin-search.response.ts` | `AdminSearchResults`, the booking and customer groups, `AdminSearchCustomer` |

Additions elsewhere: `bookings/admin-bookings.service.ts` (`itemsByIds()`),
`common/database/migration-list.ts`, `common/swagger/swagger.constants.ts` (tags), `app.module.ts`.

## Migration `0190_01_add_search_indexes`

Indexes and comments only, so the previous release runs beside them (design §6.1).

| Index | Definition | Serves |
|---|---|---|
| `idx_theaters_name_trgm` (new) | `gin ((name::text) gin_trgm_ops)` | `name::text ILIKE ?` and `? <% name::text` (both searches). `name` is CITEXT, which `gin_trgm_ops` does not take |
| `idx_theaters_district_trgm` (new) | `gin (district gin_trgm_ops)` | `district ILIKE ?` and `? <% district` |
| `idx_movies_title_trgm`, `idx_people_full_name_trgm`, `idx_customers_full_name_trgm`, `idx_bookings_contact_name_trgm` (comments updated) | existing | now also `? <% column`, the typo-tolerant match of `GET /search` and `GET /admin/search` |
| `idx_customers_email_trgm`, `idx_customers_phone_trgm`, `idx_bookings_contact_email_trgm`, `idx_bookings_contact_phone_trgm` (comments updated) | existing | `GET /admin/search` substring matches too |

`down` drops the two new indexes and restores the previous comments. Other paths use existing
indexes: cast `idx_movie_credits_person_id_movie_id`, a person's roles `person_roles` primary key,
"credited on a public movie" `idx_movie_credits_person_id_movie_id`, references
`uq_bookings_reference`, booking rows `bookings` primary key.

## Endpoints

All under `/api/v1`. Times are Cairo ISO with offset; money `{ amount, currency }`.

| Route | Access | S | Success | Errors |
|---|---|---|---|---|
| `GET /search?q=` | `@Public()`, `@RateLimit('search')` | | `200 SearchResults` | `400 VALIDATION_FAILED` (`q`); `429 RATE_LIMITED`; `503 SERVICE_UNAVAILABLE` |
| `GET /admin/search?q=` | `@Staff()` | | `200 AdminSearchResults` | `400 VALIDATION_FAILED` (`q`); `401 UNAUTHENTICATED` (no token, or a customer token: it is not a staff token); `503` |

Every route also documents `500 INTERNAL` and `429 RATE_LIMITED` (cross-cutting docs).

**Request DTO** — `SearchQuery`: `q` (required string, trimmed, 2–100 characters, no NUL).

**Response DTOs** (names as `contracts/openapi.yaml` gives them; the contract wins)

- `SearchResults` (`GET /search`): `q` (the trimmed query), `movies: SearchMovieGroup`,
  `people: SearchPersonGroup`, `theaters: SearchTheaterGroup`.
- `SearchMovieGroup` / `SearchPersonGroup` / `SearchTheaterGroup`: `items` (best first, at most 5
  publicly or 10 for staff), `hasMore` (boolean).
- `SearchMovie`: `id`, `title`, `status` (`MovieStatus`; publicly only `coming_soon` or
  `now_showing`), `releaseDate` (date, nullable on a draft), `runtimeMinutes` (nullable on a draft),
  `ageRating`, `poster` (`Image`, nullable), `matchedPerson` (`SearchMatchedPerson { id, fullName }`,
  nullable).
- `SearchPerson`: `id`, `fullName`, `photo` (`Image`, nullable), `roles` (`CreditRole[]`, in the
  credit role order: the roles set on the person plus those credited, publicly on public movies
  only).
- `SearchTheater`: `id`, `name`, `status` (`TheaterStatus`; publicly only `active`), `district`,
  `city`, `cover` (`Image`, nullable).
- `AdminSearchResults` (`GET /admin/search`): `q`, `bookings: AdminSearchBookingGroup`,
  `customers: AdminSearchCustomerGroup`, `movies`, `people`, `theaters` (the groups above, or
  `null` for box office).
- `AdminSearchBookingGroup`: `items: AdminBookingListItem[]` (U14's row), `hasMore`.
- `AdminSearchCustomerGroup`: `items: AdminSearchCustomer[]`, `hasMore`.
- `AdminSearchCustomer`: `id`, `fullName`, `email`, `phone` (nullable), `status`, `emailVerified`,
  `joinedAt`.

## Queries (no N+1)

`GET /search`: three ranked queries (movies, people, theaters) and one image lookup per group
with images (`MediaService.findByIds`): at most 6 queries, whatever matches.
`GET /admin/search` (admin): `settleAllDue()`, then bookings (one ranked query of ids, then
`itemsByIds()`: the rows, seats, showtimes and payments in a fixed number of queries), customers
(one), then the three catalog groups as above. Box office skips the catalog groups.

## Exported services

- `SearchService.searchPublic(q)` and `searchStaff(q, role)` (for a later "See all" or a command
  palette).
- `AdminBookingsService.itemsByIds(ids)`: U14 admin list rows for booking ids, in the given order,
  unknown ids left out (for U19's exports or any screen that lists chosen bookings).
- `searchTermsOf(q)` in `search/search-terms.ts`.

## Tests

- Unit (`test/unit/modules/search/`, collaborators mocked):
  - `search-terms.test.ts`: trimming, escaping `%`, `_` and `\`, the prefix pattern, the local
    mobile's E.164 pattern, a reference in any case, fuzzy only from 3 characters, the tier and
    match fragments.
  - `search.service.test.ts`: limits per audience, `hasMore` from the extra row, the role's
    groups (box office never queries movies, people or theaters and answers `null`), settlement
    before staff booking hits, hydration order kept, images resolved once per group, alt texts.
  - `dto/search.query.test.ts`: `q` trimmed, required, 2–100, NUL refused.
  - `test/unit/modules/bookings/admin-bookings.items-by-ids.test.ts`: `itemsByIds()` keeps the
    order asked, drops unknown and repeated ids, judges at the clock's now, queries nothing for none.
- Integration (`test/integration/modules/search/`, real app and Postgres):
  - `search.controller.test.ts`: substring and typo matches with the exact match first and the
    typo-tolerant match ranking first among fuzzy ones; cast matches with `matchedPerson`; people
    by name with roles; theaters by name and district; drafts, archived movies, people only on
    drafts, draft and sales-paused theaters never appear (also not as cast); at most 5 per group
    and `hasMore`; validation; the cache header; the `search` rate limit answers `429
    RATE_LIMITED` with `Retry-After` after the configured count; the query count is fixed.
  - `admin-search.controller.test.ts`: admin sees all five groups with drafts; box office sees
    bookings and customers and `null` for the rest; a customer token is refused; bookings by
    reference (any case), contact name with a typo, email and local mobile; customers likewise;
    an anonymised customer is found neither by their old name, email nor phone, and none of
    their bookings is found by those details (only by reference); a booking hit is the admin list
    row with its clock-derived status; at most 10 and `hasMore`; `Cache-Control: private,
    no-store`.
  - `test/integration/migrations/0190_search.test.ts`: both new indexes exist with comments naming
    their queries, the updated comments name `/search`, and the planner uses the trigram indexes
    for `ILIKE` and `<%`.

## Acceptance

- Gates pass: typecheck, lint, the full suite (nonzero pass count, no failures or skips), build,
  and `npm run contract` leaves `contracts/openapi.yaml` unchanged.
- Tests prove: a typo-tolerant match ranks first; drafts and inactive items never appear publicly;
  admin search results differ by role as above; anonymised customers are not findable by their old
  details; the public route is rate limited.
