---
title: U19 — Exports and activity - CSV exports with formula escaping, the Activity log API
owner: Mohamed Tarek
status: Built
last_verified: 2026-10-29
tags: [exports, csv, activity-log, audit, admin, streaming, security]
---

# U19 — Exports and activity: CSV exports with formula escaping, the Activity log API

Issue: #20. Docs folder: `docs/gh-20-exports-activity/`. Migration prefix `0200` (unused: see
Migrations). Depends on U17 (`OverviewService`, `OverviewResponseMapper`) and, through it, U16
(`PaymentsReportService`, `PaymentsReportResponseMapper`), U15 (`AdminCustomersService`,
`AdminCustomerResponseMapper`), U14 (`AdminBookingsService`, `AdminBookingResponseMapper`), U11
(`SettlementService.settleAllDue()`), U2 (`StaffService.findByIds()`) and U1 (`AuditService`,
`audit_events` and its indexes, `TransactionRepository`, cursor pagination, the access
decorators). Design: `docs/system-design.md` §5, §6, §11 (export and activity routes), §13.4,
§13.5, §14, §21; PRD v2 A1 ("Export CSV of the current view"), A6, A7 ("Export (Admin)"), A8
("Export for accounting"), "CSV exports", "Activity log", and the role table.

## Goal

An admin downloads the rows they are looking at, the Overview of the current view, the Bookings
and Customers tables with their current filters, and the Payments transactions of a chosen
period, as CSV files a spreadsheet opens safely: no cell can run as a formula, however a
customer typed their name. Each download is recorded in the activity log, because the files
carry personal data. An admin reads the Activity log, who did what and when across the
dashboard, newest first, filtered by staff member, item type and date, and it never shows a
customer's personal data.

## Scope

- A new read-only feature module `exports` (`src/modules/exports/`) with four `@Admin()` routes:
  - `GET /admin/exports/overview.csv`
  - `GET /admin/exports/bookings.csv`
  - `GET /admin/exports/customers.csv`
  - `GET /admin/exports/payments.csv`
- A new read-only feature module `activity` (`src/modules/activity/`) with `GET /admin/activity`
  (`@Admin()`).
- `csv-stringify` (6.9.0) as a dependency (design §13.4).
- Additive in earlier units, so each export walks its list's own query:
  - `common/pagination/keyset-batches.ts`: `keysetBatches()`, a list read in batches by its
    keyset, the page query reused with no `total`.
  - `AdminBookingsService.exportBatches()` (bookings), `AdminCustomersService.exportBatches()`
    and `CustomerService.rowsForAdmin()` (admin-customers, customers),
    `PaymentsReportService.transactionBatches()` (analytics). Each validates exactly as its list
    route, settles due payments once, then reads keyset pages without counting.
  - `AdminCustomerResponseMapper` (admin-customers), `PaymentsReportResponseMapper` and
    `OverviewResponseMapper` (analytics) are exported, so a CSV row is built from the very
    response its list route answers.
- Swagger tags `Admin: exports` and `Admin: activity`; contract regenerated.

## Out of scope

- Other exports (movies, people, theaters, showtimes, staff, messages): not in PRD "CSV exports".
- Excel (`.xlsx`) or PDF reports; scheduled or emailed exports; an export history screen (the
  Activity log lists them, `entityType=export`).
- Item names in the Activity log (a movie's title, a theater's name): an item is its type and id,
  plus the booking reference for booking and payment events. Recorded as a follow-up.
- A rate limit of its own for exports: the default limit applies (follow-up).
- Changing what the list routes answer: every export reuses them unchanged.

## Decisions

