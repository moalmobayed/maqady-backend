---
title: "#29 P4 — Hall screen size and projection format"
owner: Mohamed Tarek
status: Built
last_verified: 2026-11-13
tags: [halls, discovery, showtimes, theaters, seed, contract, frontend-gaps]
---

# #29 P4 — Hall screen size and projection format

Issue: #29 (API Data Gaps Report, 2026-11-08), package P4. Docs folder:
`docs/gh-29-hall-screen-format/`. Migration range `0290_31` to `0290_39` (one used). Builds on
U5 (halls: `halls`, `HallsService`, `HallReadService`, the admin hall DTOs), U7 (showtimes:
`ShowtimeView`, `ShowtimeReadService`), U8a and U8b (discovery: the theater page,
`PublicShowtime`, the two public showtime lists) and the development seed. Design:
`docs/system-design.md` §5, §6.2, §9, §11, §14; PRD v2 C3, C5, A4.

## Goal

The frontend report asks for:

- item 7, theater details "SHOWTIMES HERE": each time chip names its hall and its **projection
  format** ("Atmos");
- item 10, theater details halls: the **screen size** ("22.1m x 12.3m");
- item 12, movie details showtimes matrix: per theater and day, the **formats** on offer
  ("Standard, VIP") without scanning every showtime.

PRD v2 had removed hall formats ("Every hall is a standard hall"), together with format
pricing, format filters and revenue by format. This package brings back the **format as a
label of the hall**, not as a price or a filter: zone prices stay the only prices. PRD v2 and the
design are amended in the same change.

## Scope

- Migration `0290_31_add_halls_format_and_screen`: `halls.format VARCHAR(16) NOT NULL` with a
  CHECK mirrored by `HALL_FORMATS` in `src/modules/halls/enums.ts` (every existing hall becomes
  `standard`), and `halls.screen_width_cm INT NULL`, `halls.screen_height_cm INT NULL`, both or
  neither, each 100 to 5000 (1 m to 50 m).
- Admin (`AdminTheaterHallsController`, `AdminHallsController`, `HallsService`):
  - `POST /admin/theaters/{id}/halls` accepts optional `format` (default `standard`),
    `screenWidthMeters` and `screenHeightMeters`.
  - `PATCH /admin/halls/{id}` accepts the same three; `null` screen sizes clear the screen.
  - `HallResponse` (every admin hall route: get, list, create, patch) returns `format`,
    `screenWidthMeters` and `screenHeightMeters`.
  - The `hall.updated` audit event names the changed fields (`format`, `screenWidthMeters`,
    `screenHeightMeters`, with `name` when renamed in the same request), names only.
- Public (`DiscoveryResponseMapper`, `ShowtimeBrowseService`):
  - `GET /theaters/{id}`: each of `halls[]` (`PublicHall`) returns `format` and `screen`
    (`{ widthMeters, heightMeters }` or null).
  - `PublicShowtime` returns `format`, its hall's format: `GET /movies/{id}/showtimes` and
    `GET /theaters/{id}/showtimes`.
  - `GET /movies/{id}/showtimes`: each `days[].theaters[]` (`MovieShowtimeTheater`) returns
    `formats`, the distinct formats of its showtimes that day, in the format order.
- Read models: `HallRow`, `HallSummary` (and so `HallAdminView`, `HallLayout` unchanged) gain
  the format and screen; `ShowtimeView` gains `hallFormat`, taken from the hall rows
  `ShowtimeReadService.viewsOf()` already reads (no extra query).
- Seed: `SeedTheater.halls` takes a hall name (as today) or a `SeedHall`
  (`{ name, format?, screenWidthMeters?, screenHeightMeters? }`). The `halls` step sends the
  format and screen on create, and fills them with one `PATCH` on an existing hall still at the
  defaults (`standard`, no screen). Dataset values are P5's.
- Contract: `contracts/openapi.yaml` regenerated. The home-page draft is **not** changed: no
  schema `GET /home` returns holds a hall or a showtime chip.

## Out of scope

- Format pricing, format filters (the IMAX and VIP filters) and revenue by format: the PRD's
  removal of those stays. Zone prices are the only prices.
