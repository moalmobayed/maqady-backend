---
title: "#29 P5 — Review of the seed data, staging freshness and the frontend answer"
owner: Mohamed Tarek
status: Passed — 2026-11-13, no open blocker or major findings
last_verified: 2026-11-13
tags: [review, seed, datasets, staging, ci, licences, frontend-gaps, docs]
---

# #29 P5 — Review of the seed data, staging freshness and the frontend answer

Issue #29 (API Data Gaps Report, every item: P5 fills the fields P1 to P4 added and answers the
report), spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range: `35c622e..88a91bf` on
`unit/gh-29-seed-staging-data`, against the report, the spec, `docs/system-design.md` (§14,
D-31 to D-36) and the `CLAUDE.md` stack rules, anti-patterns and testing policy.

The code finding was reproduced with a test that failed before the fix. The documentation
findings were checked against the code and the generated contract.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| F1 | minor | **The Commons gallery captions did not say the pictures were changed.** The six City Stars and Cosmos photos are CC BY-SA 3.0 and 4.0. Both licences ask a re-user to say when the work was modified (4.0 §3(a)(1)(B)), and `downloadedImage` crops every download to 1600 × 1067 around its most salient part. The captions credited the author, the licence and the source, but not the crop. | The Commons API (`prop=imageinfo&iiprop=extmetadata`) confirmed each file's licence and author as captioned: `CC BY-SA 3.0`/Salehmetwaly for `City stars 020`, `021` and `022`, `CC BY-SA 4.0`/LittleT889 for `Citystars Shopping Mall, Heliopolis`, and `CC BY-SA 4.0`/Marsupium for `Cosmos Cinema in Cairo 01` and `02`, all with `AttributionRequired: true`. The dataset test in `test/unit/modules/seed/datasets/index.test.ts` was changed to require the caption to end `, via Wikimedia Commons, cropped`, and it failed on egypt-2026 with `"credit": false`. | Fixed in `674eac0`. Each caption ends `, cropped` (the longest is 102 characters, under the 120 limit). The spec and the frontend answer say so. No deployment holds the old captions: staging has not been seeded with P5, and only a local QA database has them. |
| F2 | minor | **The frontend answer said more about staging than the workflow does.** (a) It said staging "is now re-seeded every morning", but GitHub runs a `schedule` only from the default branch (`main`, per `gh api repos/…` → `default_branch`), and the work lands on `main-jf8hqi`. Until `main-jf8hqi` is merged into `main`, nothing runs. (b) The morning run seeds only `egypt-2026`, so the demo's showtimes still run out 7 days after the last manual demo run. The showtime formats only the demo has (`imax`, `dolby_atmos` (the report's "Atmos" example), and `4dx`) appear on staging only during that week. | Reading `.github/workflows/seed-staging.yml`: `SEED_DATASET` is `egypt-2026` for every event except `workflow_dispatch`. The default branch came from the REST API. `git rev-list --count origin/main..origin/main-jf8hqi` = 55. | Fixed in `674eac0`. The answer says the schedule starts once the change reaches `main`, and that the demo's showtimes and its extra formats stay only for the week after a manual demo run. The README adds that a scheduled run checks out `main`'s seed code and dataset, and that the demo's showtimes are not refreshed. |
| F3 | minor | **The README's staging reset would not work on a warm instance.** Step 3 said the first request after `DROP SCHEMA maqady CASCADE` migrates from zero. `migrateLatest()` and the bootstrap admin run only in `createApp()` (`src/main.ts`), once per instance boot. A Vercel instance still warm from before the drop keeps answering against the missing schema. | Reading `src/main.ts` and `src/common/database/migration.repository.ts`: no other code path migrates the database at runtime. | Fixed in `674eac0`. Step 3 now says to redeploy staging first, so a new instance boots and migrates. |
| F4 | low | **Field names in the docs did not match the contract.** The frontend answer said the genre facet ignores the `genre` filter, but the query parameter is `genres`. It also did not mention that `facets.people` is capped at 30, with `facets.peopleTotal` for "Show all". The spec's route table listed `halls[].screenWidthMeters`/`screenHeightMeters` and `.price` for the public routes, which actually send `halls[].screen {widthMeters, heightMeters}` and `fromPrice`/`prices`, with the rating under `movie.rating`. | `contracts/openapi.yaml`: the `GET /movies` parameters (`genres`), `MovieFacets` (`people` with `maxItems: 30`, `peopleTotal`), `PublicHall` (`screen` → `HallScreen`), `PublicShowtime` and `TheaterShowtimeMovie`. | Fixed in `674eac0`. |
| F5 | info | **`downloadedImage` waits at most 30 s even when `Retry-After` asks for longer.** The builder's summary said it waits "at least Retry-After", but `retryDelay` caps every wait at `SEED_IMAGE_MAX_RETRY_WAIT_MS` (30 s). | `test/unit/modules/seed/seed-images.test.ts` pins the cap: a `Retry-After: 120` gives a 30 000 ms wait. | **Open, by design.** The spec states the cap, and a 30 s cap keeps a run inside the workflow's 30-minute timeout. If the host is still busy, the seed throws, naming the URL, and the next run finishes the gallery (`missingGallery`). |
| F6 | info | **`qa.md` quotes the gallery captions as they were before F1.** | Reading `qa.md` (the `GET /theaters/2` evidence). | **Open, by design.** QA is a record of what was run. The new captions are covered by the dataset test. |

