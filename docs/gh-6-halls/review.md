---
title: U5 — Review of the halls unit
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, halls, layouts, seat-maps, hall-lock, publishing, admin]
---

# U5 — Review of the halls unit

Issue #6, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`be0dcc7..d434351` on `unit/gh-6-halls`, against design §5, §6.2 (`halls`, `hall_rows`,
`hall_seat_marks`), §7.1, §8 (capacity), §9 (hall layouts, theater lifecycle), §11 and §14.3,
PRD v2 "Halls and seat maps", "Prices" 1 and A4, the spec, and the `CLAUDE.md` build order,
stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. Every fix has a test that failed before it.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **A hall name holding a NUL character (U+0000) answered `500 INTERNAL`.** Postgres text cannot hold NUL (SQLSTATE 22021), and `CreateHallRequest` and `UpdateHallRequest` let it through, so `POST /admin/theaters/{id}/halls` failed the insert and `PATCH /admin/halls/{id}` failed the update. Admin only, and nothing was written, but a client mistake was logged as a server error. | A throwaway integration test through the real app: `POST` with `name: "Hall\u0000X"` → 500 and `PATCH` with `name: "X\u0000"` → 500. Then new DTO cases (create and update through the global `ValidationPipe`) and an HTTP case in `admin-halls.controller.test.ts`, which all failed. | Fixed in `5a1860d`. Both name fields carry `@NotContains('\u0000')`, as U9 did for `fullName` (`docs/gh-10-customer-accounts/review.md` R3), so the name is `VALIDATION_FAILED`. The same gap in theater text stays U4b's open R5 (`docs/gh-5-theaters/review.md`), to be fixed once in shared code. |
| R2 | minor | **The `SeatMark` response schema left `rowLabel` unconstrained.** The `HallLayout` schema U8 and U10 reuse described a mark's row only as "Row letter", while `SeatMarkRequest.rowLabel` has the pattern `^[A-HJ-P]$` and `HallLayoutRow.label` lists the letters. A client generated from the contract could not tell what a mark's row may be. | A new assertion in `hall-contract.test.ts` on `SeatMark.properties.rowLabel.pattern`, which failed against the generated document. | Fixed in `2a78bae`. The property carries the pattern and says it is one of the layout's rows; `contracts/openapi.yaml` is regenerated. |

No blocker or major finding was found.

## Checked, with nothing to report

- **Access.** All 7 routes carry `@Admin()` on top of the global guards, and `listHttpRoutes()`
  confirms it. A box-office token gets `403 FORBIDDEN` and no token `401` on every route, and the
  suite checks that nothing changed. No route is `@Public()`.
- **Lock order and races.** Traced each pair of writers against design §7.1 and §9:
  - every hall write locks the theater `FOR SHARE` (`TheaterReadService.lockForShare`), then the
    hall `FOR UPDATE`; a layout save runs the participants' `beforeLock` between the two, so
    U7's showtime locks keep "showtime before hall". U10's hold path (showtime `FOR SHARE` →
    hall `FOR SHARE`) never waits on a theater, so no cycle forms;
  - publishing holds the theater `FOR NO KEY UPDATE` while it reads `hasActiveHall`, which
    conflicts with the hall writes' `FOR SHARE`, so an activation or retirement can't interleave
    with the check;
  - two writes on one hall serialise on the hall lock; two creates with one name serialise on
    `uq_halls_theater_id_name`, and the loser is `409 CONFLICT` (a renamed clash was probed too:
    `PATCH` to `hall a` beside `Hall A` → `CONFLICT` with the constraint);
  - a hall or theater deleted while a write waited answers `NOT_FOUND` (the hall is re-read
    under its lock, and `retired` is re-checked under it before a layout save);
  - the integration test of `lockForShare()` records the save waiting for the holder
    (`released` → `saved 200`) through `pg_locks`, not a timer.
- **Transactions and idempotency.** `POST` is `@Strict()`; `PATCH`, `DELETE` and `PUT` take an
  optional key through the global write interceptor. Every service write runs in the request
  transaction (`TransactionRepository.run()` joins it). The atomic test makes `afterSave` throw
  and finds rows, marks, size and audit exactly as before.
- **Validation.** Shapes and ranges are DTO decorators (probed: `null` and string marks, `null`
  zones, string numbers, lower-case rows, unknown fields, ids beyond `MAX_SAFE_INTEGER`, a
  `[null, 1]` cursor; all `400` or an empty page). Cross-field rules are the pure
  `layoutErrors()`, run after `NOT_FOUND` and the retired check, with every field path at once.
- **Time.** The only times are `Clock.now()` and `formatCairoIso()`; `HALL_IN_USE` details are
  tested in `+03:00` and `+02:00`. No offset or millisecond arithmetic.
- **Data model.** Migrations `0060_01`–`0060_03`: `BIGSERIAL` key, `BIGINT` FKs, every FK named
  and covered by an index (`uq_halls_theater_id_name`, `pk_hall_rows`, `pk_hall_seat_marks`),
  every index commented with its query, `TIMESTAMPTZ`, no defaults, row level security on, enum
  CHECKs that mirror `enums.ts`, the row-label CHECK against `ROW_LABELS`, and the marks FK to
  `hall_rows`. Hard delete with cascading children matches "only a hall that never had a
  showtime goes"; no `deleted_at` is needed.
- **Queries.** No `SELECT *`; every column list is named. Reads of many halls batch rows and
  marks with `whereIn`, and the suite counts 3 queries for 1 and for 10 halls. The list cursor
  `(name, id) > (?::citext, ?)` matches the `citext` order, and names are unique per theater, so
  there are no ties.
- **Code rules.** No inline types outside `types.ts`, no plain `Error` or `HttpException` in
  `src/modules/halls`, services throw `AppError` only, controllers return response DTOs.
- **Logging and audit.** Audit rows carry field names, `{ from, to }`, the theater id or layout
  counts, never names.
- **Swagger.** Every operation has a summary, a description, the `Admin: halls` tag and its
  error codes with examples, including `HALL_IN_USE`, `HALL_NOT_DELETABLE` and
  `HALL_NOT_RETIRABLE`. `HallStatus`, `SeatZone` and `SeatMarkKind` are named enums.
- **Acceptance list and exports.** Every item of the spec's acceptance list has its test.
  `HallReadService`, `HallLifecycleRegistry`, `layoutSeats()`, `seatLabel()`,
  `parseSeatLabel()`, `aisleAfter()`, `ROW_LABELS`, `ZONES`, `HallLayoutResponse` and
  `toHallLayoutResponse()` are exported as the spec lists them for U7, U8 and U10.
- **Changes to earlier units.** The theater suites now publish with a real active hall, and their
  route-count checks leave out only the two `…/theaters/{id}/halls` paths. U1's catalogue and
  Swagger examples gain the two codes and the `HALL_IN_USE` shape. All earlier suites stay green.

## Gates

Fresh against the final commit of this review: `npm run typecheck`, `npm run lint`, `npm test`
(unit and integration suites, every test passing, none skipped), `npm run build`,
`npm run contract` and a clean `git status`.