- 3D as a format: it is a property of the print a showtime plays, not of the hall; it would need
  a per-showtime field (follow-up if the frontend asks).
- The format on the admin showtime screens (`ShowtimeHallRef` of the timeline, manage panel and
  dry run, `TimelineHall`), on the movie page side panel (`NextShow`), on the seat page
  (`GET /showtimes/{id}`), on bookings and tickets. Follow-ups; the report does not ask.
- The theater card's `facilities` and format badges on the home page (PRD C1 keeps "up to 3
  facilities instead of format badges").
- Dataset values (each real hall's format and screen): P5.
- Other report items (facets, theater fields, gallery, WhatsApp, rating): other packages.

## Decisions

| Decision | Why |
|---|---|
| Formats: `standard`, `vip`, `imax`, `dolby_atmos`, `4dx`, `screenx`, `max`; labels Standard, VIP, IMAX, Dolby Atmos (the chip may say "Atmos"), 4DX, ScreenX, MAX. The enum order is the display order of `formats` | The design's list (2D, IMAX, 4DX, Dolby Atmos, VIP recliners; 2D is `standard`) and the report's ("Atmos", "Standard, VIP"), plus the two premium formats Cairo and Giza multiplexes sell (ScreenX, MAX), so P5's real halls fit without another CHECK change. 3D left out (above) |
| `format VARCHAR(16) NOT NULL DEFAULT 'standard'`; the service always writes it | The previous release inserts halls naming its columns and never `format`; a NOT NULL column without a default would break its "Add hall" during a deploy (design §6.1 "expand first"). The default also fills every existing hall with `standard`, which is what they are. It is a label, not a critical column the Clock or a rule decides. Dropping the default is a contract-phase follow-up |
| Screen size stored as `screen_width_cm` / `screen_height_cm INT`, both or neither (`chk_halls_screen_size`), each 100 to 5000 (`chk_halls_screen_width_cm`, `chk_halls_screen_height_cm`) | Whole centimetres keep 22.1 m exact without NUMERIC; the largest screens are under 40 m wide; below 1 m is not a cinema screen. A size is meaningless with only one side |
| API in metres: `screenWidthMeters` / `screenHeightMeters`, JSON numbers 1 to 50 with at most 2 decimals (`HasAtMostDecimals(2)`), stored as `Math.round(m × 100)` cm and read back as `cm / 100`. Text, 3 decimals, 0.5 or 50.01 is `VALIDATION_FAILED` on the field | The design writes metres ("22.1m x 12.3m"); 2 decimals are exactly the centimetres stored, so what an admin types is what customers see |
| Both or neither **in the request**: sending one of the two without the other is `VALIDATION_FAILED` on the missing side only ("screenHeightMeters is required with screenWidthMeters"), a null beside a number on the null side ("… can be null only when … is null too"). Both null clears the screen | One rule the DTO can judge alone, the same as the CHECK; never a half-changed screen. The editor sends the pair |
| `PATCH` that changes nothing writes nothing; a format or screen change on a retired hall is allowed (like a rename) | The existing PATCH rules |
| Audit: one `hall.updated` event per PATCH that changes the name, format or screen, `changedFields` naming each changed field by its API name (`name`, `format`, `screenWidthMeters`, `screenHeightMeters`); a status change keeps its own event | Design §13.5: field names, never values. A rename alone still records `['name']`, as before |
| Admin `HallResponse`: flat `format`, `screenWidthMeters`, `screenHeightMeters` (nullable) | The editor's fields, sent back as they are taken |
| Public `PublicHall.screen`: `HallScreen { widthMeters, heightMeters }` or null; `PublicHall.format` required | The UI shows one "22.1m x 12.3m" or nothing; an object that is null as a whole cannot be half-filled |
| `PublicShowtime.format` at the chip's root, required, the hall's **current** format | The chip shows it beside the hall name. A showtime has no format of its own (prices are by zone), so changing a hall's format changes its showtimes' label, as renaming it changes their hall name |
| `MovieShowtimeTheater.formats`: distinct formats of that theater's listed showtimes that day, in the enum order; empty never (a group exists only with showtimes) | "Standard, VIP" chips without scanning. Started showtimes count (they are listed); ended ones are not listed and do not count |
| No extra query: `HALL_COLUMNS` gains the three columns, so `HallReadService` and `ShowtimeReadService.viewsOf()` keep their fixed number of queries | CLAUDE.md "No N+1"; proven by the existing query-cost test with formats asserted |
| Seed: `SeedTheater.halls` is `readonly (string \| SeedHall)[]`; a name alone is a standard hall without a screen. On create the step sends what the dataset has; on an existing hall whose format is `standard` and screen null it sends one `PATCH` with the dataset's non-default values. A hall an admin already changed is left alone | The seed only adds what is missing. `halls: string[]` keeps working, so `demo` and `egypt-2026` need no change; staging halls get P5's values on the next run |

## Modules and files

- `src/migrations/0290_31_add_halls_format_and_screen.ts` (and its row in
  `src/common/database/migration-list.ts`).
- `src/modules/halls/`: `enums.ts` (`HALL_FORMATS`), `types.ts` (`HallFormat`, `HallScreen`,
  rows, `HallSummary`, `NewHallInput`, `HallChanges`), `halls.constants.ts` (screen limits,
  `DEFAULT_HALL_FORMAT`), `hall-screen.ts` (metres ↔ centimetres), `hall-rows.ts`,
  `halls.repository.ts`, `halls.service.ts` (`fieldChanges()`), `hall-response.mapper.ts`,
  `admin-halls.controller.ts`, `admin-theater-halls.controller.ts`, `dto/hall-fields.ts` (new),
  `dto/create-hall.request.ts`, `dto/update-hall.request.ts`, `dto/hall.response.ts`.
- `src/modules/showtimes/`: `types.ts` (`ShowtimeView.hallFormat`), `showtime-rows.ts`.
- `src/modules/theaters/dto/validators.ts`: `decimalsOf()` exported, reused by the screen check.
- `test/support/halls.ts`: `setHallSpec()`.
- `src/modules/discovery/`: `types.ts`, `showtime-browse.service.ts`,
  `discovery-response.mapper.ts`, `dto/public-showtime.response.ts`,
  `dto/movie-showtimes.response.ts`, `dto/public-theater.response.ts`.
- `src/modules/seed/`: `types.ts` (`SeedHall`, `SeedHallSpec`, `SeedHallRow`), `seed.steps.ts`
  (`seedHallOf`).
- `contracts/openapi.yaml`.

## Migrations

`0290_31_add_halls_format_and_screen` (expand only):

```sql
ALTER TABLE halls
  ADD COLUMN format VARCHAR(16) NOT NULL DEFAULT 'standard',
  ADD COLUMN screen_width_cm INT NULL,
  ADD COLUMN screen_height_cm INT NULL,
  ADD CONSTRAINT chk_halls_format
    CHECK (format IN ('standard', 'vip', 'imax', 'dolby_atmos', '4dx', 'screenx', 'max')),
  ADD CONSTRAINT chk_halls_screen_size
    CHECK ((screen_width_cm IS NULL) = (screen_height_cm IS NULL)),
  ADD CONSTRAINT chk_halls_screen_width_cm CHECK (screen_width_cm BETWEEN 100 AND 5000),
  ADD CONSTRAINT chk_halls_screen_height_cm CHECK (screen_height_cm BETWEEN 100 AND 5000);
```

Column comments say what each holds. No index: nothing filters or sorts halls by format or
screen. `down` drops the three columns (their constraints go with them).

## Endpoints

### `POST /admin/theaters/{id}/halls` (admin)

Request, new optional fields:

| Field | Type | Rules |
|---|---|---|
| `format` | `HallFormat` | one of the seven; left out, `standard`; null refused |
| `screenWidthMeters` | number \| null | 1 to 50, at most 2 decimals; with `screenHeightMeters` |
| `screenHeightMeters` | number \| null | 1 to 50, at most 2 decimals; with `screenWidthMeters` |

Response `201 HallResponse` with the three fields.

### `PATCH /admin/halls/{id}` (admin)

The same three fields, all optional (at least one field of the request still required);
`screenWidthMeters: null, screenHeightMeters: null` clears the screen. Errors:
`VALIDATION_FAILED` (unknown format, a null format, range, decimals, one side alone or a number
beside a null). `hall.updated` names the changed fields.

### `GET /admin/halls/{id}`, `GET /admin/theaters/{id}/halls` (admin)

`HallResponse` gains `format` (`HallFormat`), `screenWidthMeters` (number \| null, example 22.1)
and `screenHeightMeters` (number \| null, example 12.3).

### `GET /theaters/{id}` (public)

`PublicHall` gains `format` (`HallFormat`) and `screen` (`HallScreen` \| null:
`{ widthMeters: 22.1, heightMeters: 12.3 }`).

### `GET /movies/{id}/showtimes`, `GET /theaters/{id}/showtimes` (public)

`PublicShowtime` gains `format` (`HallFormat`, the hall's). `MovieShowtimeTheater` (movie list
only) gains `formats` (`HallFormat[]`, distinct, in the format order, at least one).

## Tests

Unit (`test/unit/`, collaborators mocked):

- `modules/halls/hall-screen.test.ts`: metres ↔ centimetres round trip (22.1 ↔ 2210, 12.35,
  1, 50), null both ways.
- `modules/halls/dto/hall-requests.test.ts`: format accepted, defaulted only by the service,
  null and unknown refused; both screen sides accepted, both null accepted on PATCH; one side
  alone, a number beside a null, 0, 0.99, 50.01, 3 decimals, text refused on the right field;
  a PATCH with only a format or only a screen is a valid request.
- `modules/halls/halls.service.test.ts`: create stores the format (default `standard`) and the
  screen in centimetres; update writes only changed fields, records one `hall.updated` with the
  changed field names, writes nothing for the same values, and keeps the status event.
- `modules/discovery/showtime-browse.service.test.ts`: the per-day `formats` of a theater are
  distinct and in the format order.
- `modules/seed/seed.steps.test.ts`: the `halls` step sends format and screen on create; fills
  them with one `PATCH` on an existing default hall; leaves a changed hall alone; a name-only
  hall sends `{ name }` as before.

Integration (`test/integration/`, real Postgres, real wiring):

- `migrations/0290_hall_screen_format.test.ts`: a hall written before the migration (the
  migration run down and up again in a rolled-back transaction) reads `standard` with no screen
  after it, and an insert naming only the previous release's columns still works; the CHECKs
  refuse an unknown format (`3d`), one side alone and 99 or 5001 cm; each column has a comment.
- `modules/halls/admin-halls.controller.test.ts` ("format and screen" block): create with a
  format and screen answers them in metres and stores centimetres; `GET` returns them; `PATCH`
  changes them and the audit row names the fields; both null clears; one side alone and an
  unknown format are refused and nothing changes.
- `modules/discovery/theater-browse.controller.test.ts`: `GET /theaters/{id}` halls return the
  format and screen (and null for a hall without one), valid against the contract.
- `modules/discovery/showtime-browse.controller.test.ts`: every chip of both lists returns its
  hall's format; the matrix gives each theater-day its `formats`; the query-cost test still
  counts the same queries for few and many showtimes, now with a second format in play.
- `modules/seed/seed.steps.test.ts`: the real `halls` step creates a hall with a format and
  screen and back-fills a default hall.
- `modules/discovery/dto/discovery-contract.test.ts` (unchanged): every `/home` schema equals
  the draft.
- `modules/seed/seed.command.test.ts` (unchanged): both datasets still seed and re-seed.

## Acceptance

- Gates: typecheck, lint, the whole suite, build, and the contract regenerated with a clean
  `git status`.
- Tests prove: the migration gives existing halls `standard`; format and screen validation
  (both or neither, range, centimetre round trip); theater details halls and both public
  showtime reads return the hall format (and the halls their screen); the per-day formats of the
  movie matrix; the query count does not grow with the number of showtimes.
- `docs/gh-29-hall-screen-format/qa.md` records curl evidence of every changed route.