## Checked, with nothing to report

- **Report items.** The answer covers all 15 items. Each route and field it names exists in
  `contracts/openapi.yaml`: `facets.genres/people/showDates`, `totalHalls`, `Facility` with
  `prayer_room` and `kids_room`, `postalCode` on `TheaterCard`, `PublicTheaterListItem` and
  `PublicTheater`, `whatsapp`/`whatsappUrl`, `PublicHall.format`/`screen`, `PublicShowtime.format`,
  `MovieShowtimeTheater.formats`, `rating`/`ratingSource`, and `/similar`. Its example counts
  agree with the datasets: 9 + 7 Now showing, 4 + 4 Coming soon (the demo draft is not counted),
  and 13 published theaters with 69 + 7 halls. Its showtime examples match the dataset slots
  (Almaza `Hall 1` `max` at 12:30, `Hall 3` `vip` at 13:30).
- **Contacts.** P5 changes no read path. `whatsapp` is still nulled with the other contacts when
  `showContactsPublic` is false (`TheaterBrowseService`). The demo theater that hides its
  contacts (Sheikh Zayed) has no WhatsApp number.
- **Migrations.** None in the range, and nothing in `migration-list.ts` changed.
- **Swagger and contract.** No DTO or route changed, and `npm run contract` leaves
  `contracts/openapi.yaml` unchanged.
- **/home.** Unchanged. The workflow's `/home` summary step only reads it.
- **N+1.** The seed is a client of the admin API, and P5 adds no repository query. The gallery
  and facilities back-fills reuse the `GET /admin/theaters/{id}` the step already made.
- **Seed back-fills.** `needsFacilities` adds `prayer_room` only to facilities that equal the
  dataset's list minus `prayer_room`; any other admin change is left alone (unit-tested).
  `missingGallery` relies on the gallery order, and `theater-photos.repository.ts` returns photos
  ordered by `sort_order`. A null admin caption, a reordered gallery or extra photos all leave it
  alone. Movie ratings are back-filled only while `rating` is null. A hall format is back-filled
  only on a hall still at the defaults. Re-packed VOX slots meet any older showtime through the
  dry run, so they are skipped, never doubled. Staging's old showtimes (2026-10-29 to 11-04) are
  all past.
- **Dataset correctness.** Existing tests check that slots keep the 20-minute cleaning gap with
  the dataset runtimes, fit opening hours and use existing halls. P5 tests cover ratings,
  postal codes, E.164 numbers, facility enums, caption lengths, hall formats and screen ranges.
  Almaza is capped at one `max` and three `vip` halls.
- **Workflow.** The cron `17 5 * * *` is 07:17/08:17 Cairo, after the 06:00 cinema-day turnover.
  The seed takes `today` from the server's `GET /home` `cinemaDate`. `inputs.*` is empty on a
  scheduled run and falls back to the defaults. `concurrency` queues overlapping runs.
- **Tests.** The retry, the half-finished gallery and the facilities back-fill assert behavior:
  calls, waits, uploads and their sizes. The integration expectations (7 halls, 172 showtimes,
  15 gallery images, hall counts 2 at Zamalek and New Cairo) follow from the demo data.

## Gates after the fixes

Typecheck and lint clean. 2065 unit and 1006 integration tests pass. The build passes, the
contract is unchanged, and `git status` is clean after the commit.
