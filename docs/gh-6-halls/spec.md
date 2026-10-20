---
title: U5 — Halls - hall CRUD, layout editor, hall lock
owner: Mohamed Tarek
status: Built — 2026-10-20
last_verified: 2026-10-20
tags: [halls, layouts, seat-maps, zones, aisles, hall-lock, publishing, admin]
---

# U5 — Halls: hall CRUD, layout editor, hall lock

Issue: #6. Docs folder: `docs/gh-6-halls/`. Migration prefix `0060`. Depends on U4b
(`theaters`, `TheatersModule`, `TheaterReadService`, `TheaterLifecycleRegistry`) and, through it,
U2a (staff resolver, `test/support/staff-auth.ts`, `test/support/routes.ts`) and U1. Design:
`docs/system-design.md` §5, §6.1, §6.2 (`halls`, `hall_rows`, `hall_seat_marks`), §7.1, §8
(capacity), §9 (hall layouts, theater lifecycle), §11, §14; PRD v2 "Halls and seat maps",
"Prices" 1, A4.

## Goal

An admin adds halls to a theater, edits each hall's seat map (rows, seats per row, a zone per
row, wheelchair spaces and gaps) as one atomic replace under the hall lock, activates and
retires halls, and cannot publish a theater without an active hall. Scheduling (U7), discovery
(U8) and holds (U10) read halls and layouts through one exported read service, and plug the
showtime-dependent rules into a registry this unit owns.

## Scope

- Migrations `0060_01`–`0060_03`: `halls`, `hall_rows`, `hall_seat_marks`.
- `src/modules/halls/` (`HallsModule`): repositories, `HallsService`, `HallLayoutService`, the
  exported `HallReadService` and `HallLifecycleRegistry`, the pure `hall-layout.ts`, two admin
  controllers, 7 admin routes (table below), audit events, complete Swagger.
- The `active_hall` publish requirement, registered with U4b's `TheaterLifecycleRegistry`.
- Error codes `HALL_NOT_DELETABLE` and `HALL_NOT_RETIRABLE`.
- `docs/system-design.md` §6.2, §9, §11, §14.3 updated (Decisions below); `docs/INDEX.md`.
- Test support: `test/support/halls.ts` (`createHall()`, `setHallStatus()`, `addActiveHall()`)
  for every suite that needs a hall. U4b's `TheaterLifecycleProbe` no longer stands in for
  `active_hall`: the theater suites now add a real active hall (it keeps U7's `has_showtimes`
  stand-in), and their "16 theater routes" checks leave out the two `…/theaters/{id}/halls`
  routes, which this unit's suite covers.

## Out of scope

- Showtimes and seat claims. The in-use rule, the retire rule, the delete rule and the capacity
  refresh are seams in `HallLifecycleRegistry`: **U7** registers the `has_showtimes` deletion
  blocker, the `has_future_showtimes` retirement blocker and the capacity participant; **U10**
  registers the live-claim probe that makes `HALL_IN_USE` fire. Until then every hall is
  deletable and retirable and no layout save is refused as in use. Follow-ups: see
  "Follow-ups" below.
- Public reads (`GET /theaters/{id}` halls, `/showtimes/{id}` layout, `hallCount` on the home
  page): U8 and U10, from `HallReadService`.

## Decisions taken here

