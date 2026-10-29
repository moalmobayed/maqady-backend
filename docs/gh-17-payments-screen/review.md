---
title: U16 — Review of the Payments screen unit
owner: Mohamed Tarek
status: Passed — 2026-10-29, no open blocker or major findings
last_verified: 2026-10-29
tags: [review, admin, payments, transactions, kpis, reconciliation, analytics, cinema-day]
---

# U16 — Review of the Payments screen unit

Issue #17, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`8ec7042..0120fe1` on `unit/gh-17-payments-screen`. Reviewed against design §5, §7.5, §7.7, §8,
§11 (the admin payments routes), §13.3 and §21, PRD v2 A8, "Payments screen transactions" and
"Dashboard numbers", the spec, and the `CLAUDE.md` stack rules, anti-patterns and testing policy.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **An inline type in a service file.** `mismatchOf()` in `payments-report.service.ts` took its `facts` as `Pick<ReconciliationMismatch, 'ledgerStatus' \| 'message'> & Partial<Pick<…, 'providerStatus'>>`. `CLAUDE.md` puts non-trivial types in the module's `types.ts`. U14's review (R2) treated the same pattern as a finding. | Read in the diff. A scan of every analytics service, controller, repository and mapper (`grep` for type literals, `Pick`, `Partial`, `Omit`, `Record`) found no other case. | Fixed in `4297a65`: `ProviderMismatchFacts` in `types.ts`. No behaviour change. Typecheck, lint and the 53 analytics unit tests stay green. |
| R2 | minor | **Design §13.3 said one thing and the code did another.** The "Grouping by day" bullet said Collected groups charges by `payments.created_at`. The U16 as-built note in the same section, U14's Collected card and the code all count a charge by `completed_at`. The two differ only for a slow payment that crosses 06:00 (created at 05:59:55, succeeded at 06:00:05). The code follows the PRD ("counted on the day the money moved"). | Read: `periodAggregates()` filters on `p.completed_at`, as does U14's `PaymentsRepository` card query. Design line 1349 said `created_at`. | Fixed in `2608624`: the bullet now names `completed_at`, with an as-built remark. Docs only. |
| R3 | minor | **The provider check has no upper bound.** For a period of up to 366 days, `onlineRowsCompletedBetween()` reads every final online charge and online refund into memory. `checkProvider()` then calls `PaymentProvider.retrieve()` once per charge, one after another. With the in-process simulated provider this costs no network. A real gateway would make one HTTP call per charge, which could exceed a serverless request limit for a long period. | Read: the query has no `LIMIT`, and the loop awaits each `retrieve()` in turn. The provider calls are not database queries, so the N+1 rule does not bind. | **Open, accepted.** The spec records it under Follow-ups: a real gateway would reconcile from one settlement report per period, and `PaymentProvider` would gain that call. v1 binds only the simulated provider (design §7.5). Not a correctness bug. |

No blocker or major finding was found. R1 and R2 are fixed. R3 stays open as a documented
follow-up.

R1 and R2 change no behaviour (a type name and a design sentence), so neither has a
red-before-green test, as with U14's R2. Every gate was re-run on the final commit.

## Checked, with nothing to report

- **Status mapping.** `transactionStatusOf()` and `transactionStatusPredicate()` live in one file
  and agree for every stored state:
  - `processing` and `pending` show as `pending`;
  - `declined` and `cancelled` show as `failed`, with their reason;
  - a `succeeded` charge shows as `refunded` once its succeeded refunds reach its amount (`>=` in
    both, so an over-refund also shows `refunded`), and as `succeeded` otherwise;
  - a refund is never `refunded`.

  The integration filter test would catch a `>` / `>=` slip, because the exactly-refunded online
  charge must come back for `status=refunded`.
- **Money.** The KPIs, `byChannel`, `byMethod` and `byTheater` are all folded from one aggregate
  query, so the theater totals cannot drift from the KPI totals. A probe ran the summary after a
  higher-total edit collected in cash, a showtime cancellation (an online refund and a pending
  cash refund) and the payout. It came back `consistent: true` with the theater totals equal to
  the KPIs. The balance check counts pending refunds as owed, and expects `total_amount` only
  while `confirmed`. A pending counter refund therefore balances its refunded booking, and a
  lower-total edit balances its confirmed one. Every SUM and COUNT is `int8`, which the shared
  type parsers turn into numbers.
- **Cinema days and summer time.** Every bound comes from `cinemaDayBounds()`. A check at the
  2026 transitions gives a 23-hour day on 23 April, a 25-hour day on 29 October (06:00 +03:00 to
  06:00 +02:00 on the 30th) and 24 hours either side. The list filter, the summary period and
  "Failed today" use the same helper. The 05:59 and 06:00 edges are proved against Postgres. No
  inline offset arithmetic was added.
- **Paging.** The keyset is `(COALESCE(completed_at, created_at), id)`, the same expression as
  `idx_payments_occurred_at`. Every timestamp is written from the `Clock` with millisecond
  precision and no `now()` default, so the cursor's `toISOString()` loses nothing. Ties at one
  instant page by id, proved with 11 rows in pages of 5. The count of queries does not depend on
  `limit`.
- **Security.** Both routes are `@Admin()`, behind the global guards. Box office tokens get
  `403 FORBIDDEN`, customer and missing tokens `401 UNAUTHENTICATED`, and the staff suite's
  every-Admin-route check covers both routes. `providerReference` is not published (the U11
  contract test). A card terminal's receipt is shown only on its charge. The new code writes no
  log lines and no audit rows. The mismatch messages name booking references and payment ids,
  never a contact.
- **Transactions and idempotency.** Both routes are reads, so no `Idempotency-Key` and no write
  interceptor. `settleAllDue()` runs in its own transaction after validation and before any read,
  so a bad filter settles nothing. A provider outage (`SERVICE_UNAVAILABLE`) fails the summary
  instead of listing false mismatches.
- **Database.** `0170_01` adds indexes only, each commented with its query path, and is in
  `migration-list.ts`. Every query names its columns (no `SELECT *`). The page is one query, with
  a lateral per-row refund sum inside it, plus one count and one staff-name batch, so there is no
  N+1.
- **Errors, validation and Swagger.** The service throws only `AppError`. The query DTOs use
  `@IsIn`, `@IsInt` and `@IsCinemaDate()` under the global `ValidationPipe`, and repeated or
  unknown parameters are refused. Both operations carry the `Admin: payments` tag, a description,
  the success schema, the error responses (400, 401, 403, 429, 500, 503) and bearer security, and
  the contract test checks every property is described.
- **Tests.** The integration suite proves:
  - every payment state from real flows;
  - each filter;
  - the KPIs against hand-computed piastres;
  - the cinema-day edges;
  - the deliberately inconsistent records;
  - the refusals.

  The unit suite covers the folds, the statuses and their SQL, the filter bindings across the
  clock change, the service's read order, the periods and the provider check.

## Gates on the final commit

Recorded in the commit that adds this file. Typecheck, lint, the full test suite, build, and
`npm run contract` followed by `git status` were each run fresh.