| Decision | Why |
|---|---|
| Routes `GET /admin/exports/{overview,bookings,customers,payments}.csv`, `@Admin()` | Design §11 and §13.4: "Admins only". A box-office token is `FORBIDDEN`, a customer token `UNAUTHENTICATED` |
| Each export takes exactly its screen's query parameters, without `cursor` and `limit`: overview = `GET /admin/overview` (`period` or `dateFrom` / `dateTo`, `theaterId`); bookings = `GET /admin/bookings` (`q`, `theaterId`, `movieId`, `status`, `channel`, `method`, `dateFrom`, `dateTo`, `customerId`); customers = `GET /admin/customers` (`q`, `status`); payments = `GET /admin/payments` (`kind`, `method`, `channel`, `status`, `theaterId`, `dateFrom`, `dateTo`). The query DTOs are `OmitType(<list query>, ['cursor', 'limit'])`, so the validation is the same code | PRD: "Bookings and Customers (current filters)", "Payments for accounting (chosen period)", "Overview (current view)"; design §13.4 "with the same filters as the screen". A `cursor` or `limit` is `VALIDATION_FAILED` (`forbidNonWhitelisted`): an export is the whole filtered list |
| The rows of a list export are the rows of its list route, in the same order (bookings and customers newest first by `created_at, id`; payments newest `occurredAt` first), every page, with the same fields: each CSV row is built from the list's own response DTO (`AdminBookingResponseMapper.listItem()`, `AdminCustomerResponseMapper.item()`, `PaymentsReportResponseMapper.transaction()`) | "Each export matches its list route's rows and filters", by construction rather than by a second query to keep in step |
| **Streaming in keyset batches** of 500 rows (`ExportOptions.batchSize`): each batch is one page query of the list (`limit 501`, keyset after the last row), hydrated as the list hydrates a page (bookings' `BookingViews.ofMany()`, customers' stats, staff names: a fixed number of queries per batch), turned into CSV records by an async generator, through `Readable.from()` and `csv-stringify` to the response. The next batch is read only when the response has taken the previous one (stream backpressure), so memory holds one batch whatever the export's size. *Deviation from design §13.4 ("from a Knex stream")* | A Knex stream on `pg` needs `pg-query-stream`, holds one pooled connection (of 5, design §14.2) and one statement for the whole download, which `statement_timeout` (10 s) would cut on a slow client; and every row needs the list's per-page hydration anyway. A batch is a short indexed query, like a page of the screen. Recorded in design §13.4 |
| The export settles due payments once (`settleAllDue()`) and fixes `now` before the first row, like one page of its list; rows written while it downloads may or may not be in it, as with paging. The total is not counted | Design §7.5: settle in a batch before admin lists. Counting would be one more scan the file does not need |
| **Formula escaping**: every text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'`, header cells included. Numbers are written as numbers and never prefixed | Design §13.4 (OWASP CSV injection). A number is never text a spreadsheet evaluates, and a refund's amount must stay a negative number for accounting. A phone in E.164 (`+2010…`) is text, so it is prefixed and stays text |
| Cells: money in EGP as a decimal number (`190`, `19.5`, `-40`) with a Currency column; times in Cairo ISO with their offset, as the API answers them; booleans `yes` / `no`; null an empty cell; a list (seats) joined with spaces | One file for spreadsheets and accounting; the same times the screens show |
| UTF-8 with a byte-order mark, CRLF line ends, a header row, fields quoted when they hold a comma, quote or line break (RFC 4180) | Arabic names open correctly in Excel; any CSV reader takes it |
| Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="maqady-<dataset>-<today's cinema date>.csv"`, `Cache-Control: private, no-store` | A download that no cache keeps: it holds personal data |
| **Audited** as `export.downloaded`, entity `export` (no id), metadata `dataset` and the filters given, written in its own short transaction once the request is valid and before the first byte. A search text is recorded only as `search: true`, never the text | Design §13.4: "Each export writes an audit event in its own short transaction, because exports contain personal data"; design §13.5: audit rows never hold personal data, and a search text can be a name, email or phone. Recording before streaming means an interrupted download is still on record |
| A request that is invalid (`VALIDATION_FAILED`, the overview's `NOT_FOUND` theater) answers the usual JSON error and records nothing. A failure after the first byte (the database lost mid-file) destroys the connection, so the client sees a failed download, never a short file that looks complete; it is logged by code only. A client that disconnects stops the reading at the next batch | An HTTP status cannot change once the body has started |
| The Overview CSV is the `GET /admin/overview` response of the same query, one row per figure: columns Section, Cinema date, Subject ID, Subject, Metric, Unit, Value, Previous, Change. Sections: `period`, `kpis`, `by_theater`, `by_hall` (one theater only), `payment_methods`, `top_movies`, `heatmap`, `revenue_trend` (all theaters, then each), `tonight` | "Export CSV of the current view" (PRD A1): every card, table and chart of the screen, in one table a spreadsheet can pivot |
| `GET /admin/activity`: every `audit_events` row, newest first (`occurred_at DESC, id DESC`), cursor-paged with `total` under the same filters | The Activity log (PRD "Activity log", design §13.5); newest first like every admin log. Served by `idx_audit_events_occurred_at` and, filtered, `idx_audit_events_actor_staff_user_id`, `idx_audit_events_entity_type` and `idx_audit_events_entity_type_entity_id_occurred_at` (U1, U12) |
| Activity filters: `staffUserId` (a staff member's own actions), `actorKind` (`staff`, `customer`, `system`), `entityType` (a lower-case name such as `booking`, `payment`, `movie`, `export`), `entityId` (with `entityType` only), `action` (`noun.verb`), `dateFrom` / `dateTo` (cinema dates of `occurredAt`, inclusive; `dateTo` not before `dateFrom`) | PRD: "filterable by staff member, item type and date"; design §13.5. `entityId` is "one item's activity", the query U12's index comment names |
| An event shows `id`, `occurredAt`, `cinemaDate`, `action`, `actor { kind, staff { id, fullName } \| null, customerId }`, `entity { type, id }`, `booking { reference } \| null` (booking and payment events), `changedFields` and `metadata` | "time, staff member, action and item" (PRD). Audit rows never hold personal data (design §13.5: field names, never values; metadata checked by `AuditService`), so all of it may be shown; a customer actor is an id, never a name. The booking reference lets the screen open the booking |
| Module `activity` has its own `ActivityRepository` reading `audit_events` left-joined to `bookings` (the reference) in one query per page; staff names come from `StaffService.findByIds()` (one query per page) | The `analytics` and `search` deviation (design §5): a read-only module reads in its own queries and writes nothing. No N+1 |

## Modules and files

`src/modules/exports/`

- `exports.module.ts`: imports `BookingsModule`, `AdminCustomersModule`, `AnalyticsModule`;
  provides `ExportOptions`, `ExportsService`; controller `ExportsController`.
- `exports.controller.ts`: the four routes; returns a `StreamableFile` whose stream is destroyed
  when the client goes away.
- `exports.service.ts`: per dataset, validates (through the list service), records the audit
  event in its own transaction, and builds the CSV stream.
- `export-columns.ts`: the columns of each file, from the list's response DTO.
- `overview-rows.ts`: the Overview response as one row per figure.
- `csv.ts`: `escapeCsvCell()`, `csvCellOf()`, `csvStream()`, `decimalOf()`.
- `export-options.ts`: `ExportOptions { batchSize: 500 }` (an injectable, so a test can read
  in batches of 2 with real wiring).
- `exports.constants.ts`, `enums.ts` (`EXPORT_DATASETS`), `types.ts`.
- `dto/export-bookings.query.ts`, `dto/export-customers.query.ts`,
  `dto/export-payments.query.ts` (the overview takes `AdminOverviewQuery` unchanged).

`src/modules/activity/`

- `activity.module.ts`: imports `StaffModule`.
- `activity.controller.ts`: `GET /admin/activity`.
- `activity.service.ts`: validation of the date range and cursor, the page, the total, the staff
  names.
- `activity.repository.ts`, `activity.sql.ts` (the filter conditions), `activity-response.mapper.ts`,
  `activity.constants.ts`, `types.ts`.
- `dto/activity.query.ts`, `dto/activity-event.response.ts`.

Additive elsewhere: see Scope. `AppModule` imports both modules.

## Migrations

None. `audit_events` already has the indexes the Activity log reads (U1:
`idx_audit_events_occurred_at (occurred_at DESC, id DESC)`,
`idx_audit_events_actor_staff_user_id (actor_staff_user_id, occurred_at DESC)`,
`idx_audit_events_entity_type (entity_type, occurred_at DESC)`; U12:
`idx_audit_events_entity_type_entity_id_occurred_at`), each commented with the Activity log query,
and every export reads through its list's existing indexes. The `0200` prefix stays free.

## Endpoints

Every route: `@Admin()`; a GET, so not strict and never stored for replay. Errors common to every
admin route (documented by the cross-cutting docs): `UNAUTHENTICATED`, `SESSION_EXPIRED`,
`SESSION_REVOKED`, `ACCOUNT_DEACTIVATED`, `FORBIDDEN` (box office), `RATE_LIMITED`, `INTERNAL`.

### `GET /admin/exports/overview.csv`

- Query: `AdminOverviewQuery` (`period` `today|7d|30d`, or `dateFrom` / `dateTo`; `theaterId`).
- `200 text/csv`: the rows of `GET /admin/overview` for the same query (see Decisions).
- Errors: `VALIDATION_FAILED` (both a preset and dates, `dateTo` before `dateFrom`, over 366 days,
  a malformed value), `NOT_FOUND` (unknown `theaterId`), `SERVICE_UNAVAILABLE`.
- Audit metadata: `dataset: overview`, `period`, `dateFrom`, `dateTo`, `theaterId` as given.

### `GET /admin/exports/bookings.csv`

- Query: `ExportBookingsQuery` = `AdminBookingsQuery` without `cursor` and `limit`.
- Columns: Reference, Status, Payment status, Channel, Owner, Contact name, Contact email,
  Contact phone, Movie, Theater, Hall, Starts at, Cinema date, Seats, Seat count, Total,
  Currency, Payment method, Card brand, Card last 4, Wallet, Receipt reference, Created at,
  Confirmed at, Checked in at.
- Errors: `VALIDATION_FAILED` (as the list, `dateTo` before `dateFrom` included),
  `SERVICE_UNAVAILABLE`.
- Audit metadata: `dataset: bookings`, `search` (true when `q` was given), and `theaterId`,
  `movieId`, `status`, `channel`, `method`, `dateFrom`, `dateTo`, `customerId` as given.

### `GET /admin/exports/customers.csv`

- Query: `ExportCustomersQuery` = `AdminCustomersQuery` without `cursor` and `limit`.
- Columns: ID, Full name, Email, Phone, Status, Email verified, Email verified at, Joined at,
  Last sign-in at, Updated at, Bookings, Spent, Currency, No-shows, Last booking at.
  Anonymised customers are never in it (as the list).
- Errors: `VALIDATION_FAILED`, `SERVICE_UNAVAILABLE`.
- Audit metadata: `dataset: customers`, `search`, `status`.

### `GET /admin/exports/payments.csv`

- Query: `ExportPaymentsQuery` = `AdminPaymentsQuery` without `cursor` and `limit`.
- Columns: ID, Occurred at, Cinema date, Kind, Purpose, Method, Channel, Status, Failure reason,
  Ledger status, Amount (negative for a refund), Currency, Refund of payment, Refunded amount,
  Pending refund amount, Booking reference, Booking channel, Contact name, Theater ID, Theater,
  Card brand, Card last 4, Wallet, Receipt reference, Collected by, Paid out at, Paid out by,
  Created at, Completed at.
- Errors: `VALIDATION_FAILED`, `SERVICE_UNAVAILABLE`.
- Audit metadata: `dataset: payments`, and `kind`, `method`, `channel`, `status`, `theaterId`,
  `dateFrom`, `dateTo` as given.

### `GET /admin/activity`

- Query `ActivityQuery` (extends `PageQuery`): `staffUserId` (integer ≥ 1), `actorKind`
  (`staff|customer|system`), `entityType` (`^[a-z][a-z_]*$`, at most 32), `entityId` (integer
  ≥ 1, needs `entityType`), `action` (`noun.verb`, at most 64), `dateFrom`, `dateTo` (cinema
  dates), `cursor`, `limit` (1–100, default 20).
- `200 ActivityEventPageResponse { items: ActivityEventResponse[], nextCursor, total }`;
  `ActivityEventResponse { id, occurredAt, cinemaDate, action, actor: ActivityActorResponse
  { kind, staff: StaffRefResponse | null, customerId }, entity: ActivityEntityResponse { type,
  id }, booking: ActivityBookingResponse { reference } | null, changedFields: string[], metadata:
  object }`. `Cache-Control: private, no-store`.
- Errors: `VALIDATION_FAILED` (a malformed filter or cursor, `entityId` without `entityType`,
  `dateTo` before `dateFrom`), `SERVICE_UNAVAILABLE`.

## Exported services

- `ExportsService` (exports): `overview()`, `bookings()`, `customers()`, `payments()`, each
  answering an `ExportFile { filename, stream }` after recording the export.
- `ActivityService` (activity): `list(filter, page)`.
- `keysetBatches()` (common/pagination), and the `exportBatches()` / `transactionBatches()` /
  `rowsForAdmin()` methods above, for any later bulk read of a list.

## Tests

Unit (`test/unit/modules/exports/`, `test/unit/modules/activity/`,
`test/unit/common/pagination/`):

- `csv.test.ts`: every dangerous prefix (`=`, `+`, `-`, `@`, tab, carriage return) is prefixed
  with `'`; safe text, an inner `=` and numbers (a negative amount) are not; quoting of commas,
  quotes and line breaks; BOM, CRLF and the header row; the stream reads its source lazily, one
  batch ahead of the consumer at most (a source of 10,000 batches is pulled a few times when the
  consumer reads one chunk); a source error destroys the stream with it.