| Decision | Why |
|---|---|
| Rows are lettered from the screen back: `row_index` 0 = `A`, using `ROW_LABELS = 'ABCDEFGHJKLMNOP'` (15 letters, no `I`). The label is stored and CHECKed against the index | PRD "A to P, skipping I"; design §6.2 stores `row_label`; the CHECK keeps the pair honest. |
| Seats are numbered 1…`seatsPerRow` left to right; a `no_seat` cell keeps its number (numbers don't close up). A seat's label is `<row><number>`, e.g. `F7` | Labels stay stable when a gap is painted; `seat_claims` keys on the label. |
| A new hall is `draft` with the standard 12 × 16 layout: rows A–C `front`, D–H `middle`, J–M `back`, no marks (192 seats) | PRD A4 "New halls start as a standard 12 × 16 layout"; zones from the design inventory. |
| Zones must form bands: going from row A back, zones never step backwards (`front` → `middle` → `back`); any zone may be empty | The customer map draws zone bands with their prices (PRD C6 "zone bands with prices"), which a front row behind a back row would break; the zone names say where the rows are. |
| A layout must keep at least one seat (`no_seat` cells are not seats; wheelchair spaces are) | An all-gap hall can't sell anything. PRD occupancy counts wheelchair spaces as seats. |
| `aisleAfter = [4, seatsPerRow − 4]` deduplicated and sorted: 8 → `[4]`, 16 → `[4, 12]`, 20 → `[4, 16]`. Never stored | Design §9. |
| Status transitions: `draft → active`, `draft → retired`, `active → retired`. `retired` is final. Anything else is `409 CONFLICT` `details: { from, to }` | U4b's pattern. PRD "Halls and seat maps" 5: retired is "kept for history, hidden from scheduling"; nothing in the PRD brings a hall back, so it stays final (YAGNI; a later unit can add `retired → active`). |
| Retiring needs every retirement blocker to pass, else `409 HALL_NOT_RETIRABLE` `details.reasons`; deleting needs every deletion blocker to pass (any status), else `409 HALL_NOT_DELETABLE` `details.reasons` | Design §9, PRD "Halls and seat maps" 5. Specific codes let the Halls tab explain itself. |
| Retiring the last active hall of a published theater is allowed; the theater stays `active` | Publishing is a one-time gate (§9: "Publishing (`draft` → `active`) requires … at least one active hall"); a published theater with no schedulable hall simply has no new showtimes, and the admin pauses sales if needed. |
| Hall names are unique per theater, case-insensitive, across every status (`name CITEXT`, `uq_halls_theater_id_name`); a clash is the generic `409 CONFLICT` with `details.constraint` | Reports and history name halls; two "Hall 3"s, even one retired, would be ambiguous. |
| Hard delete, children `ON DELETE CASCADE`; no `deleted_at` | Only a hall that never had a showtime goes, so nothing references it. |
| A retired hall's layout can't be replaced: `409 CONFLICT` `details: { status: 'retired' }`. Renaming it is allowed | Retired halls are history. |
| Lock order for every hall write: theater `FOR SHARE` (`TheaterReadService.lockForShare`) → layout participants' `beforeLock` (U7 locks the hall's future scheduled showtimes `FOR UPDATE`, in id order) → hall `FOR UPDATE` | Keeps §7.1 (showtime before hall) and U4b's rule (theater first). Without `beforeLock`, U7's capacity refresh would lock showtime rows after the hall and deadlock against a hold holding showtime `FOR SHARE` → hall `FOR SHARE`. |
| Layout validation that spans fields (row count vs zones, marks inside the grid, bands, at least one seat, duplicates) is the pure `layoutErrors()` / `validateLayout()`, called by the service after the `NOT_FOUND` and retired checks, throwing `VALIDATION_FAILED` with every field path at once. Shapes and ranges are DTO decorators | The global `ValidationPipe` handles shapes; cross-field rules live in one tested function, not the controller. |
| Seat counts are computed from rows and marks (batched), never stored | No second copy to drift; a fixed number of queries per page. |
| Added routes `GET /admin/theaters/{id}/halls` (cursor list) and `GET /admin/halls/{id}` | The Halls tab and the editor header need them; §11 is silent. |
| `HallResponse.deletable` comes from the deletion blockers, which take a batch of ids | The Halls tab shows "Delete" or "Retire" without an N+1. |
| A `PATCH` that changes nothing answers `200` and writes no audit row | Same as U2a, U4b. |
| A rename that only changes letter case (`hall 3` → `Hall 3`) is a change | The stored text changes even though `CITEXT` compares equal. |
| Every hall write (create, `PATCH`, `DELETE`, layout) locks the theater `FOR SHARE` first | U4b's rule (§9): publishing checks `active_hall` with the theater locked, so it serialises with hall status changes. |
| Open questions in the draft: none | — |

## Modules and files

**`src/modules/halls/`** — `HallsModule`, imports `TheatersModule`. Providers: `HallsRepository`,
`HallLayoutRepository`, `HallsService`, `HallLayoutService`, `HallReadService`,
`HallLifecycleRegistry`. Exports `HallReadService`, `HallLifecycleRegistry`. `AppModule` imports
`HallsModule`.

