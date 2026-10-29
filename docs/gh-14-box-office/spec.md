---
title: U13 — Box office - counter holds and sales, staff ticket download, ticket scanning
owner: Mohamed Tarek
status: Built
last_verified: 2026-10-29
tags: [box-office, counter-sales, counter-holds, payments, tickets, pdf, scanning, qr, check-in, lock-order, concurrency, audit]
---

# U13 — Box office: counter holds and sales, staff ticket download, ticket scanning

Issue: #14. Docs folder: `docs/gh-14-box-office/`. Migration prefix `0140`. Depends on U11
(`PaymentsService`, `BookingConfirmationService`, `TicketsService`, `QrCodeService`,
`SettleFirstInterceptor`, `test/support/checkout.ts`) and, through it, U10 (`HoldsService`, the
claim statement and lock order, `BookingReadService`, `booking-status.sql.ts`,
`test/support/holds.ts`), U9 (`CustomerService`), U7, U4b, U2a (`StaffService`, the staff test
helper) and U1. Design: `docs/system-design.md` §5, §6.2, §7.1, §7.3, §7.6, §7.9, §10.4, §10.6,
§11 (admin box-office and scan routes), §14 and §21; PRD v2 "Payments" 2, A6 "New booking",
"Scan tickets", "Tickets and QR codes", "Statuses", calls 4 and 14.

## Goal

Box office staff (and admins) sell tickets at the counter: they pick seats on the live map, which
holds them exactly like an online hold, so the website and the counter can never sell one seat
twice, then record cash or a card-terminal payment on the spot (with the terminal's receipt
reference) for a walk-in, an existing customer or typed contact details. The booking is confirmed
with its tickets in the same transaction. Staff download any booking's PDF ticket. At the
entrance, staff scan a QR code (or type a reference when the camera fails) and get one clear
verdict; a booking is checked in exactly once.

## Scope

- `POST /admin/counter-holds`, `DELETE /admin/counter-holds/{ref}`: counter holds (Staff).
- `POST /admin/bookings/{ref}/counter-payments`: counter sales paid on the spot (Staff).
- `GET /admin/bookings/{ref}/ticket.pdf`: the staff ticket download (Staff).
- `POST /admin/scans`: ticket scanning with typed-reference confirmation (Staff).
- Migrations `0140_01` (receipt reference CHECK) and `0140_02` (check-in CHECK).
- `PaymentsService.recordCounterCharge()`, `BookingReadService.getForStaff()`.
- Audit events for every staff write; the default rate limit.

## Out of scope

- The admin bookings list, summary cards, detail, notes, cancel and refund, payouts, edits and
  staff resend (U14). `recordCounterCharge({ purpose: 'edit_difference' })` is ready for U14's
  edits; U14 owns the refunds of counter charges.
- Showtime cancellation fan-out (U14): a booking on a cancelled showtime scans as
  `WRONG_SHOWTIME cancelled` today and stays `confirmed` until U14 refunds it.
- No-shows (U15) read `checked_in_at`; nothing here computes them.
- The Payments screen's counter KPIs (U16), the activity log API (U19).

## Decisions taken here

