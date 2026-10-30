---
title: U19 — Review of the Exports and activity unit
owner: Mohamed Tarek
status: Passed — 2026-10-29, no open blocker or major findings
last_verified: 2026-10-29
tags: [review, admin, exports, csv, formula-escaping, streaming, activity-log, audit]
---

# U19 — Review of the Exports and activity unit

Issue #20, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range: `d38f0a7..cd37efc` on
`unit/gh-20-exports-activity`. Reviewed against:

- design §5, §11 (the export and activity routes), §13.4, §13.5, §14 and §21;
- PRD v2 A1 "Export CSV of the current view", A6, A7 "Export (Admin)", A8 "Export for
  accounting", "CSV exports", "Activity log" and the role table;
- the spec;
- the `CLAUDE.md` stack rules, anti-patterns and testing policy.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **A CSV export that failed after its first byte was never logged.** The spec says such a failure "destroys the connection … it is logged by code only". `ExportsController.download()` put the log line in `setErrorLogger()`. Nest's Express adapter hands a *stream* error to the `StreamableFile` error handler only, and wires the error logger to the response's own `error` event. The handler destroyed the connection and logged nothing. A failed download of personal data left no trace in the server log, which is the "silent catch" the anti-patterns forbid. The connection was cut correctly, so the client never kept a short file. | A new unit test, `test/unit/modules/exports/exports.controller.test.ts`. It runs the controller on real Express with the export service mocked, and serves a stream that fails after its first chunk. Before the fix, the client's download failed but `Logger.error` was called 0 times. A second case checks that a whole file is sent with its headers and nothing is logged. | Fixed in `f809162`. The error handler logs `{ err }` through the log-safe serializer, so a Postgres error keeps its SQLSTATE only, and then destroys the connection. A failed write to the client is logged as a warning. Both cases are green. |

No blocker or major finding was found. R1 is fixed, red before green. Every gate was re-run on
the final commit.

## Checked, with nothing to report

- **Access.**
  - The four export routes and `GET /admin/activity` are `@Admin()`. A box-office token gets
    `FORBIDDEN` and a customer token `UNAUTHENTICATED`. Both are tested per route, and the
    app-wide "every Admin route" suite enumerates the new routes from the Nest router.
  - The acting admin comes from `@CurrentPrincipal()`, never from the query.
- **Personal data.**
  - The `export.downloaded` metadata holds the dataset and the filters, with ids, enums and
    dates only. A search is recorded as `search: true` and never as its text. `AuditService`
    still refuses keys such as `name`, `email` and `phone`.
  - The Activity log shows a customer actor by id only. Changed fields are names only. Every
    metadata writer in `src/` records ids, counts, enums or amounts; edit `reason` is the
    `EditReason` enum. The integration test finds no customer name, email or phone in the
    response after real online and counter sales.
  - Request logs carry the route template, not the URL, so `q=` never reaches a log line.
- **Formula escaping.**
  - Every text cell is escaped, header cells included, when it starts with `=`, `+`, `-`, `@`,
    a tab or a carriage return. Numbers are never escaped, so a refund stays `-40`.
  - A lone `\n` or `\r` is quoted (`quoted_match`), as well as the CRLF that csv-stringify
    quotes by default.
  - Free text from staff is escaped too: theater and hall names, receipt references, staff names.
    A box-office member named `=Hany Adel` comes out prefixed.
- **Rows match the lists.**
  - Each list export takes its list's DTO through `OmitType(…, ['cursor', 'limit'])`. The
    contract shows the same filters without `cursor` and `limit`.
  - Each export pages with the list's own page query and keyset, `created_at, id` or
    `occurred_at, id`.
  - `created_at` is written from the `Clock` at millisecond precision, so the ISO sort key loses
    nothing between batches.
  - The bookings export fixes `now` once, as one page of the list does.
- **Streaming and transactions.**
  - Each batch is one short pooled query. No connection or statement is held while the client
    reads, so a slow client cannot hit the 10 s `statement_timeout` or tie up the pool of 5.
  - The audit row is written in its own `TransactionRepository.run()` after the first batch and
    before the response starts. A refused request (`VALIDATION_FAILED`, an unknown theater's
    `NOT_FOUND`) answers JSON and writes nothing.
  - A GET opens no request transaction, so nothing is stored for replay.
- **Cinema dates and summer time.** The Activity log's dates go through `cinemaDayBounds()`. A
  probe of the built code gave these bounds:
  - 2026-10-29, the day Egypt's summer time ends: `06:00+03:00` to `2026-10-30T06:00+02:00`.
  - 2026-04-23, the day before it starts: `06:00+02:00` to `2026-04-24T06:00+03:00`.

  The export file name uses `cinemaDateOf(now)`, so a download at 05:59 is still dated the day
  before, as the integration test checks.
- **Code rules.**
  - No inline types outside `types.ts`, and DTOs are in `dto/`.
  - No plain `Error` or `HttpException` from a service.
  - No `SELECT *`: the Activity repository names its columns.
  - No N+1: the staff names and booking references are one query per page or batch.
  - No migration: the indexes the Activity log reads already exist (U1, U12).
- **Contract.** The 200 responses are `text/csv` and the errors stay `application/json`.
  `Content-Disposition` is already in `CORS_EXPOSED_HEADERS`, so the browser can read the file
  name.

## Observation for the owner (not a finding)

The payments export orders rows by `COALESCE(completed_at, created_at)`, the same key as
`GET /admin/payments`. A pending row that completes while a download is in progress moves to a
newer position. If the export has already passed that position, the row is left out of that file.
The paged list has the same behaviour between pages. The spec accepts this: rows written while a
file downloads "may or may not be in it, as with paging". A file that must be complete for
accounting can be downloaded again once nothing is pending, or read in a snapshot (a `REPEATABLE
READ` transaction would hold one connection for the whole download, which §13.4 rejects).