| File | Holds |
|---|---|
| `enums.ts` | `HALL_STATUSES = ['draft','active','retired']`, `ZONES = ['front','middle','back']`, `SEAT_MARK_KINDS = ['wheelchair','no_seat']` |
| `types.ts` | `HallStatus`, `Zone`, `SeatMarkKind`; rows `HallRow`, `NewHallRow`, `HallRowUpdate`, `HallRowRow` (a `hall_rows` row), `HallSeatMarkRow`; layouts `LayoutRow`, `SeatMark`, `HallLayoutInput`, `ZoneSeatCounts`, `SeatCounts`, `LayoutGrid`, `HallLayout`, `HallSeat`, `SeatPosition`; halls `HallSummary`, `HallAdminView` (summary + `deletable`), `HallListFilter`, `HallChanges`, `HallAuditDetails`; seams `HallBlocker`, `HallBlockingShowtime`, `HallInUseShowtime`, `HallLayoutParticipant` |
| `halls.constants.ts` | `ROW_LABELS = 'ABCDEFGHJKLMNOP'`, `MIN_ROWS = 4`, `MAX_ROWS = 15`, `MIN_SEATS_PER_ROW = 8`, `MAX_SEATS_PER_ROW = 20`, `AISLE_OFFSET = 4`, `MAX_SEAT_MARKS = 300`, `HALL_NAME_LIMITS` (1–40), `DEFAULT_LAYOUT` (12 × 16, A–C/D–H/J–M), `HALL_STATUS_TRANSITIONS`, `HALL_STATUS_ACTIONS`, `MAX_BLOCKING_SHOWTIMES = 20`, `ACTIVE_HALL_REQUIREMENT` |
| `hall-layout.ts` | pure: `rowLabelAt(index)`, `rowIndexOf(label)`, `seatLabel(rowLabel, seatNumber)`, `parseSeatLabel(label)`, `aisleAfter(seatsPerRow)`, `layoutRows(rowZones)`, `layoutErrors(input)` (field errors) and `validateLayout(input)` (throws them), `layoutSeats(grid)`, `seatCounts(grid)` |
| `hall-rows.ts` | `HallChildren` (groups batched rows and marks by hall), `toHallSummary()`, `toHallLayout()` |
| `halls.repository.ts` | `insert`, `findById`, `findByIdForUpdate`, `findByIdForShare`, `findByIds`, `listByTheater(filter, page)`, `countByTheater(filter)`, `listByTheaterIds(ids, statuses)`, `hasActiveHall(theaterId)`, `update`, `deleteById` |
| `hall-layout.repository.ts` | `rowsOf(hallIds)`, `marksOf(hallIds)`, `replace(hallId, rows, marks)` (one `DELETE` of the rows, cascading marks; one multi-row `INSERT` each) |
| `hall-lifecycle.registry.ts` | `HallLifecycleRegistry`: the three `add…` methods, `layoutParticipants()`, `deletionReasons(hallIds)`, `retirementReasons(hallIds)` |
| `halls.service.ts` | `HallsService`: create, list, get, patch (rename, status), delete; registers `active_hall` in `onModuleInit` |
| `hall-layout.service.ts` | `HallLayoutService`: get and replace |
| `hall-read.service.ts` | the exported reads, and `summariesOf(rows)` the admin service shares |
| `hall-response.mapper.ts` | functions `toHallResponse`, `toHallLayoutResponse`, `toZoneSeatCountsResponse` |
| `admin-theater-halls.controller.ts` | `@Controller('admin/theaters/:id/halls')`: list, create |
| `admin-halls.controller.ts` | `@Controller('admin/halls')`: get, patch, delete, `:id/layout` get and put |
| `dto/` | requests: `hall-id.params.ts`, `hall-list.query.ts`, `create-hall.request.ts`, `update-hall.request.ts`, `replace-hall-layout.request.ts` (`ReplaceHallLayoutRequest`, `SeatMarkRequest`); responses: `hall.response.ts`, `hall-page.response.ts` (`HallResponsePage`), `zone-seat-counts.response.ts`, `hall-layout.response.ts` (`HallLayoutResponse`, `HallLayoutRowResponse`, `SeatMarkResponse`) |
| `halls.module.ts` | the module |