| Decision | Why |
|---|---|
| **A counter hold is U10's hold with a staff holder.** `HoldHolder` gains `{ kind: 'staff', staffUserId }`; `HoldsService.create()` runs every step of §7.3: settle the body's showtime first, showtime `FOR SHARE`, hall `FOR SHARE`, the member `FOR NO KEY UPDATE` (`StaffService.findByIdForUpdate()`, §7.1 step 4), the member's previous live counter hold `FOR UPDATE`, then the same claim statement. The row has `channel: counter`, `created_by_staff_id`, no customer, no contact, no hold code | §7.6 step 1 "through the same steps as §7.3". One claim statement is what makes a counter and an online hold race fairly: exactly one wins (proved concurrently). |
| A member has at most one live counter hold: a new one releases their previous live counter hold (`liveCounterHoldIdsOfStaff()`, through `idx_bookings_created_by_staff_id_status_hold_expires_at`), re-checked under the lock. Customers' holds, guests' holds and colleagues' counter holds are never touched | §7.6 "a staff member has at most one live counter hold", mirroring "one live hold per customer". |
| **Only the member who made a counter hold may sell or release it**, admins included. Another member's is `403 FORBIDDEN { reason: 'not_your_counter_hold' }`; an online booking or unknown reference is `404` | The member who picked the seats takes the money. Staff read every booking (§10.4), so hiding it behind `404` would only confuse; `FORBIDDEN` says why. |
| A deactivated member found under the lock is `ACCOUNT_DEACTIVATED`; a vanished one `UNAUTHENTICATED` | The guard checked the session at the start of the request; a deactivation that commits first must still win. |
| `@SettleFirst('showtime', 'body')`: the settlement scope can come from the raw JSON body's `showtimeId` (a positive safe integer, else nothing is settled and validation answers) | §7.3 step 1 for a route whose showtime is in the body; pipes have not run yet, as for path parameters. |
| **Counter payment refusals, in order**: `NOT_FOUND` (not a counter booking) → `FORBIDDEN` (a colleague's) → `ALREADY_PAID` (unlocked read) → showtime `FOR SHARE` and `SHOWTIME_NOT_BOOKABLE { reason }` → an `existing` customer `FOR UPDATE` (§7.1 step 4), refused as `VALIDATION_FAILED` on `customer.customerId` when unknown, anonymised or blocked → booking `FOR UPDATE`: `ALREADY_PAID`, `HOLD_EXPIRED` (also at exactly `hold_expires_at`) → claims `FOR UPDATE`: `HOLD_EXPIRED` unless all are the booking's and live. Every refusal writes nothing | §7.6 step 2 "the locks of §7.5 steps 2–4", in U11's order. No `PAYMENT_IN_PROGRESS`: a counter hold never has an online charge. |
| A counter payment is a `succeeded` charge at once (`purpose: sale`), `collected_by_staff_id` = the member, `completed_at` = now, no provider key, no provider call. The receipt reference of a `card_terminal` payment is stored in `provider_reference` (U11 already described that column so); cash stores none. Exposed as `Payment.receiptReference` (null otherwise) | PRD Payments 2 and "Statuses": counter payments are never Processing or Declined. The partial unique index still refuses a second live sale charge. |
| `receiptReference`: 1 to 64 characters, letters, digits, spaces and `. / _ -`, starting with a letter or digit, trimmed; required with `card_terminal`, refused with `cash`. `chk_payments_receipt_reference` repeats the rule | Terminals print short alphanumeric references; anything else is a typing mistake the screen should show. |
| **Who the sale is for** (`customer.kind`): `walk_in` writes no contact; `existing` makes the booking the customer's (`customer_id`) and copies their name, email and phone as its contact (so it shows in their My Bookings and they can download it); `contact` writes the typed name, optional email and phone with no account, never linked by email. A field of another kind is refused (`OnlyWhen`), so a mix-up is shown, not ignored | PRD A6 "customer (walk-in, existing or typed contact)". Linking by a typed email would hand a booking to whoever registered that address. |
| Confirmation is U11's `BookingConfirmationService.confirm()` in the same transaction: `confirmed`, claims permanent, `qr_version = 1`, the tickets email to any email and the SMS to any phone, `booking.confirmed { channel: 'counter' }`, `seat.booked` after commit | §7.6 "confirms in the same transaction", "tickets go to any email or phone given". |
| `BookingOwner` gains `staff`: a counter booking without a customer account | `guest` would wrongly suggest a hold code. Additive in the contract. |
| **Staff ticket download**: `TicketsService.ticketPdf(ref, { kind: 'staff' })` (U11's access already had it) for any booking with a ticket; each download writes `booking.ticket_downloaded { format: 'pdf' }` in a short transaction of its own | The PDF carries a working QR code, and a box office member can download any customer's ticket, so who did is worth a row. §14.1 is updated: this GET writes too. |
| **Scan verdict** (`scanVerdict()`, pure): the first rule that holds wins: another theater → `WRONG_SHOWTIME other_theater`; cancelled showtime → `WRONG_SHOWTIME cancelled`; a hold → `NOT_VALID not_paid`; refunded → `NOT_VALID refunded`; a QR version other than the booking's → `NOT_VALID replaced`; before `starts_at − 60 min` → `WRONG_SHOWTIME not_open_yet`; from `ends_at` → `WRONG_SHOWTIME ended`; already checked in → `ALREADY_USED`; a typed reference without `confirm: true` → `CONFIRM_REQUIRED`; otherwise admit | §7.9 and PRD "Scan tickets". `reason` lets the screen say which; refunded wins over the window so nobody is told to come back later with a refunded ticket. |
| Every ticket outcome is `200` with `{ result, reason, admits, checkedInAt, scannedAt, booking }`; `NOT_FOUND` (an unverifiable code or an unknown reference) carries no booking. Only an unknown `theaterId` is an error (`404`) | The scanner shows every result; a forged code is not an exception. |
| **Admission** is one conditional `UPDATE bookings SET checked_in_at, checked_in_by_staff_id WHERE id AND showtime_id = :judged AND status = 'confirmed' AND checked_in_at IS NULL [AND qr_version = :presented]`, after the showtime's `FOR SHARE` (§7.1 step 2 then 5). When it changes nothing (another scan, a refund or an edit committed first) the row is read again and its verdict answered; a booking an edit moved to another showtime meanwhile is judged again under that showtime's lock (review R2) | Two entrances scanning one ticket at once admit it once (proved concurrently); a move or cancellation cannot slip between the verdict and the admission. |
| A typed reference is case- and space-insensitive and needs no QR version; the first request shows the showtime, seats and contact name; the second with `confirm: true` admits. Exactly one of `code` and `reference`; `confirm` only with `reference` | §7.9 "the reference alone admits nobody". |
| `POST /admin/scans` is not strict (no `Idempotency-Key` needed), as §11 says: a repeat answers `ALREADY_USED` | Naturally idempotent. |
| `@SettleFirst('booking', 'body')` on `POST /admin/scans`: a typed `reference` (trimmed, upper-cased) has its due online payments settled before the scan (review R1) | §7.1 step 1: a slow online payment that already succeeded must not scan as `NOT_VALID not_paid`. A QR code exists only for a confirmed booking, so it needs nothing settled. |
| Rate limits: no named limit applies (§10.6 names none for these routes); the default 300 per minute per route counts each staff member's address | A busy counter or entrance stays well under it. |
| Audit, in the write's transaction, actor `staff`, never personal data: `booking.held` / `booking.released` (`holder: 'staff'`, `channel: 'counter'`), `booking.confirmed`, `payment.succeeded { method, purpose, channel: 'counter', customerKind }`, `booking.checked_in { theaterId, via }`, `booking.ticket_downloaded { format }` | "Audit events for every staff write" (issue #14). |

## Modules and files

All in `bookings` (and its `payments` / `staff` dependencies), additive to U10 and U11:

| File | What |
|---|---|
| `src/migrations/0140_01_add_payments_receipt_reference_check.ts`, `0140_02_add_bookings_checked_in_check.ts` | The two CHECKs; listed in `src/common/database/migration-list.ts` |
| `src/modules/payments/{enums,types}.ts`, `payments.repository.ts` (`insertCounterCharge`), `payments.service.ts` (`recordCounterCharge`) | Counter charges |
| `src/modules/staff/staff.service.ts` | `findByIdForUpdate()` for the counter hold's member lock |
| `src/modules/bookings/holds.service.ts` | The staff holder, `lockStaff()`, `lockCounterHoldsToRelease()`, staff release access |
| `src/modules/bookings/counter-sales.service.ts` | `CounterSalesService`: `createHold`, `releaseHold`, `pay` |
| `src/modules/bookings/staff-tickets.service.ts` | `StaffTicketsService.ticketPdf` with its audit row |
| `src/modules/bookings/scan-verdict.ts`, `scan.service.ts` | The verdict rules; `ScanService.scan` |
| `src/modules/bookings/box-office.controller.ts`, `scans.controller.ts` | The five routes (tags `Admin: box office`, `Admin: scans`) |
| `src/modules/bookings/dto/create-counter-hold.request.ts`, `create-counter-payment.request.ts`, `counter.validators.ts`, `scan.request.ts`, `scan-result.response.ts` | Request and response DTOs |
| `src/modules/bookings/bookings.repository.ts` | The check-in columns, `liveCounterHoldIdsOfStaff`, `setCounterCustomer`, `checkIn` |
| `src/modules/bookings/{types,enums,bookings.constants}.ts`, `booking-assembly.ts`, `booking-read.service.ts` (`getForStaff`), `booking-response.mapper.ts` (`scanResult`, `receiptReference`), `settle-first.{decorator,interceptor}.ts`, `dto/booking.response.ts`, `dto/payment.response.ts`, `bookings.module.ts` (imports `StaffModule`) | Shared, additive changes |

## Migrations (prefix `0140`)

- `0140_01`: `chk_payments_receipt_reference`: `kind = 'refund' OR method IN ('card','wallet') OR
  (method = 'cash' AND provider_reference IS NULL) OR (method = 'card_terminal' AND
  provider_reference IS NOT NULL AND provider_reference ~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$')`.
- `0140_02`: `chk_bookings_checked_in_paid`: `checked_in_at IS NULL OR status IN ('confirmed',
  'refunded')` (a booking admitted and later refunded keeps its scan).
- No new index: the lookups use `uq_bookings_reference`,
  `idx_bookings_created_by_staff_id_status_hold_expires_at`, `idx_bookings_checked_in_by_staff_id`
  and `idx_payments_collected_by_staff_id`, all created by U10 and U11 for this unit. No row can
  violate either CHECK before this unit, so the previous release keeps working beside them.

## Endpoints

All under `/api/v1`, `@Staff()` (box office and admin), JSON in camelCase, times in Cairo ISO.
Every route also answers `401` (`UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED`; a
customer token is `UNAUTHENTICATED`), `403 ACCOUNT_DEACTIVATED`, `429 RATE_LIMITED` and `500`.

| Route | S | Success | Request | Errors |
|---|---|---|---|---|
| `POST /admin/counter-holds` | S | `201 Booking` (`channel: counter`, `owner: staff`, `status: held`) | `{ showtimeId: int ≥ 1, seats: 1–8 distinct labels }` | `400 VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED`; `404 NOT_FOUND` (unknown showtime or draft theater); `409 SHOWTIME_NOT_BOOKABLE { reason }`, `SEAT_TAKEN { seats }`; `422 IDEMPOTENCY_KEY_REUSED` |
| `DELETE /admin/counter-holds/{ref}` | | `204` (an ended hold too) | — | `400`; `403 FORBIDDEN { reason: not_your_counter_hold }`; `404`; `409 ALREADY_PAID` |
| `POST /admin/bookings/{ref}/counter-payments` | S | `201 PaymentResult { payment, booking }` | `{ method: cash \| card_terminal, receiptReference?: string (card_terminal only), customer: { kind: walk_in } \| { kind: existing, customerId } \| { kind: contact, fullName, email?: string \| null, phone?: string \| null } }` | `400 VALIDATION_FAILED` (also `customer.customerId` for an unknown, anonymised or blocked account), `IDEMPOTENCY_KEY_REQUIRED`; `403 FORBIDDEN`; `404`; `409 SHOWTIME_NOT_BOOKABLE`, `HOLD_EXPIRED`, `ALREADY_PAID`; `422 IDEMPOTENCY_KEY_REUSED` |
| `GET /admin/bookings/{ref}/ticket.pdf` | | `200 application/pdf`, `Content-Disposition: attachment; filename="maqady-ticket-<ref>.pdf"`, `Cache-Control: private, no-store` | — | `400`; `404`; `409 TICKET_NOT_AVAILABLE { status }` |
| `POST /admin/scans` | | `200 ScanResult` | `{ theaterId: int ≥ 1, code?: 1–512 chars } \| { theaterId, reference: MQ-XXXXXX (any case, spaces trimmed), confirm?: boolean }` | `400 VALIDATION_FAILED`; `404 NOT_FOUND` (unknown theater) |

`ScanResult`: `result` (`VALID`, `ALREADY_USED`, `WRONG_SHOWTIME`, `NOT_VALID`, `NOT_FOUND`,
`CONFIRM_REQUIRED`), `reason` (`other_theater`, `cancelled`, `not_open_yet`, `ended`, `not_paid`,
`refunded`, `replaced`, or null), `admits` (for `VALID`, `ALREADY_USED`, `CONFIRM_REQUIRED`),
`checkedInAt` (now for `VALID`, the first scan for `ALREADY_USED`), `scannedAt`, and `booking`
(`ScannedBooking`: `reference`, `status`, `seats`, `seatCount`, `contactName`, `showtime`; null for
`NOT_FOUND`). `Payment` gains `receiptReference`; `BookingOwner` gains `staff`.

## Exported services (for U14–U19)

- `PaymentsService.recordCounterCharge({ bookingId, amount, method, receiptReference, purpose,
  collectedByStaffId })`: a succeeded counter charge in the open transaction (U14 edits with a
  higher total).
- `BookingReadService.getForStaff(reference)`: any booking as staff read it (U14 detail).
- `HoldsService.create()` / `release()` with a staff holder or staff access.
- `test/support/box-office.ts`: `counterHold()`, `counterPay()`, `counterSale()`, `scanTicket()`,
  `CASH_WALK_IN` for later suites.

## Tests

- Unit: `scan-verdict.test.ts` (every rule, its order, the window's exact edges),
  `scan.service.test.ts` (call order, forged codes read nothing, the race re-read, audit),
  `counter-sales.service.test.ts` (lock order, each refusal before writing, customer kinds),
  `holds.service.test.ts` (the staff holder's lock order and release), `payments.service.test.ts`
  (counter charges), `settle-first.interceptor.test.ts` (body scope),
  `dto/box-office-requests.test.ts`.
- Integration (real app and Postgres; only Resend replaced): `box-office.controller.test.ts`,
  `box-office-concurrency.test.ts` (counter vs customer race: one winner; double payment: one
  row; double scan: one admission; no deadlocks), `scans.controller.test.ts`,
  `dto/box-office-contract.test.ts`, `migrations/0140_box_office.test.ts`. The audiences suite
  (U9) sends a customer token to every new staff route.

## Acceptance

- [x] A counter hold and a customer hold racing for the same seat give exactly one winner.
- [x] A counter sale settles, issues tickets and records the receipt reference.
- [x] A scan checks in once and the second scan says already checked in, with the time.
- [x] A forged or other-showtime QR is refused.
- [x] Typed-reference confirmation works and refuses a wrong reference.
- [x] Staff ticket download returns a PDF.
- [x] Customer tokens cannot reach these routes.
- [x] Gates pass against the committed state; `contracts/openapi.yaml` is current.

## Follow-ups

- U14: refunding a counter charge (`pending` until paid out), and the real showtime cancellation
  fan-out, which turns `WRONG_SHOWTIME cancelled` bookings into `refunded`.
- U19: the activity log should render `booking.ticket_downloaded` and `booking.checked_in`.
- The PRD's "Scan tickets" lists "Not valid (refunded)"; `not_paid` and `replaced` are the other
  `NOT_VALID` reasons the screen should word.