- `export-columns.test.ts`: each file's columns from a response DTO (money as decimals, nulls,
  booleans, seats).
- `overview-rows.test.ts`: every section of an Overview response.
- `exports.service.test.ts`: the audit event per dataset (metadata, `search: true` and never the
  text), recorded before the stream and not at all when the list refuses the filters.
- `keyset-batches.test.ts`: batches by keyset, the last short batch, an empty list.
- `activity.sql.test.ts`, `activity.service.test.ts`: the filter conditions; date range,
  `entityId` without `entityType`, the cursor; staff names in one read; no actor name for a
  customer.
- DTO tests of `ActivityQuery` and the export queries (refused `cursor` / `limit`).

Integration (`test/integration/modules/exports/`, `test/integration/modules/activity/`), real
app and Postgres, only Resend replaced:

- Each list export equals its list route, walked through every page, row for row and in order,
  unfiltered and under each filter (bookings: `q`, `status`, `channel`, `method`, `theaterId`,
  dates; customers: `q`, `status`; payments: `kind`, `status`, `method`, dates), read in batches
  of 2 (`ExportOptions` override) so several batches join up; the repositories' page queries are
  observed to run once per batch.
- The overview export equals `GET /admin/overview` of the same query, figure for figure.
- A customer named `=HYPERLINK(...)`, `+…`, `-…`, `@…`, `\t…` and `\r…` comes out prefixed in
  the bookings and customers files.
- Each export writes one `export.downloaded` row with its filters and no personal data; an
  invalid export answers JSON `VALIDATION_FAILED` and writes none.
- Every export route and `GET /admin/activity` refuse a box-office token (`FORBIDDEN`) and a
  customer token (`UNAUTHENTICATED`); the app-wide "every Admin route" suite covers them too.
- The Activity log lists real events newest first across pages, with `total`, and filters by
  staff member, actor kind, entity type, entity id, action and cinema dates; staff names shown,
  booking references for booking and payment events; no customer name, email or phone anywhere
  in the response after real bookings.

## Acceptance

- Gates pass (typecheck, lint, tests with a nonzero pass count and no failures or skips, build,
  contract current and committed).
- Each export matches its list route's rows and filters; formula escaping holds on every
  dangerous prefix; large exports stream in bounded batches; the Activity log lists events in
  order with its filters; box-office tokens are refused on every Admin route.
