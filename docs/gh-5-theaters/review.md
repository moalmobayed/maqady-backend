---
title: U4b — Review of the theaters unit
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, theaters, opening-hours, special-dates, summer-time, zone-prices, publishing, photos, admin]
---

# U4b — Review of the theaters unit

Issue #5 (theaters half), spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`9c73568..4b4e531` on `unit/gh-5-theaters`. It was checked against design §6.2 (theater
tables), §7.1 (lock order), §8 (scheduling, time, opening hours and summer time), §9 (theater
lifecycle and image pipeline), §11 (admin theater routes) and §14, PRD v2.0 ("Theaters and
movies", "Time", "Prices", C4, C5, A4), the spec, and the `CLAUDE.md` stack rules, anti-patterns
and testing policy.

The review ran in two sittings. The first was cut off by a usage limit after two fixes
(`41961e1`, `4e6c318`). The second re-checked those two (each test fails against its parent's
code), merged `main-jf8hqi` into the branch (`647368a`: U2b, and the second rounds of U3 and
U2a), regenerated `contracts/openapi.yaml` with `npm run contract`, and finished the review.

Each finding was reproduced before it was fixed, and every behaviour fix has a test that failed
before it. The integration suites ran on this tree's own database (`maqady_u4b_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **Emails and coordinates that the database refuses answered `500 INTERNAL`.** `IsEmail` accepts a quoted local part (`"front desk"@example.com`), which `chk_theaters_email` refuses. class-validator's `maxDecimalPlaces` reads decimals from `toString()`, so it throws a `TypeError` on a number written with an exponent (`1e-7`) instead of refusing it. Both reached the client from `POST` and `PATCH /admin/theaters` as a 500. | New integration and DTO tests (quoted emails, `1e-7`, `-2.5e-8`) expected `VALIDATION_FAILED` on the named fields and got `INTERNAL`. The DTO test fails against `4b4e531`'s DTOs. | Fixed in `41961e1`. The DTOs also match `STORED_EMAIL_PATTERN` (the CHECK's rule), and `HasAtMostDecimals()` counts decimals from `toExponential()`. |
| R2 | minor | **A past special date could be moved to a later date and edited.** The spec says a special date before today's cinema date can only be deleted, but `PATCH` checked only the resulting date. Moving it forward also changed its hours and label. | A new unit test (stored `2026-10-01`, `PATCH` to `2026-10-25` with a new label) expected `VALIDATION_FAILED` on `cinemaDate` and no write. It fails against `41961e1`'s service. | Fixed in `4e6c318`. The stored date is checked first, with its own message. |
| R3 | minor | **Text lengths were counted differently from Postgres, so a text at the limit could answer `500 INTERNAL`.** class-validator's `Length` leaves U+FE0E and U+FE0F (emoji presentation selectors) out of its count. Postgres `length()` and `VARCHAR(n)` count them. 99 letters and "☺️" passed the 100-character name limit, then failed `VARCHAR(100)` and `chk_theaters_name`. The same applied to every theater text field: address, district, city, transit and parking info, phone labels, special date labels and photo captions. | A new integration test (`POST` with `name`, `address` and `transitInfo` one character over the limit by Postgres's count, a `PATCH` of `city`, a `PUT` of a phone label) expected `400 VALIDATION_FAILED` and got `500 INTERNAL`. A new DTO test (captions and a special date label) failed the same way against the old DTOs. | Fixed in `8258265`. `HasLength()` in `dto/validators.ts` counts code points, as Postgres does, and replaces `Length` in the theater DTOs. Text exactly at the limit is stored as sent (the test renames a theater to 98 letters and "☺️"). |
| R4 | minor | **The docs claimed that theater writes never block foreign key checks.** The spec's lock decision and `findByIdForWrite`'s comment said `FOR NO KEY UPDATE` lets other transactions' foreign key checks (`FOR KEY SHARE`) proceed. Postgres takes `FOR UPDATE` when an `UPDATE` changes a column with a unique index (`name`, `cover_image_id`), so during a rename or a cover change those checks wait. Correctness is unaffected: U5 and U7 lock the theater `FOR SHARE` first, and no deadlock cycle follows. | Two `psql` sessions on the test database. A transaction holding `FOR NO KEY UPDATE` that updated `updated_at` still let `SELECT … FOR KEY SHARE NOWAIT` through. After `UPDATE theaters SET name = …`, the same probe failed with "could not obtain lock on row". | Fixed in `a98126b` (docs and comment only). The spec decision and the repository comment now name the exception. |
| R5 | minor | **A NUL character (U+0000) in request text answers `500 INTERNAL`.** Postgres refuses NUL in text (SQLSTATE 22021), and the global exception filter does not map that code. This is not specific to theaters. | A throwaway integration test: `POST /admin/theaters` with `name: "Maqady\u0000 Zamalek"` → 500, and `POST /admin/staff` with `fullName: "A\u0000B"` → 500. | **Open, out of scope.** It is shared code (U1's `ValidationPipe` or the global exception filter), so it should be fixed once for every unit, not in theater DTOs. Suggested as a separate task. |

No blocker or major finding was found.

## Checked, with nothing to report

- **Access.** All 16 routes carry `@Admin()`, and `listHttpRoutes()` confirms it. Box-office
  tokens get `FORBIDDEN` and requests without a token `UNAUTHENTICATED` on every route. Another
  theater's special date or photo is `NOT_FOUND`.
- **Locks and races.** Every theater write locks the theater row before its children. Concurrent
  gallery uploads at 19 photos serialise on that lock, and the second one is refused under it.
  A theater deleted during an upload makes `link` answer `NOT_FOUND`, which removes the stored
  files (U4a). Two cover uploads serialise, and the second one deletes the first one's image,
  because `FOR NO KEY UPDATE` re-reads the committed row. Publishing reads the hours and the
  registered requirements while it holds the lock, and every hours write takes the same lock.
  `lockForShare()` conflicts with publishing, hours changes and deletion, as U5 and U7 need.
- **Transactions and idempotency.** `POST` routes are `@Strict()`; the others take an optional
  key. The upload route keeps U4a's carve-out (`@NoRequestTransaction()`, link inside the media
  transaction). Reads inside a write's transaction run one query at a time.