Path params (`id`): positive integers (`@Type(() => Number)`, `IsInt`, `Min(1)`), else
`VALIDATION_FAILED`. The theater id of `…/theaters/{id}/halls` is `TheaterIdParams` from U4b.
Names are trimmed (`Trim`, `HasLength` from U4b's `dto/validators.ts`) before checks.

## Migrations (prefix `0060`)

Every table gets `ENABLE ROW LEVEL SECURITY`; no defaults; times from the `Clock`; every index
commented with its query; enum CHECKs mirror `enums.ts`.

**`0060_01_create_halls`**

```sql
CREATE TABLE halls (
  id BIGSERIAL PRIMARY KEY,
  theater_id BIGINT NOT NULL,
  name CITEXT NOT NULL,
  status VARCHAR(16) NOT NULL,
  row_count SMALLINT NOT NULL,
  seats_per_row SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_halls_theater_id FOREIGN KEY (theater_id) REFERENCES theaters (id) ON DELETE CASCADE,
  CONSTRAINT uq_halls_theater_id_name UNIQUE (theater_id, name),
  CONSTRAINT uq_halls_id_theater_id UNIQUE (id, theater_id),
  CONSTRAINT chk_halls_status CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT chk_halls_name CHECK (length(name) BETWEEN 1 AND 40 AND btrim(name) = name),
  CONSTRAINT chk_halls_row_count CHECK (row_count BETWEEN 4 AND 15),
  CONSTRAINT chk_halls_seats_per_row CHECK (seats_per_row BETWEEN 8 AND 20)
);
```

| Index | Query it serves |
|---|---|
| `uq_halls_theater_id_name` | Covers `fk_halls_theater_id`; admin list `WHERE theater_id = ? ORDER BY name, id` with cursor `(name, id) > (?::citext, ?)`; `listByTheaterIds` `WHERE theater_id IN (…)`; `hasActiveHall` `WHERE theater_id = ? AND status = 'active'` (a theater has few halls) |
| `uq_halls_id_theater_id` | Target of U7's composite FK `showtimes (hall_id, theater_id)` (design §6.3) |

**`0060_02_create_hall_rows`**

```sql
CREATE TABLE hall_rows (
  hall_id BIGINT NOT NULL,
  row_index SMALLINT NOT NULL,
  row_label VARCHAR(1) NOT NULL,
  zone VARCHAR(8) NOT NULL,
  CONSTRAINT pk_hall_rows PRIMARY KEY (hall_id, row_index),
  CONSTRAINT fk_hall_rows_hall_id FOREIGN KEY (hall_id) REFERENCES halls (id) ON DELETE CASCADE,
  CONSTRAINT uq_hall_rows_hall_id_row_label UNIQUE (hall_id, row_label),
  CONSTRAINT chk_hall_rows_row_index CHECK (row_index BETWEEN 0 AND 14),
  CONSTRAINT chk_hall_rows_row_label CHECK (row_label = substr('ABCDEFGHJKLMNOP', row_index + 1, 1)),
  CONSTRAINT chk_hall_rows_zone CHECK (zone IN ('front', 'middle', 'back'))
);
```

`pk_hall_rows`: covers the FK; "rows of halls `WHERE hall_id IN (…) ORDER BY hall_id,
row_index`"; the replace's `DELETE … WHERE hall_id = ?`. `uq_hall_rows_hall_id_row_label`:
target of the marks FK. "Rows exist for exactly `row_count` indexes" is the service's rule
(one transaction).

**`0060_03_create_hall_seat_marks`**

```sql
CREATE TABLE hall_seat_marks (
  hall_id BIGINT NOT NULL,
  row_label VARCHAR(1) NOT NULL,
  seat_number SMALLINT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  CONSTRAINT pk_hall_seat_marks PRIMARY KEY (hall_id, row_label, seat_number),
  CONSTRAINT fk_hall_seat_marks_hall_id_row_label FOREIGN KEY (hall_id, row_label)
    REFERENCES hall_rows (hall_id, row_label) ON DELETE CASCADE,
  CONSTRAINT chk_hall_seat_marks_seat_number CHECK (seat_number BETWEEN 1 AND 20),
  CONSTRAINT chk_hall_seat_marks_kind CHECK (kind IN ('wheelchair', 'no_seat'))
);
```

`pk_hall_seat_marks`: covers the FK; "marks of halls `WHERE hall_id IN (…)`". The FK puts every
mark in an existing row; `seat_number <= seats_per_row` is the service's rule.

## Behaviour

**Create** (`POST`, request transaction): `lockForShare(theaterId)` (null → `NOT_FOUND`) →
insert the hall (`draft`, 12 × 16) and `DEFAULT_LAYOUT`'s rows → audit `hall.created`.

**Patch**: read the hall (null → `NOT_FOUND`) → `lockForShare(theaterId)` → hall `FOR UPDATE` →
apply `name` → if `status` changes, check the transition; for `→ retired` run every retirement
blocker and refuse with the keys that object → update `updated_at` → audit.

**Delete**: same locks → every deletion blocker → delete (rows and marks cascade) → audit
`hall.deleted` → `204`.

**Replace layout** (`PUT`, request transaction, design §9):

1. Read the hall (null → `NOT_FOUND`); `retired` → `409 CONFLICT { status: 'retired' }`.
2. `validateLayout(input)` → `VALIDATION_FAILED` with every failing field path:
   `rowZones` length ≠ `rowCount` (`rowZones`); zones out of band order (`rowZones.<i>`); a mark's
   row beyond `rowCount` or not in `ROW_LABELS` (`seatMarks.<i>.rowLabel`); `seatNumber >
   seatsPerRow` (`seatMarks.<i>.seatNumber`); the same seat twice (`seatMarks.<i>`); no seat left
   (`seatMarks`).
3. `lockForShare(theaterId)` → each participant's `beforeLock(hallId)` → hall `FOR UPDATE`, so the
   save waits for in-flight holds that hold the hall `FOR SHARE`; re-check `retired`.
4. Collect `blockingShowtimes(hallId)` from every participant; any → `409 HALL_IN_USE`
   `details: { showtimes: [{ id, startsAt, movieTitle }] }` (`startsAt` via `formatCairoIso`,
   ordered by `startsAt`, at most 20).
5. Update `row_count`, `seats_per_row`, `updated_at`; `HallLayoutRepository.replace()`.
6. Each participant's `afterSave(hallId, layout)` (U7 refreshes future showtimes'
   `seat_capacity`, design §8) → audit `hall.layout_replaced` → `200 HallLayoutResponse`.

Any throw after step 5 rolls back the whole replace with the request transaction.

**`active_hall` publish requirement** (`HallsService.onModuleInit`):
`TheaterLifecycleRegistry.addPublishRequirement({ key: 'active_hall', isMet: id =>
hallsRepository.hasActiveHall(id) })`. It runs in U4b's publish transaction with the theater
`FOR UPDATE`; hall status changes take the theater `FOR SHARE`, so the two serialise.

**Audit events** (`AuditService.record`, in the write's transaction; actor = the staff principal;
entity `hall`; field names only):

| Action | Changed fields / metadata |
|---|---|
| `hall.created` | `{ theaterId }` |
| `hall.updated` | changed field names (not `status`) |
| `hall.activated` / `hall.retired` | `{ from, to }` |
| `hall.deleted` | `{ theaterId }` |
| `hall.layout_replaced` | `{ rowCount, seatsPerRow, seatCount, wheelchairCount }` |

## Endpoints

All under `/api/v1`, `@Admin()`, `@ApiTags('Admin: halls')`, with summary, description and
`@ApiErrorResponses(...)` (U1 adds access, idempotency and `429`). "Key" = optional
`Idempotency-Key`, claimed and stored by the write interceptor; **S** = `@Strict()`.

| Route | Idem. | Request | Response | Errors |
|---|---|---|---|---|
| `GET /admin/theaters/{id}/halls` | — | `HallListQuery` | `200 HallPage` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /admin/theaters/{id}/halls` | **S** | `CreateHallRequest` | `201 HallResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT` |
| `GET /admin/halls/{id}` | — | `HallIdParams` | `200 HallResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PATCH /admin/halls/{id}` | key | `UpdateHallRequest` | `200 HallResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT`, `HALL_NOT_RETIRABLE` |
| `DELETE /admin/halls/{id}` | key | — | `204` | `VALIDATION_FAILED`, `NOT_FOUND`, `HALL_NOT_DELETABLE` |
| `GET /admin/halls/{id}/layout` | — | `HallIdParams` | `200 HallLayoutResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PUT /admin/halls/{id}/layout` | key | `ReplaceHallLayoutRequest` | `200 HallLayoutResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT`, `HALL_IN_USE` |

**Request DTOs**

- `HallListQuery` extends `PageQuery`: optional `status` (`IsIn(HALL_STATUSES)`). Order `name,
  id`, sort-key kind `text`; `total` with the same filter.
- `CreateHallRequest`: `name` (1–40).
- `UpdateHallRequest`: optional `name` (1–40), optional `status` (`IsIn(HALL_STATUSES)`); at
  least one, else `VALIDATION_FAILED`.
- `ReplaceHallLayoutRequest`: `rowCount` (int 4–15), `seatsPerRow` (int 8–20), `rowZones`
  (`Zone[]`, 4–15 items, `IsIn(ZONES)` each; index 0 is row A), `seatMarks`
  (`SeatMarkRequest[]`, 0–300). `SeatMarkRequest`: `rowLabel` (`^[A-HJ-P]$`), `seatNumber` (int
  1–20), `kind` (`IsIn(SEAT_MARK_KINDS)`).

**Response DTOs**

- `HallResponse`: `id`, `theaterId`, `name`, `status`, `rowCount`, `seatsPerRow`, `seatCount`,
  `wheelchairCount`, `zoneSeatCounts` (`ZoneSeatCountsResponse` = `{ front, middle, back }`),
  `deletable`, `createdAt`, `updatedAt`. `HallPage = PageResponseOf(HallResponse)`; a page costs a
  fixed number of queries (halls, count, rows, marks, one batch per deletion blocker).
- `HallLayoutResponse` (`@ApiSchema({ name: 'HallLayout' })`, reusable by U8/U10): `hallId`,
  `rowCount`, `seatsPerRow`, `aisleAfter` (`number[]`), `rows` (`HallLayoutRowResponse[]` = `{
  label, zone }`, front to back), `seatMarks` (`SeatMarkResponse[]` = `{ rowLabel, seatNumber,
  kind }`, by row then seat), `seatCount`, `wheelchairCount`, `zoneSeatCounts`, `updatedAt`.

## Error codes added

| Code | HTTP | Details |
|---|---|---|
| `HALL_NOT_DELETABLE` | 409 | `{ reasons: string[] }`, e.g. `['has_showtimes']` |
| `HALL_NOT_RETIRABLE` | 409 | `{ reasons: string[] }`, e.g. `['has_future_showtimes']` |

Catalogue descriptions: "A hall that ever had a showtime can't be deleted; retire it instead." /
"A hall with upcoming showtimes can't be retired; move or cancel them first." `HALL_IN_USE`
(U1) gains its `details.showtimes` shape in the Swagger description.

## Services

**Exported by `HallsModule`** (for U7, U8, U10):

```ts
class HallReadService {
  findById(id: number): Promise<HallSummary | null>;                       // any status
  lockForShare(id: number): Promise<HallSummary | null>;                   // FOR SHARE in the open
                                                                           // transaction (§7.1 step 3: U7 scheduling, U10 holds)
  findLayout(hallId: number): Promise<HallLayout | null>;
  findLayouts(hallIds: readonly number[]): Promise<ReadonlyMap<number, HallLayout>>;  // 3 queries
  listByTheaters(theaterIds: readonly number[], statuses?: readonly HallStatus[]):
    Promise<ReadonlyMap<number, readonly HallSummary[]>>;                  // by name; 3 queries (U7 timeline, U8 hallCount and halls)
}
// HallSummary = { id; theaterId; name; status: HallStatus; rowCount; seatsPerRow;
//   seatCount; wheelchairCount; zoneSeatCounts: ZoneSeatCounts; createdAt: Date; updatedAt: Date }
// HallLayout = { hallId; theaterId; rowCount; seatsPerRow;
//   rows: readonly LayoutRow[] /* { index; label; zone } */;
//   seatMarks: readonly SeatMark[] /* { rowLabel; seatNumber; kind } */;
//   aisleAfter: readonly number[]; seatCount; wheelchairCount; zoneSeatCounts; updatedAt: Date }
// ZoneSeatCounts = { front: number; middle: number; back: number }

class HallLifecycleRegistry {
  addDeletionBlocker(blocker: HallBlocker): void;       // U7: 'has_showtimes'
  addRetirementBlocker(blocker: HallBlocker): void;     // U7: 'has_future_showtimes'
  addLayoutParticipant(participant: HallLayoutParticipant): void;  // U7: capacity; U10: live claims
  layoutParticipants(): readonly HallLayoutParticipant[];
  deletionReasons(hallIds: readonly number[]): Promise<ReadonlyMap<number, string[]>>;
  retirementReasons(hallIds: readonly number[]): Promise<ReadonlyMap<number, string[]>>;
}                                                       // duplicate key in one list → throws; order kept
// HallBlocker = { key: string; blockedIds(hallIds: readonly number[]): Promise<ReadonlySet<number>> }
// HallLayoutParticipant = { key: string;
//   beforeLock?(hallId: number): Promise<void>;        // after theater FOR SHARE, before hall FOR UPDATE
//   blockingShowtimes?(hallId: number): Promise<readonly HallBlockingShowtime[]>;
//   afterSave?(hallId: number, layout: HallLayout): Promise<void> }
// HallBlockingShowtime = { showtimeId: number; startsAt: Date; movieTitle: string }
```

Also exported by path: `hall-layout.ts`'s `layoutSeats(layout)` → `HallSeat[]` = `{ label,
rowLabel, seatNumber, zone, isWheelchair }` for every seat (no gaps), the seat list U10 validates
holds against and snapshots into `booking_seats`; `seatLabel()`, `parseSeatLabel()`,
`aisleAfter()`, `ROW_LABELS`, `ZONES`, `HallLayoutResponse`, `toHallLayoutResponse()`.

**Consumed from U4b** (exact names): `TheatersModule`, `TheaterReadService.findById()`,
`.lockForShare()`, `TheaterLifecycleRegistry.addPublishRequirement()`,
`TheaterPublishRequirement`, `TheaterIdParams`.

**Consumed from U1** (exact names): `TransactionContext.executor()`, `TransactionRepository.run()`
(tests), `Strict()`, `Admin()`, `CurrentPrincipal()`, `StaffPrincipal`, `AuditService.record()`,
`Clock`, `formatCairoIso()`, `PageQuery`, `toPageRequest()`, `toPage()`, `PageResponseOf()`,
`AppError`, `ApiErrorResponses()`.

**Consumed from U2a** (tests only): `staffSession()` (`test/support/staff-auth.ts`),
`listHttpRoutes()`, `samplePath()`.

**Test support added** (`test/support/halls.ts`, for U7, U8, U10 suites): `HALLS`,
`theaterHallsPath(theaterId)`, `createHall(testApp, authorization, theaterId, name?)`,
`setHallStatus(testApp, authorization, hallId, status)`, `addActiveHall(testApp,
authorization, theaterId)`.

## Tests

**Unit** (`test/unit/modules/halls/`):

- `hall-layout.test.ts` (pure): `aisleAfter` 8 → `[4]`, 9 → `[4, 5]`, 12 → `[4, 8]`, 16 →
  `[4, 12]`, 20 → `[4, 16]`; `rowLabelAt` 0 → `A`, 7 → `H`, 8 → `J`, 14 → `P`, and `I` never
  appears; `DEFAULT_LAYOUT` is 12 × 16 with A–C/D–H/J–M and 192 seats; `seatCounts` with
  wheelchair (counted) and `no_seat` (not counted) marks per zone; `layoutSeats` labels and
  zones; `validateLayout` refuses each rule in Behaviour step 2 with the right field path, and
  accepts an all-`back` hall and a hall with an empty middle band.
- `halls.service.test.ts` (repositories, theater services, audit mocked): the transition table;
  retirement and deletion `reasons` list the objecting keys in registration order; a no-op
  `PATCH` writes no audit row; rename plus retire writes two.
- `hall-layout.service.test.ts`: participants run in the order `beforeLock` → lock →
  `blockingShowtimes` → replace → `afterSave`; a retired hall is refused before any lock.
- `hall-lifecycle.registry.test.ts`: duplicate key throws; order kept.
- DTO validation (global `ValidationPipe` options): `rowCount` 3 and 16, `seatsPerRow` 7 and 21,
  unknown zone, row label `I`, seat 0 and 21, unknown kind, 301 marks, empty `PATCH`.

**Integration** (`test/integration/modules/halls/`, real app and Postgres, `TestClock`, admin
and box-office sessions from `staffSession()`, theaters created and published through U4b's routes):

- Create and edit: `POST` → `201` draft 12 × 16, 192 seats, `aisleAfter [4, 12]`, audit
  `hall.created`; same name in another case → `409 CONFLICT`; same name in another theater → `201`;
  unknown theater → `404`; no key → `IDEMPOTENCY_KEY_REQUIRED`; same key → replay. `PATCH` rename;
  `draft → active`; `active → retired`; `retired → active` and `active → draft` → `409 CONFLICT
  { from, to }`; list of 25 halls → pages of 20 and 5 with `total` and the `status` filter.
- Layout: `PUT` 4 × 8 (zones front/middle/middle/back, `A1` wheelchair, `D8` no seat) → `GET`
  returns it with `aisleAfter [4]`, `seatCount 31`, `wheelchairCount 1`, zone counts; `PUT`
  15 × 20 → rows `A…P` without `I`, `aisleAfter [4, 16]`, 300 seats; shrinking to 4 × 8 removes
  the old rows and marks. Invalid layouts (mark `N5` in a 12-row hall, seat 17 in a 16-seat row,
  `rowZones` of 11 for 12 rows, zones `middle, front`, a duplicate mark, all gaps) → `VALIDATION_FAILED` and
  the stored layout is unchanged. A retired hall → `409 CONFLICT`.
- Atomic: a test participant whose `afterSave` throws → `500 INTERNAL`, and rows, marks, `row_count`
  and `seats_per_row` are exactly the previous layout; no audit row.
- In use (seam): a test participant returning one blocking showtime → `409 HALL_IN_USE` with
  `details.showtimes[0]` = `{ id, startsAt (+03:00 or +02:00), movieTitle }`, layout unchanged.
- Hall lock: a transaction holding the hall through `HallReadService.lockForShare()` makes a
  concurrent `PUT` wait until it commits (the `PUT` finishes after the release, by a recorded
  order of events), then succeeds.
- Delete and retire (seam): a hall with no blockers → `204`, its rows and marks gone, audit
  `hall.deleted`; a test deletion blocker → `409 HALL_NOT_DELETABLE ['has_showtimes']` and
  `deletable: false` in the list; a test retirement blocker → `409 HALL_NOT_RETIRABLE
  ['has_future_showtimes']`. Deleting a draft theater (U4b) removes its halls.
- Publishing: a theater with prices and hours and no hall → publish `409 THEATER_NOT_PUBLISHABLE
  missing: ['active_hall']`; with only a draft hall → same; with only a retired hall → same;
  after activating a hall → `200 active`. `GET /admin/theaters/{id}` `publishBlockers` includes
  `active_hall` until then.
- Reads: `listByTheaters()` and `findLayouts()` issue the same number of queries (Knex `query`
  event) for 1 and 10 halls; `listByTheaters(ids, ['active'])` filters.
- Access: every route from `listHttpRoutes()` under `/api/v1/admin/halls` and
  `/api/v1/admin/theaters/:id/halls` (asserted to be the 7 above) answers `403 FORBIDDEN` to a
  box-office token and `401 UNAUTHENTICATED` to none.
- Audit: each write leaves its row, with field names and counts only.
- Contract: `npm run contract` regenerates `contracts/openapi.yaml` with the 7 operations, the
  `HallLayout` schema and the two codes.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass, proving issue #6: hall create and edit; layout replace is atomic and
  validated (zones, seat marks inside the grid); aisles for small and large halls; publishing a
  theater without an active hall is refused; every hall admin route refuses a box-office token
  with `FORBIDDEN`.
- `docs/system-design.md` §6.2 (`name CITEXT`, `uq_hall_rows_hall_id_row_label`, the marks FK),
  §9 (zone bands, seat numbering, lock order with `beforeLock`), §11 (the two added `GET`s) and
  §14.3 (two codes) updated; follow-ups recorded for U7 (the two blockers, the `beforeLock` and
  `afterSave` capacity participant, the `showtimes (hall_id, theater_id)` FK to
  `uq_halls_id_theater_id`) and U10 (the live-claim `blockingShowtimes` participant, seat
  validation through `lockForShare` and `layoutSeats`); `docs/gh-6-halls/spec.md` is this draft.
