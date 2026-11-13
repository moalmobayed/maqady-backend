---
title: "#29 P4 — Review of the hall format and screen size"
owner: Mohamed Tarek
status: Passed — 2026-11-13, no open blocker or major findings
last_verified: 2026-11-13
tags: [review, halls, discovery, showtimes, theaters, seed, contract, frontend-gaps]
---

# #29 P4 — Review of the hall format and screen size

Issue #29 (API Data Gaps Report, items 7, 10 and 12), spec [`spec.md`](spec.md), QA
[`qa.md`](qa.md). Reviewed range: `631a017..55fe5d8` on `unit/gh-29-hall-screen-format`, against
the report items, the spec, `docs/system-design.md` (§6.2 halls, §9, §11, G16, D-34) and the
`CLAUDE.md` stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. F1's fix has unit tests that failed before it.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| F1 | minor | **The seed sent a no-op `PATCH` on every re-run for a dataset hall named as `standard`.** The `halls` step back-filled an existing hall still at the defaults with the whole dataset spec. A dataset entry such as `{ name: 'Hall 5', format: 'standard' }` therefore sent `PATCH /admin/halls/{id} {"format":"standard"}` on every run, because the hall stays at the defaults after it. A standard hall with a screen also sent `format: 'standard'` in its back-fill. The spec says the step sends "the dataset's non-default values". The `PATCH` changed nothing, but each one is a write call (and an idempotency row) on every seed run against staging. | Two unit tests in `test/unit/modules/seed/seed.steps.test.ts`. The first expected no write and got `[{ method: 'PATCH', path: '/admin/halls/61', body: { format: 'standard' } }]`. The second expected `{ screenWidthMeters: 14, screenHeightMeters: 6.2 }` and got an extra `format: 'standard'`. | Fixed in `924570d`. The back-fill (`backFillOf()` in `seed.steps.ts`) leaves out a `standard` format. A create still sends what the dataset has. |
| F2 | nit | **The spec named the wrong validator.** The Decisions table said the screen sides use `HasAtMostDecimals(2)`. The code uses `IsScreenSide` in `dto/hall-fields.ts`, which counts decimals with the shared `decimalsOf()`. | Reading `spec.md` against `src/modules/halls/dto/hall-fields.ts`. | Fixed in `924570d`. The spec names `IsScreenSide` and `decimalsOf()`. |

## Checked, with nothing to report

- **Report items 7, 10, 12.** Every time chip on `GET /movies/{id}/showtimes` and
  `GET /theaters/{id}/showtimes` carries `format`, from `ShowtimeView.hallFormat`. Both lists
  map chips through the single `DiscoveryResponseMapper.publicShowtime`, so no path drops it.
  `GET /theaters/{id}` halls carry `format` and `screen` (`{ widthMeters, heightMeters }` or
  null). The movie matrix gives each theater-day its distinct `formats`, in `HALL_FORMATS`
  order, computed from the listed (not ended) showtimes. The seat page's `PublicShowtime`
  (bookings module) is a different schema and is out of scope, as the spec says.
- **Migration.** `0290_31_add_halls_format_and_screen` is in `migration-list.ts`. Existing rows
  pass every new CHECK: `format` gets `'standard'`, which is in the list, and the screen columns
  are NULL, which passes `BETWEEN` and `chk_halls_screen_size`. The default keeps the previous
  release's hall insert working, and the integration test proves it. `down` drops the three
  columns, and their constraints go with them.
- **Validation.** Probed through the global `ValidationPipe`: `true`, `"22.1"`, `[1]`, `{}`,
  49.999 and a lone side are refused on the right field. 1 and 50 are accepted, and both null
  clears the size. `format: null` and `["vip"]` are refused, and `{}` still asks for a field.
  The pipe has no implicit conversion, so a string is never coerced to a number.
- **Writes and audit.** `fieldChanges()` compares each side in the stored centimetres, so
  re-sending the same size writes nothing. A changed screen writes both columns, so the both-
  or-neither CHECK holds. `hall.updated` names fields, never values. A status change that fails
  (`HALL_NOT_RETIRABLE`, `CONFLICT`) rolls back the format and screen in the same transaction.
- **Queries.** No new query and no N+1: `HALL_COLUMNS` gains the three columns, and the
  showtime views take the format from the hall rows `viewsOf()` already reads. The query-cost
  integration test still counts the same queries with an IMAX hall and more showtimes. No other
  repository selects hall rows. The admin showtime mapper builds its response field by field,
  so `hallFormat` does not leak into `AdminShowtime`.
- **Contract.** `npm run contract` regenerated `contracts/openapi.yaml` with no diff. The
  `nullable` + `allOf` shape of `PublicHall.screen` is the pattern the contract already uses for
  nullable objects. The home-page draft is unchanged, because no `/home` schema holds a hall or
  a showtime chip. The draft contract test passes.
- **Contacts, counts, pagination, licences.** Not touched by this package. There are no new
  seed photos, and no dataset sets hall values yet (that is P5).
- **Coordination note (not a finding).** The design's decision row is D-34. P1 and P3 may use
  the same number in parallel, so the integrator may need to renumber it when merging.

## Gates (after the fix, on `924570d`)

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, "All matched files use Prettier code style!" |
| `npm test` | exit 0. Unit: 181 suites, 2005 tests passed. Integration: 110 suites, 968 tests passed |
| `npm run build` | exit 0 |
| `npm run contract` | exit 0, "Wrote contracts/openapi.yaml (104 paths)", no diff |
| `git status` | clean apart from the fix, committed as `924570d` |