- **Time and summer time.** Every instant comes from `common/time` (`cinemaDateOf`,
  `cinemaMinuteToInstant`); there is no offset or millisecond arithmetic. Opening is 06:00 to
  23:59 and closing is at most 06:00 the next day, so windows of different cinema dates cannot
  overlap. A closing in the skipped hour of 24 April 2026 moves to 01:00 summer time. A closing
  in the repeated hour of 29 October resolves to its first occurrence. Both are covered by unit
  and integration tests.
- **Data model.** Migrations `0055_01`–`0055_07` follow the conventions: `BIGSERIAL` keys, named
  and indexed foreign keys, index comments with their query, `INT` money with `currency`,
  `TIMESTAMPTZ`, no defaults, row level security on, and enum CHECKs that mirror `enums.ts`.
  `fk_images_created_by_staff_id` uses U4a's covering index.
- **Queries.** No `SELECT *`. Every multi-theater read batches with `whereIn`: the admin list
  and `detailsOf()` cost a fixed number of queries, and a test counts them for 1 and 10
  theaters. The cursor `(name, id) > (?::citext, ?)` matches the `citext` order.
- **Code rules.** No inline types outside `types.ts`. No plain `Error` or `HttpException` in
  `src/modules/theaters`. Services throw `AppError` only.
- **Logging and audit.** Every write records field names or counts only. The integration suite
  checks that no phone number, email or address reaches `audit_events`.
- **Swagger.** Every operation has a summary, a description, the `Admin: theaters` tag and its
  error codes with examples. Nullable fields and enums (`TheaterStatus`, `Facility`,
  `TheaterPhotoUsage`) are marked. `Phone`, `OpenState` and `Facility` match the home-page
  draft.
- **Exports for later units.** `TheaterReadService`, `TheaterHoursService`,
  `TheaterLifecycleRegistry`, `MoneyRequest`, and the response DTOs and mappers U8 reuses are
  exported as the spec lists them.
- **Merge with `main-jf8hqi`.** The conflicts in the README, `docs/INDEX.md`, `AppModule`, the
  Swagger tags and design §14.3 were resolved by keeping both sides. The full suite passed on
  the merge before any further change.

## Gates on the final state

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run contract` were run
fresh on the final commit, followed by `git status`. The pass counts are recorded in this
review's commit message.
