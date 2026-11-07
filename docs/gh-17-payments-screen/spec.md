---
title: U16 — Payments screen - transactions, status mapping, KPIs, reconciliation
owner: Mohamed Tarek
status: Built
last_verified: 2026-10-29
tags: [admin, payments, transactions, kpis, reconciliation, analytics, settlement, cinema-day]
---

# U16 — Payments screen: transactions, status mapping, KPIs, reconciliation

Issue: #17. Docs folder: `docs/gh-17-payments-screen/`. Migration prefix `0170`. Depends on U14
(`PaymentsService` ledger, refunds per charge, payouts, `POST /admin/refunds/{id}/payouts`,
`idx_payments_completed_at`, `test/support/admin-bookings.ts`) and, through it, U13 (counter
charges), U11 (`SettlementService.settleAllDue()`, `PaymentProvider.retrieve()`) and U1. Design:
`docs/system-design.md` §5, §6, §7.5, §7.7, §11 (admin payments routes), §13.3, §14, §21; PRD v2
A8 "Payments", "Statuses" (Payments screen transactions), "Dashboard numbers" (Collected).

## Goal

Admins see every money movement in one table: each charge (online sales, counter sales, the higher
total of an edit) and each refund (online, and counter refunds waiting to be paid out), with the
status the PRD names (Succeeded, Pending, Failed, Refunded), filtered by method, status, theater
and cinema dates. Above the table, the KPIs of a period on the money-moved basis (collected online,
collected at the counters, refunds and their share, failed today, plus totals by channel and
method), and the reconciliation: what each theater took online, in cash and by card terminal, what
it gave back and its net; what the payment provider says about the online charges against what the
ledger says; and every record that does not add up.

## Scope

- Migration `0170_01_add_payments_screen_indexes`.
- `GET /admin/payments` (transactions) and `GET /admin/payments/summary` (KPIs and
  reconciliation), Admin only.
- A new read-only module `analytics` (design §5 lists it; §13.3 puts every number of the Overview,
  Payments and bell there): `AnalyticsModule`, `AdminPaymentsController`, `PaymentsReportService`,
  `PaymentsReportRepository`, `transaction-status.sql.ts` (the one owner of the shown statuses).
- Swagger tag `Admin: payments`; contract regenerated.

## Out of scope

- "Mark refund paid out" and "open the booking" from the drawer: the payout route
  (`POST /admin/refunds/{id}/payouts`) and the booking detail (`GET /admin/bookings/{ref}`) are
  U14's. Each transaction carries the refund id, the booking reference and `actions.markPaidOut`.
- The payments CSV export (U19): it reuses `PaymentsReportService.transactions()`'s filter.
- The Overview's revenue by showtime date, its comparisons and the bell (U17).
- Refunds at the provider: `PaymentProvider` has no refund lookup, so the provider check covers
  online charges; online refunds are checked for their provider reference (Follow-ups).

## Decisions taken here

