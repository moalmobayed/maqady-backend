---
title: U14 — Admin bookings - list, summary, detail, notes, cancel and refund, payouts, edits, showtime cancellation
owner: Mohamed Tarek
status: Built
last_verified: 2026-10-29
tags: [admin, bookings, search, summary, notes, refunds, payouts, edits, showtime-cancellation, lock-order, payments, messaging, audit]
---

# U14 — Admin bookings: list, summary, detail, notes, cancel and refund, payouts, edits, showtime cancellation

Issue: #15. Docs folder: `docs/gh-15-admin-bookings/`. Migration prefix `0150`. Depends on U13
(`CounterSalesService`, `PaymentsService.recordCounterCharge()`, `BookingReadService.getForStaff()`,
`test/support/box-office.ts`) and, through it, U12 (`BookingViews.ofMany()`,
`BookingHistoryService`, `TICKETS_RESENT_ACTION`), U11 (`SettlementService`, `@SettleFirst()`,
`PaymentsService`, `PaymentProvider`, `TicketsService`, `BookingConfirmationService`), U10 (the claim
statement, `SeatClaimService`, `booking-status.sql.ts`), U7 (`ShowtimeCancellationService`,
`ShowtimeReadService`), U3 (`MessagingService`), U2a (`StaffService`) and U1. Design:
`docs/system-design.md` §5, §6, §7.1, §7.4, §7.7, §7.8, §11 (admin booking routes), §13.1, §14, §21;
PRD v2 A5 "Cancel shows its impact", A6, "Cancellations, refunds and edits", "Email and SMS",
"Statuses", "Dashboard numbers" (Collected), call 13.

## Goal

Staff find any booking by reference, name, email or phone, filter the list, and read the four
summary cards. A booking's detail shows its seat lines, every payment and refund, the activity
log and the customer card; staff add internal notes, which no customer ever sees, and resend the
tickets. Admins cancel and refund a booking (always in full, each charge on its own rail), record
counter refunds as paid out, edit a booking's showtime, seats or contact with a preview of the new
total, and cancel a whole showtime, which refunds every booking on it and tells every ticket
holder. Every money movement happens exactly once, under the claim lock order, even when retried
or raced.

## Scope