| Decision | Why |
|---|---|
| **One row per `payments` row** (charges and refunds, every purpose and rail). A counter sale is a `cash` or `card_terminal` charge; a counter refund waiting at the counter is a `pending` refund, and its payout turns it `succeeded` with `paidOutAt` and `paidOutBy` (no separate payout row) | PRD A8 "one row per payment or refund"; design §7.7 (a payout moves the refund to `succeeded`). |
| **Shown status** (`transactionStatusOf()` in code, `transactionStatusPredicate()` in SQL, one file): charge `processing` → `pending`; charge `succeeded` → `succeeded`, or `refunded` once its *succeeded* refunds reach its amount; charge `declined` → `failed` with `failureReason: declined`; charge `cancelled` (a closed wallet) → `failed` with `failureReason: cancelled`; refund `pending` → `pending`; refund `succeeded` → `succeeded`. A charge with a counter refund still pending stays `succeeded` until the payout (its `pendingRefundAmount` says so), because no money has gone back yet | Design §13.3 status table; PRD "Payments screen transactions". |
| **Signed amounts**: a refund's `amount` is negative (money going back), a charge's positive; the KPIs and reconciliation carry positive refund totals beside the gross | Design §13.3 "Succeeded, with a negative amount". |
| **A transaction's moment** is `occurredAt = COALESCE(completed_at, created_at)`: when the money moved (a charge's final result, an online refund, a counter refund's payout), or, while nothing has moved yet (processing, pending), when the row was written. The list is newest `occurredAt` first (then id), cursor-paginated on (`occurredAt`, id), and `dateFrom` / `dateTo` are cinema dates of `occurredAt` (06:00 to 06:00 Cairo time, inclusive) | PRD "Collected … counted on the day the money moved"; with the same day rule, a period's list holds exactly the rows its KPIs count. A row moves up once when it completes (a payout days later); a page read across that instant can show it twice or skip it, as any list of changing rows. |
| **Filters** (all optional, ANDed): `kind`, `method`, `channel` (`online` = card or wallet, `counter` = cash or card terminal), `status` (the shown status), `theaterId` (the booking's showtime's theater), `dateFrom`, `dateTo`. One query for the page, one for the total, one for the staff names: no N+1 | PRD A8 "Filters by method, status and date range". |
| **Period** of the summary: `dateFrom` / `dateTo` cinema dates, inclusive; both omitted is the last 7 cinema days (today and the 6 before); `dateTo` alone starts 6 days before it; `dateFrom` alone ends today. At most 366 days, `dateFrom` not after `dateTo` (`VALIDATION_FAILED`) | PRD A8 "Period picker (default last 7 days)"; design §8 (the cinema day is the system's day). |
| **KPIs on the money-moved basis** by `completed_at` in the period: `gross` = succeeded charges, `refunds` = succeeded refunds (a counter refund once paid out), `net` = gross − refunds (the PRD's Collected), with counts, overall, by channel and by method. `refundRate` = refunds ÷ gross of the same period, 4 decimals, null when nothing was taken. The four PRD cards are `kpis`: `collectedOnline` (online net), `collectedAtCounters` (counter net), `refunds` with `refundRate`, `failedToday` (charges declined or cancelled on today's cinema day, whatever the period). `failed` gives the period's failed charges, declined and cancelled apart | PRD A8 KPIs; "Dashboard numbers" Collected; design §13.3 "Refunds KPI … refunds ÷ money collected in the same period" (money collected read as money taken in, so the share never divides by a net that refunds shrank). |
| **Reconciliation by theater**: for each theater with money moved in the period (the booking's showtime's theater), `online` (card and wallet charges), `cash`, `cardTerminal`, `refunds`, `net`, sorted by theater name, with their `totals`, which equal the KPI totals. The theater is the booking's current showtime's, so an edit that moved a booking to another theater moves its earlier money with it | PRD A8 "Reconciliation by theater: Online, Cash, Terminal, Refunds, Net". |
| **Provider check**: every online charge final in the ledger (`succeeded`, `declined`, `cancelled`) with `completed_at` in the period is retrieved from the payment provider (`PaymentProvider.retrieve()`). `provider.ledgerSucceeded` is the sum of the ones the ledger has as succeeded, `provider.providerSucceeded` of the ones the provider reports succeeded; `matched` when every status agrees. A disagreeing status is a `provider_status` mismatch; a reference the provider does not know is `provider_unknown`; a final online charge or a succeeded online refund with no provider reference is `missing_provider_reference`. A provider outage (`SERVICE_UNAVAILABLE`) fails the request instead of listing mismatches | The design's `PaymentProvider` (§7.5) is the provider's side; processing charges are settlement's job and are settled first. |
| **Ledger checks** over the bookings touched in the period (a payment with `occurredAt` in it, or `confirmed_at` or `refunded_at` in it): `booking_balance` when succeeded charges minus refunds (pending ones included: they are owed) differ from what the booking should hold, its `total_amount` while `confirmed` and 0 while `held` or `refunded`; `over_refunded` when the refunds naming a charge exceed its amount. Each check reads at most 101 rows; the response lists at most 100 mismatches with `truncated` | A confirmed booking with no charge, money kept on a refunded booking, a held booking with a succeeded charge and a lost edit difference all show as a balance that does not add up. |
| **Settled first**: both routes call `SettlementService.settleAllDue()` in its own short transaction before reading, so nothing shows a stale Pending and the provider check never compares a due charge | Design §7.5 "in a batch before … the Payments screen". |
| **Read-only module with its own SQL**: `analytics` reads `payments`, `bookings`, `showtimes`, `theaters` and `staff_users` names in its own queries (joins and aggregates), which a service call cannot give in one query; it writes nothing | Design §5: `search`, `analytics`, `exports`, `activity` are "read-only queries" over "the modules they read". |

## Modules and files

| File | What |
|---|---|
| `src/migrations/0170_01_add_payments_screen_indexes.ts` | The list's `occurredAt` index and the reconciliation's `confirmed_at` index; in `migration-list.ts` |
| `src/modules/analytics/analytics.module.ts` | Imports `BookingsModule` (settlement), `PaymentsModule` (the provider) and `StaffModule` (names); exports `PaymentsReportService` |
| `src/modules/analytics/admin-payments.controller.ts` | `GET /admin/payments`, `GET /admin/payments/summary` |
| `src/modules/analytics/payments-report.service.ts` | The transactions page, the KPIs, the reconciliation |
| `src/modules/analytics/payments-report.repository.ts` | The page, the count, the period aggregates by theater, the online charges to check, the two ledger checks |
| `src/modules/analytics/transaction-status.sql.ts` | `transactionStatusOf()`, `failureReasonOf()`, `transactionStatusPredicate()`, `channelOfMethod()` |
| `src/modules/analytics/transactions.sql.ts` | `transactionConditions()`: the list's filters as bound SQL |
| `src/modules/analytics/payments-report.ts` | Pure folds: totals by method and channel, theater rows, refund rate |
| `src/modules/analytics/payments-report-response.mapper.ts` | Response DTOs |
| `src/modules/analytics/dto/*.ts` | `AdminPaymentsQuery`, `AdminPaymentsSummaryQuery`, `AdminTransaction` (and its page), `AdminPaymentsSummary` with its parts |
| `src/modules/analytics/types.ts`, `enums.ts`, `analytics.constants.ts` | Types, enums, limits |
| `src/app.module.ts` | Imports `AnalyticsModule` |
| `src/common/swagger/swagger.constants.ts` | The `Admin: payments` tag |

## Migration (prefix `0170`)

- `0170_01_add_payments_screen_indexes`:
  - `idx_payments_occurred_at ON payments ((COALESCE(completed_at, created_at)), id)`: the list's
    order, keyset and cinema-date range, and the ledger check's touched bookings.
  - `idx_bookings_confirmed_at ON bookings (confirmed_at) WHERE confirmed_at IS NOT NULL`: the
    bookings confirmed in a period (the ledger check).

  Indexes only, so the previous release runs beside them (design §6.1). The KPIs and the provider
  check use U14's `idx_payments_completed_at`; the refunded bookings U14's `idx_bookings_refunded_at`;
  a charge's refunds U11's `idx_payments_refund_of_payment_id`.

## Endpoints

All under `/api/v1`, Admin only (`@Admin()`), JSON in camelCase, times in Cairo ISO, money
`{ amount, currency }` in piastres. Neither is a write, so neither takes an `Idempotency-Key`. Both
also answer `401` (`UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED`; a customer token is
`UNAUTHENTICATED`), `403 FORBIDDEN` (a box office token), `403 ACCOUNT_DEACTIVATED`,
`429 RATE_LIMITED`, `500 INTERNAL`, `503 SERVICE_UNAVAILABLE`.

| Route | Access | S | Success | Request | Errors |
|---|---|---|---|---|---|
| `GET /admin/payments` | Admin | | `200 AdminTransactionPage` | `kind`, `method`, `channel`, `status`, `theaterId`, `dateFrom`, `dateTo`, `cursor`, `limit` | `400 VALIDATION_FAILED` (a bad filter, cursor, limit, `dateTo` before `dateFrom`) |
| `GET /admin/payments/summary` | Admin | | `200 AdminPaymentsSummary` | `dateFrom`, `dateTo` | `400 VALIDATION_FAILED` (a bad date, `dateTo` before `dateFrom`, over 366 days) |

`AdminTransaction`: `id`, `kind` (`charge`, `refund`), `purpose`, `method`, `channel` (`online`,
`counter`), `status` (`succeeded`, `pending`, `failed`, `refunded`), `failureReason` (`declined`,
`cancelled`, null), `ledgerStatus` (the stored status), `amount` (signed), `refundOfPaymentId`,
`refundedAmount` and `pendingRefundAmount` (a charge's succeeded and pending refunds; null for a
refund), `booking { reference, channel, contactName }`, `theater { id, name }`, `card`,
`walletType`, `receiptReference`, `collectedBy`, `paidOutAt`,
`paidOutBy`, `createdAt`, `completedAt`, `occurredAt`, `cinemaDate` (of `occurredAt`),
`actions { markPaidOut }`.

`AdminPaymentsSummary`: `period { dateFrom, dateTo, from, to }`, `cinemaDate` (today),
`serverTime`, `kpis { collectedOnline, collectedAtCounters, refunds, refundRate, failedToday }`,
`totals` (`PaymentTotals { gross, chargeCount, refunds, refundCount, net }`), `byChannel`
(`online`, `counter`, each with `PaymentTotals`), `byMethod` (`card`, `wallet`, `cash`,
`card_terminal`, each with `PaymentTotals`), `failed { count, declinedCount, cancelledCount }`,
`reconciliation { byTheater [{ theater, online, cash, cardTerminal, refunds, net }], totals,
provider { checkedCount, ledgerSucceeded, providerSucceeded, matched }, mismatches [{ check,
bookingReference, paymentId, expectedAmount, actualAmount, ledgerStatus, providerStatus, message }],
truncated, consistent }`.

## Exported services (for U17, U19)

- `PaymentsReportService.transactions(filter, page)`: the transactions page; U19's payments CSV
  reuses its filter (`TransactionFilter`) and `transactionConditions()` in `transactions.sql.ts`.
- `PaymentsReportService.summary(period)` and `periodOf(query)`: the KPIs and the reconciliation of
  a cinema-date period; U17's Overview can read `summary().totals` for money moved.
- `transactionStatusOf()`, `transactionStatusPredicate()`, `channelOfMethod()` in
  `transaction-status.sql.ts`.

## Tests

- Unit (`test/unit/modules/analytics/…`, collaborators mocked):
  `transaction-status.sql.test.ts` (every payment state's shown status and reason, the SQL
  predicates), `transactions.sql.test.ts` (every filter bound, the cinema-day bounds), `payments-report.test.ts` (folds by method, channel and theater,
  refund rate rounding and null), `payments-report.service.test.ts` (settlement first, the default
  and explicit periods, refusals before any read, the provider check's statuses, unknown
  references, outages rethrown, missing references, mismatch truncation, the cursor check),
  `dto/admin-payments-requests.test.ts` (the query DTOs).
- Integration (`test/integration/…`, real app and Postgres; only Resend replaced):
  `modules/analytics/admin-payments.controller.test.ts` (each shown status from real flows: a
  succeeded sale, a slow sale pending then settled, a decline, a closed wallet, a fully refunded
  charge, a partial edit refund, a pending counter refund and its payout; every filter; paging with
  a fixed query count; KPIs over a seeded mix of sales, refunds and counter sales equal to
  hand-computed piastres; cinema-day edges at 05:59 and 06:00 Cairo time; the reconciliation by
  theater equal to the KPIs; a deliberately inconsistent record flagged by the balance check and by
  the provider check; box office and customer tokens refused),
  `modules/analytics/dto/admin-payments-contract.test.ts`, `migrations/0170_payments_screen.test.ts`.

## Acceptance

- [x] Status mapping is proven for every payment state (`processing`, `succeeded`, fully refunded,
  `declined`, `cancelled`, refund `pending`, refund `succeeded`).
- [x] KPIs over a seeded mix of online sales, refunds and counter sales match hand-computed totals
  in piastres.
- [x] Date ranges follow the cinema date (06:00 to 06:00 Cairo time).
- [x] Reconciliation flags a deliberately inconsistent record.
- [x] Box office tokens are refused on both routes.
- [x] Gates pass against the committed state; `contracts/openapi.yaml` is current.

## Follow-ups

- A real gateway would reconcile from its settlement report (one call per period) rather than one
  `retrieve()` per charge; the simulated provider is in process, so the per-charge check costs no
  network. `PaymentProvider` could gain a refund lookup so the provider check covers refunds too.
- Comparisons with the previous period (PRD "Comparisons") are an Overview rule today; the summary
  could add the previous period's totals if the Payments design asks for them.