- Migrations `0150_01_create_booking_notes`, `0150_02_add_admin_booking_indexes`.
- `GET /admin/bookings`, `GET /admin/bookings/summary`, `GET /admin/bookings/{ref}`,
  `GET /admin/bookings/{ref}/notes` (a route the design's table lacked; added there),
  `POST /admin/bookings/{ref}/notes`,
  `POST /admin/bookings/{ref}/ticket-deliveries` (Staff).
- `POST /admin/bookings/{ref}/refunds`, `POST /admin/refunds/{id}/payouts`,
  `POST /admin/bookings/{ref}/edit-previews`, `POST /admin/bookings/{ref}/edits`,
  `GET /admin/showtimes/{id}/cancellation-preview` (Admin).
- The real showtime cancellation (`BookingsShowtimeCancellation`) behind U7's
  `ShowtimeCancellationService`, bound in `showtimes.module.ts` in place of
  `NoBookingsShowtimeCancellation`.
- Templates `booking.refunded` (email), `showtime.cancelled` (email) and
  `showtime.cancelled_sms` (SMS).
- Error codes `BOOKING_NOT_REFUNDABLE`, `REFUND_NOT_PENDING`, `NO_CONTACT_DETAILS`.
- Additive: `PaymentsService` ledger, refunds per charge on both rails, payouts and the summary
  totals; `StaffService.findByIds()`; `AuditReadService.bookingActivity()`.
- Swagger tag `Admin: bookings`; contract regenerated.

## Out of scope

- The Payments screen (`GET /admin/payments`, its KPIs and reconciliation, U16): the payout route
  is here, its screen is not.
- Customers list, detail, anonymisation (U15: anonymisation deletes the notes this unit stores).
- Search across entities (U18), CSV exports and the Activity log API (U19).
- A customer-side cancel: PRD "Cancellations" 1 (customers never cancel).
- The SQL form of the payment status (U16): the list filters by payment `method`, not by
  payment status.

## Decisions taken here

| Decision | Why |
|---|---|
| **Search** `q` (2–100 characters, trimmed): a reference (`MQ-XXXXXX`, any case) matches exactly; anything else is a case-insensitive substring of the booking's contact name, email or phone (`ILIKE`, `%`, `_` and `\` escaped), served by trigram GIN indexes. The contact is the customer's name, email and phone copied onto the booking when they own it (U10, U13), so a customer's bookings are found by their details without reading another module's table | PRD A6 "Search by reference, name, email or phone"; design §5 (no other module's table), §13.2 (trigram GIN on booking contact fields). |
| **Filters**: `theaterId`, `movieId` (the showtime's), `status` (any of the six shown statuses, decided in SQL by `bookingStatusPredicate()`), `channel`, `method` (a sale charge of that method exists), `dateFrom`/`dateTo` (cinema dates, inclusive: the booking was made from 06:00 on `dateFrom` to 06:00 after `dateTo`, Cairo time). Newest first (`created_at DESC, id DESC`), cursor-paginated, `total` with the same filters; one query for the page, one for the total, then `BookingViews.ofMany()` (a fixed number of queries) | PRD A6 filters; the Today card filters the list to today. A cinema day is the system's day (design §8). |
| Lists, the summary and the detail settle every due payment first (`SettlementService.settleAllDue()`, its own short transaction) | Design §7.5 "in a batch before admin lists". |
| **The four cards**, for the cinema day containing now and the 7 days before now: `todayBookings` (bookings made today that were paid: stored `confirmed` or `refunded`), `collectedToday` (succeeded charges minus succeeded refunds whose money moved today, `completed_at`; a counter refund counts once paid out), `failedPaymentsToday` (declined charges completed today), `refundedLast7Days` (bookings refunded in the last 7 days and the cancellation refunds of those bookings) | PRD A6 "Today (bookings and amount collected), Failed payments today, Refunded in the last 7 days"; "Collected: money taken minus refunds paid out, counted on the day the money moved". |
| **Detail** (`AdminBooking`): every `Booking` field, plus the contact, the customer card (or null), who sold it at the counter, the check-in, every payment and refund with its id, rail, status, refundable remainder and payout, the refundable total, `actions` (`refund`, `edit`, `resendTickets`) and the activity log (the booking's audit events, oldest first, at most 100, with actor kind and staff name, action, changed field names and metadata) | PRD A6 "Detail: seat lines and total, payment details, refund details, activity log, internal notes and the customer card". Notes are their own paginated route. |
| **Notes**: 1–1,000 characters after trimming, stored with the author and time, listed newest first with the author's name. Staff only; no customer route reads `booking_notes`, and the notes' text never enters the audit log (`booking.note_added` carries no body) | PRD A6 "internal notes"; design §6.2 `booking_notes`; acceptance "notes are never shown to customers". |
| **Staff resend** (`POST /admin/bookings/{ref}/ticket-deliveries`, strict): under the booking lock, a booking with a ticket gets the tickets email at its contact email and the SMS at its contact phone; neither on file is `NO_CONTACT_DETAILS`; no ticket is `TICKET_NOT_AVAILABLE { status }`. Audited as `booking.tickets_resent { channels, by: 'staff' }`, so the customer's History shows "Tickets resent" | PRD "Email and SMS": "Tickets resent … SMS staff resend only, if a phone is on file". |
| **Cancel & refund** (Admin, strict, `@SettleFirst('booking')`): only a `confirmed` booking (its showtime not ended) is refunded, else `BOOKING_NOT_REFUNDABLE { status }`. Locks: the booking `FOR UPDATE`, then its claims in seat order (§7.1 steps 5–6; the showtime is not locked, so no edit or cancellation can form a cycle with it). Each succeeded charge is refunded for its remaining amount on its own rail: card and wallet through the provider (`succeeded`, key `<ref>-r<n>`), cash and card terminal as a `pending` refund to pay out at the counter. The booking becomes `refunded`, its claims are deleted (`seat.released` after commit), the refund email goes to the contact email | Design §7.7; PRD "Cancellations" 2–3. A retry with the same key replays; a second request (or a race) waits on the booking lock and is refused, so each charge is refunded once. |
| **Payout** (Admin, strict): the refund is found, its booking locked `FOR UPDATE`, then one conditional update `WHERE status = 'pending'` makes it `succeeded` with `completed_at`, `paid_out_at` and `paid_out_by_staff_id`. Unknown, or not a refund: `NOT_FOUND`; not pending: `REFUND_NOT_PENDING { status }`. Audited as `payment.paid_out` | Design §7.7 "Paying out a counter refund". Payments are written only under their booking's lock (U11). |
| **Edits** (Admin): `showtimeId` (the same movie, any theater), `seats` (1–8), `contact` (name, email, phone, each nullable), a required `reason` (`customer_request`, `seat_problem`, `showtime_changed`, `staff_error`), `notify`, and `payment` (`cash` or `card_terminal` with its receipt) exactly when the total goes up. Seats kept on the same showtime keep their sold price; every other seat takes the target showtime's current zone price. The preview (`edit-previews`, not strict, no locks, writes nothing) and the edit compute the same plan with one pure function (`planEdit()`), so the preview's total, difference and refund split are what the edit applies | Design §7.8; PRD "Cancellations, refunds and edits" 5–6; design inventory: the four reasons, "Email and SMS the customer new tickets". |
| **Editable**: shown status `confirmed`, not checked in, its showtime not started (`BOOKING_NOT_EDITABLE { reason: not_confirmed \| checked_in \| started, status }`); the target showtime bookable when the showtime or seats change (`SHOWTIME_NOT_BOOKABLE { reason }`); an edit that changes nothing, a `payment` with a total that does not go up, or none when it does, are `VALIDATION_FAILED` | PRD: Completed, Refunded, Failed and Abandoned can't be edited; the catalogue's `BOOKING_NOT_EDITABLE` already names checked-in and started bookings. |
| **Edit locks** (§7.8): both showtimes `FOR SHARE` in id order, the target hall `FOR SHARE`, the booking `FOR UPDATE`, then the current claims and the target seats' claim rows in (`showtime_id`, label) order. The current claims are deleted, the booking moved, `booking_seats` rebuilt, the new seats claimed sold with the §7.2 upsert (a missing one rolls everything back as `SEAT_TAKEN`). A booking that another edit moved between the read and the lock is `CONFLICT { reason: booking_changed }` | §7.1, §7.2, §7.8. |
| **Edit money**: a lower total is refunded across the succeeded charges newest first, each on its own rail, purpose `edit_difference` (a partial refund of a charge is allowed); a higher total is a counter charge (`edit_difference`, collected by the admin). `qr_version` goes up on every edit, so the old QR stops working; `notify` queues the new tickets (email and SMS). Audit `booking.edited` with the changed field names, the reason, both showtime ids and the signed difference, never a value of a contact field | §7.8 steps 6–7; PRD "Editing a booking issues a new QR code". |
| **Showtime cancellation**: `BookingsShowtimeCancellation` registers with showtimes' `RegisteredShowtimeCancellation` at boot (the registry pattern of `RegisteredTicketHolders`, U11), because bookings imports showtimes and showtimes cannot import bookings. In the PATCH's transaction, with the showtime already `FOR UPDATE`: the showtime's confirmed bookings and live holds `FOR UPDATE` in id order, their claims in seat order; every confirmed booking refunded as above (one multi-row insert for the refunds, one update, one claim delete), every live hold ended and its claims deleted, one `showtime.cancelled` email per booking with an email and one `showtime.cancelled_sms` per booking with a phone in one insert. A hold whose payment is still processing is ended too; when its charge settles, settlement refunds it at once because the showtime is cancelled (U11) | Design §5, §7.7; PRD "Cancellations" 4, "Email and SMS": "Showtime cancelled: cancellation and refund notice by email, cancellation notice by SMS, every ticket holder". |
| `GET /admin/showtimes/{id}/cancellation-preview` lives in bookings (it reads bookings and payments): bookings and seats affected, total refunded online, total owed back at the counter (each charge's remaining amount), live holds released, emails and SMS to send, and whether the showtime can still be cancelled | Design §7.7 "Cancellation preview"; PRD A5. |
| **Days**: "today" is the current cinema day (06:00 to 06:00 Cairo time) through `cinemaDayBounds()`; the 7 days are `now − 7 days` to `now` | Design §8: a cinema day is the system's day. |

## Modules and files

| File | What |
|---|---|
| `src/migrations/0150_01_create_booking_notes.ts`, `0150_02_add_admin_booking_indexes.ts` | The notes table; the list, search and summary indexes; both in `migration-list.ts` |
| `src/modules/bookings/admin-bookings.controller.ts` | List, summary, detail, notes, resend (Staff); cancel and refund, edit previews, edits (Admin) |
| `src/modules/bookings/admin-refunds.controller.ts`, `admin-showtime-cancellation.controller.ts` | Payouts; the cancellation preview (Admin) |
| `src/modules/bookings/staff-refs.service.ts` | Names the staff members the admin screens mention, in one query |
| `src/modules/bookings/admin-bookings.service.ts`, `admin-bookings.sql.ts` | The list, the summary and the detail; the filter SQL |
| `src/modules/bookings/booking-notes.repository.ts`, `booking-notes.service.ts` | `booking_notes` |
| `src/modules/bookings/booking-refunds.service.ts` | Cancel & refund, payouts and `refundLocked()`, shared with the showtime cancellation |
| `src/modules/bookings/booking-edits.service.ts`, `edit-plan.ts`, `refund-allocation.ts` | Edit preview and apply; the pure plan and the newest-first refund split |
| `src/modules/bookings/staff-ticket-delivery.service.ts` | The staff resend |
| `src/modules/bookings/bookings-showtime-cancellation.service.ts` | The real `ShowtimeCancellationService` and the cancellation preview |
| `src/modules/bookings/admin-booking-response.mapper.ts` | Response DTOs of the admin routes |
| `src/modules/bookings/templates/booking-refunded.template.ts`, `showtime-cancelled.template.ts`, `showtime-cancelled-sms.template.ts` | The three new messages, registered by `BookingTemplatesRegistrar` |
| `src/modules/bookings/dto/admin-*.ts`, `booking-note*.ts`, `edit-booking.request.ts`, `booking-edit*.response.ts`, `refund-id.params.ts`, `showtime-cancellation-preview.response.ts`, `staff-ticket-delivery.response.ts` | Request and response DTOs |
| `src/modules/bookings/bookings.repository.ts`, `types.ts`, `enums.ts`, `bookings.constants.ts`, `bookings.module.ts`, `booking-response.mapper.ts` | Additive |
| `src/modules/payments/payments.repository.ts`, `payments.service.ts`, `types.ts` | Ledger, refunds per charge on both rails, payouts, summary totals |
| `src/modules/staff/staff.repository.ts`, `staff.service.ts` | `findByIds()` |
| `src/common/audit/audit-read.repository.ts`, `audit-read.service.ts`, `types.ts` | `bookingActivity()` |
| `src/modules/showtimes/showtime-cancellation.service.ts`, `showtimes.module.ts` | `RegisteredShowtimeCancellation` bound in place of the no-bookings default |
| `src/common/errors/error-catalogue.ts`, `src/common/swagger/error-responses.ts`, `swagger.constants.ts` | The three codes, their examples, the tag |

## Migrations (prefix `0150`)

- `0150_01_create_booking_notes`: `booking_notes (id BIGSERIAL, booking_id BIGINT NOT NULL,
  staff_user_id BIGINT NOT NULL, body VARCHAR(1000) NOT NULL, created_at TIMESTAMPTZ NOT NULL)`,
  `fk_booking_notes_booking_id`, `fk_booking_notes_staff_user_id`, `chk_booking_notes_body`
  (`btrim(body) <> ''`); `idx_booking_notes_booking_id_created_at (booking_id, created_at, id)`
  (a booking's notes, newest first, and the FK), `idx_booking_notes_staff_user_id` (the FK);
  row-level security on.
- `0150_02_add_admin_booking_indexes`: `idx_bookings_created_at (created_at, id)` (the list's order,
  keyset and date range), `idx_bookings_contact_name_trgm`, `idx_bookings_contact_email_trgm`
  (`(contact_email::text) gin_trgm_ops`), `idx_bookings_contact_phone_trgm` (search),
  `idx_bookings_refunded_at` (partial, the 7-day card), `idx_payments_completed_at` (partial, the
  Collected and Failed cards; also U16's period KPIs).

Both are additive, so the previous release runs beside them (design §6.1).

## Endpoints

All under `/api/v1`, JSON in camelCase, times in Cairo ISO, money `{ amount, currency }`. Every
route also answers `401` (`UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED`; a customer
token is `UNAUTHENTICATED`), `403 ACCOUNT_DEACTIVATED`, `429 RATE_LIMITED` and `500`; every Admin
route answers `403 FORBIDDEN` to a box office token. Strict routes also answer
`400 IDEMPOTENCY_KEY_REQUIRED` and `422 IDEMPOTENCY_KEY_REUSED`.

| Route | Access | S | Success | Request | Errors |
|---|---|---|---|---|---|
| `GET /admin/bookings` | Staff | | `200 AdminBookingListItemPage` | `q`, `theaterId`, `movieId`, `status`, `channel`, `method`, `dateFrom`, `dateTo`, `cursor`, `limit` | `400 VALIDATION_FAILED` |
| `GET /admin/bookings/summary` | Staff | | `200 AdminBookingSummary` | — | — |
| `GET /admin/bookings/{ref}` | Staff | | `200 AdminBooking` | — | `400`; `404` |
| `GET /admin/bookings/{ref}/notes` | Staff | | `200 BookingNotePage` | `cursor`, `limit` | `400`; `404` |
| `POST /admin/bookings/{ref}/notes` | Staff | S | `201 BookingNote` | `{ body: 1–1000 chars }` | `400`; `404` |
| `POST /admin/bookings/{ref}/ticket-deliveries` | Staff | S | `201 StaffTicketDelivery { channels, queuedAt }` | — | `400`; `404`; `409 TICKET_NOT_AVAILABLE`, `NO_CONTACT_DETAILS` |
| `POST /admin/bookings/{ref}/refunds` | Admin | S | `201 BookingRefundResult { refunds, booking }` | — | `400`; `403`; `404`; `409 BOOKING_NOT_REFUNDABLE { status }` |
| `POST /admin/refunds/{id}/payouts` | Admin | S | `201 AdminPayment` (the refund) | — | `400`; `403`; `404`; `409 REFUND_NOT_PENDING { status }` |
| `POST /admin/bookings/{ref}/edit-previews` | Admin | | `200 BookingEditPreview` | `EditBooking` | `400`; `403`; `404`; `409 BOOKING_NOT_EDITABLE`, `SHOWTIME_NOT_BOOKABLE` |
| `POST /admin/bookings/{ref}/edits` | Admin | S | `201 BookingEditResult { booking, difference, payments }` | `EditBooking` | `400`; `403`; `404`; `409 BOOKING_NOT_EDITABLE`, `SHOWTIME_NOT_BOOKABLE`, `SEAT_TAKEN { seats }`, `CONFLICT` |
| `GET /admin/showtimes/{id}/cancellation-preview` | Admin | | `200 ShowtimeCancellationPreview` | — | `400`; `403`; `404` |

`EditBooking`: `{ showtimeId?: int ≥ 1, seats?: 1–8 distinct labels, contact?: { name?: string \|
null, email?: string \| null, phone?: string \| null }, reason: customer_request \| seat_problem \|
showtime_changed \| staff_error, notify?: boolean (default false), payment?: { method: cash \|
card_terminal, receiptReference?: string } }`.

`BookingEditPreview`: `current { showtime, seats, total }`, `proposed { showtime, seats (each with
its price and whether it is kept), total }`, `difference { direction: collect \| refund \| none,
amount }`, `refunds` (the planned split: payment id, method, amount), `changedFields`,
`unavailableSeats` (target seats someone else holds now).

`AdminPayment`: `id`, `kind` (`charge`, `refund`), `purpose`, `method`, `status`, `amount`,
`refundOfPaymentId`, `refundable` (a succeeded charge's remaining amount, else null),
`receiptReference`, `card`, `walletType`, `collectedBy`, `paidOutAt`, `paidOutBy`, `createdAt`,
`completedAt`.

## Exported services (for U15–U19)

- `BookingNotesService.deleteForCustomer(customerId)`: deletes the notes on a customer's bookings
  in the open transaction (U15's anonymisation, design §21).
- `BookingRefundsService.refundLocked(rows, context)`: refunds locked confirmed bookings in full,
  each charge on its rail (the showtime cancellation uses it); `payOut()` for the Payments
  screen's "Mark refund paid out" (U16).
- `AdminBookingsService.list(filter, page)`, `summary()`, `detail(ref)`, and
  `adminBookingConditions()` in `admin-bookings.sql.ts`: U19's bookings CSV can reuse the filter.
- `PaymentsService.ledgerOf(bookingIds)`, `findLedgerEntry(id)`, `refund(items, purpose)`,
  `markPaidOut(id, staffId)`, `moneyMovedBetween(range)`, `refundTotalOf(ids, purpose)`: the ledger
  and period totals U16's Payments screen and U17's analytics extend (`idx_payments_completed_at`).
- `StaffService.findByIds(ids)`, `AuditReadService.bookingActivity(bookingId, limit)`.
- `test/support/admin-bookings.ts`: `paidOnline()`, `listAdminBookings()`, `refundBooking()`,
  `payOutRefund()`, `previewEdit()`, `editBooking()`.

## Tests

- Unit (`test/unit/modules/…`, collaborators mocked): `bookings/edit-plan.test.ts` (kept and new
  prices, the difference, changed fields, refusals), `bookings/refund-allocation.test.ts`
  (newest first, partial, exact, too much), `bookings/admin-bookings.sql.test.ts` (references,
  substrings, wildcard escaping, the local mobile, every filter bound),
  `bookings/admin-bookings.service.test.ts` (settlement first, the cinema day and the 7 days, the
  actions), `bookings/booking-refunds.service.test.ts` (lock order, rails, refusals before any
  write, payouts), `bookings/booking-edits.service.test.ts` (lock order, two showtimes in id order,
  `SEAT_TAKEN`, `CONFLICT`, refusals, the counter payment, the preview writes nothing),
  `bookings/bookings-showtime-cancellation.service.test.ts`, `showtimes/showtime-cancellation.service.test.ts`
  (the registry), `bookings/staff-ticket-delivery.service.test.ts`,
  `bookings/booking-notes.service.test.ts`, `bookings/templates/admin-booking-templates.test.ts`,
  `bookings/dto/admin-booking-requests.test.ts`, and `payments/payments.service.test.ts` (refunds on
  both rails, payouts, money moved).
- Integration (`test/integration/…`, real app and Postgres; only Resend replaced):
  `bookings/admin-bookings.controller.test.ts` (the list, search and each filter, paging, a fixed
  query count per page, settlement first, the summary cards against seeded bookings, the detail,
  notes never on customer routes, the resend, box office refused on every Admin route),
  `bookings/booking-refunds.test.ts` (online and counter rails, payouts, each charge refunded once
  when retried or raced, every charge's remainder, the refusals, mid-show),
  `bookings/booking-edits.test.ts` (the preview equals the applied edit, a partial refund, a higher
  total collected, kept prices, a showtime move with new tickets, refusals, `SEAT_TAKEN` changing
  nothing, contact edits), `bookings/showtime-cancellation.test.ts` (the preview, every booking
  refunded, holds released, one notice per booking and channel, a slow payment refunded after the
  cancellation), `bookings/dto/admin-bookings-contract.test.ts`,
  `migrations/0150_admin_bookings.test.ts`. The showtime, my-bookings and staff suites now expect
  the new routes beside theirs (the staff suite sends a box office token to every Admin route).

## Acceptance

- [x] Search and each filter return exactly the matching bookings.
- [x] The summary cards match seeded bookings.
- [x] Cancel refunds each charge once even when retried or raced.
- [x] A partial refund (an edit lowering the total) refunds only the difference.
- [x] An edit preview matches the applied edit.
- [x] Cancelling a showtime with bookings refunds all of them and queues one message per booking
  and channel.
- [x] Notes are never shown to customers.
- [x] Box office tokens are refused on the Admin routes.
- [x] Gates pass against the committed state; `contracts/openapi.yaml` is current.

## Follow-ups

- U16: the Payments screen reads `PaymentsService.ledgerOf()` and adds the payment-status SQL.
- U19: the activity log should render `booking.edited`, `booking.note_added`,
  `booking.tickets_resent { by: staff }`, `payment.paid_out`.
- Known limit: an edit locks every existing claim row of its current and target seats in one
  ordered statement, but a target seat with no claim row yet is inserted by the upsert afterwards;
  a rival hold inserting that same new seat while waiting on a row the edit locked can deadlock
  with it. Postgres aborts one side and the write interceptor retries it once (design §7.1); the
  window is narrow (a new seat, raced at that instant). Not fixed here.
- A show-date filter on the bookings list (by the showtime's cinema date) if the box office asks for
  it; today the theater and movie filters narrow to a show.
