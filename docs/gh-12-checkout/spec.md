---
title: U11 — Checkout - simulated payments, settlement, confirmation, tickets, QR, PDF, calendar
owner: Mohamed Tarek
status: Built
last_verified: 2026-10-20
tags: [checkout, payments, simulated-provider, settlement, confirmation, lock-order, concurrency, tickets, qr, pdf, ics, messaging]
---

# U11 — Checkout: simulated payments, settlement, confirmation, tickets, QR, PDF, calendar

Issue: #12. Docs folder: `docs/gh-12-checkout/`. Migration prefix `0120`. Depends on U10
(`BookingsModule`, `SeatingModule`, `HoldsService`, `BookingReadService`, `SeatClaimService`,
`SeatEventPublisher`, `booking-status.sql.ts`, `test/support/holds.ts`) and, through it, U7
(`ShowtimeReadService`, the `ShowtimeTicketHolderService` seam), U9, U6, U5, U4b, U3, U2a and U1.
Design: `docs/system-design.md` §5, §6.1, §6.2 (`payments`), §6.3, §7.1, §7.4, §7.5, §7.9, §11,
§13.1, §14 and ADR 0004; PRD v2 "Seats and holds" 5, "Payments" 1–4, C8, C9, "Email and SMS",
"Tickets and QR codes", "Payment and messaging providers".

## Goal

A signed-in customer pays for their live hold by card or wallet through a simulated provider
whose outcome a tester chooses with a test token. A success confirms the booking exactly once,
however many times Pay is pressed or retried, makes its seat claims permanent, and queues the
tickets email (and SMS with a phone on file) in the same transaction, with no usable QR code in
any stored copy. A decline is a normal `201` result and leaves the hold payable until it ends.
A slow payment is settled from its stored `settles_at` by whichever request next reads or writes
the booking or its showtime, never by a timer, and reaches the same state either way. The owner
gets a signed QR payload, a PDF ticket and a calendar file; everyone else gets `404`.

## Scope

- Migration `0120_01_create_payments`.
- `src/modules/payments/` (`PaymentsModule`): the `payments` ledger, the `PaymentProvider`
  interface (`charge`, `retrieve`, `refund`) and `SimulatedPaymentProvider`.
- In `src/modules/bookings/` (U10's module): `CheckoutService` (`POST /bookings/{ref}/payments`),
  `SettlementService`, `BookingConfirmationService`, `@SettleFirst()` and
  `SettleFirstInterceptor`, `QrCodeService`, `TicketsService` (tickets messages, PDF, `.ics`),
  `BookingViews`, the `booking.tickets` and `booking.tickets_sms` templates,
  `BookingTicketHolders` (U7's seam).
- U10 follow-ups: settle first on the hold, claim, release, booking and seat-snapshot routes;
  `PAYMENT_IN_PROGRESS` when a hold to release or replace has a processing charge; hold extension
  while processing; `seat.booked`; booking responses gain `paymentStatus`, `payment`, `ticket`,
  `confirmedAt`.
- Config `QR_SIGNING_KEY` (validated at boot), error code `TICKET_NOT_AVAILABLE`, dependencies
  `pdfkit` `0.20.2` and `qrcode` `1.5.4` (with `@types/pdfkit` `0.17.6` and `@types/qrcode`
  `1.5.6` as dev dependencies), each pinned exactly to its newest release at least two weeks old.
- Complete Swagger (`@ApiTags('Checkout')`, `@ApiTags('Tickets')`); `docs/system-design.md`
  updated (Decisions below); README "Checkout and tickets"; `docs/INDEX.md`.

## Out of scope

- Counter holds and counter payments, the staff ticket download, scanning (U13). They reuse
  `BookingConfirmationService`, `TicketsService` (`{ kind: 'staff' }` access) and
  `QrCodeService.verify()`.
- My Bookings, booking details and History, "Email again" (U12; it calls
  `TicketsService.queueTickets(ids, { sms: false })`).
- Cancel and refund, payouts, edits, staff resend, showtime cancellation fan-out and the refund
  notice template (U14). U11 only writes the immediate refund of a success whose claims or
  showtime are gone (§7.5), without a message (open question 5).
- The SQL form of the payment status for lists (U12, U16). U11 adds the TypeScript
  `paymentStatusOf()` only.
- Settling before the WebSocket snapshot: seating depends on nothing (U10). A processing hold's
  claims outlive `settles_at` by 30 s, so the gateway never shows a paid seat as free.

## Decisions taken here

| Decision | Why |
|---|---|
| **`SettlementService` lives in `bookings`, not `payments`.** `payments` is the ledger plus the provider and depends on nothing but `common/`. §5 is corrected | Settling writes `bookings` rows, claims, tickets and audit; in `payments` it would need bookings' repository, or a cycle. |
| **Settle first, before the request transaction.** `@SettleFirst('booking' \| 'showtime')` marks a route. `SettleFirstInterceptor`, registered in `AppModule` between `OutboxDrainInterceptor` and `WriteInterceptor`, runs `SettlementService.settleDue()` in its own short transaction, committed before the request transaction opens | §7.1 step 1 "in their own short transaction". Inside the request it would lock bookings before the request's customer and break §7.1; a second connection inside the request could starve the 5-connection pool (U10's reason for `afterRollback`). Guards have run, so the caller is known; pipes have not, so a malformed `ref` / `id` settles nothing and the pipe answers `400`. |
| Settlement scope = the path's booking **or** showtime, **or** the calling customer's bookings | A hold or claim releases the caller's live hold on another showtime, so that hold's due charge is settled first too. Guest holds can't have payments. |
| **Due charges are found without a join**: one query over the partial index `idx_payments_settles_at_processing` (`status = 'processing' AND settles_at <= now`), then, only when something is due, the bookings by id, filtered by scope in code | The common case (nothing due) costs one indexed query on an almost empty index, and `payments` never reads `bookings` in SQL. |
| `settleDue()` refuses to run inside an open transaction (`INTERNAL`) | Settling under a request's locks would break §7.1. |
| **Lock order inside settlement**: showtimes `FOR SHARE` (id order) → bookings `FOR UPDATE` (id order) → claims `FOR UPDATE` (showtime, label order) → one conditional `UPDATE payments … WHERE status = 'processing' RETURNING` | A subsequence of §7.1, like the payment route. Locking the showtime serializes settlement against U7's move and cancel (`FOR UPDATE`), so a booking is never confirmed after its showtime was cancelled, nor missed by a move's ticket-holder list. Payment rows are only written by a transaction holding their booking `FOR UPDATE`. |
| A success whose showtime is no longer `scheduled`, or whose claims are not all still the booking's, is refunded at once through the provider: a `refund` / `cancellation` / `succeeded` row naming the charge, the booking `refunded` (`confirmed_at = refunded_at = now`, `qr_version = 1`, as U10's lifecycle CHECK requires), its remaining own claims deleted, `seat.released` after commit, audit `booking.refunded { reason: 'claims_lost' \| 'showtime_cancelled' }` | §7.5 "settlement refunds it at once". With the simulated provider it is defensive: settlement runs before any hold on the showtime, and claims outlive `settles_at` by 30 s. |
| A success settled after `hold_expires_at` still confirms when the claims are intact (expired, not taken over) | PRD Seats 5: the seats stay theirs until the payment returns. |
| **Processing extends, never shortens**: `hold_expires_at` and the claims' `claimed_until` become `settles_at + 30 s` when that is later, not capped at `starts_at`; `seat.held` with the new end after commit | A slow result 10 s later must not cut a 4-minute hold to 40 s. PRD Seats 5 outranks the start cap. |
| Insert the charge as `processing`, call the provider, then record the result, all in the request transaction | §7.5 step 5. The partial unique index refuses a second live sale charge before any money moves. |
| Provider idempotency key `<reference>-c<n>` for the booking's n-th charge, `<reference>-r<n>` for its n-th refund, counted under the booking lock; stored in `provider_idempotency_key`, UNIQUE | Stable across the write interceptor's deadlock retry (rolled-back rows don't count) and unique per attempt. |
| The simulated provider is stateless: `providerReference = sim.<token>.<settles at, epoch ms>.<first 16 hex of sha256(key)>`; `retrieve()` parses it and answers `processing` until the `Clock` reaches `settlesAt`; refunds are `simr.<16 hex>` | §7.5 "stateless, decides each result from the test token"; no callback, no timer, `TestClock` controls readiness. |
| `token` is validated by the DTO against `SIMULATED_PAYMENT_TOKENS` (Swagger enum), and a `sim_card_*` token with `method: 'wallet'`, or the reverse, is `400 VALIDATION_FAILED` on `token`, before any lock | The only provider in v1, and the testers' documented outcomes (PRD "Payment and messaging providers"). No card number field exists. |
| Refusal precedence on `POST /bookings/{ref}/payments`: `404` (not the owner) → `ALREADY_PAID` (`confirmed` / `refunded`, unlocked read) → `SHOWTIME_NOT_BOOKABLE { reason }` → `UNAUTHENTICATED` / `ACCOUNT_BLOCKED` → under the booking lock `ALREADY_PAID` / `HOLD_EXPIRED` (`hold_expires_at <= now`) / `PAYMENT_IN_PROGRESS` → under the claim locks `HOLD_EXPIRED` | One clear message. `HOLD_EXPIRED` at exactly `hold_expires_at`, like U10's `<= now` meaning free. |
| Bookability is U10's `notBookableReason()`, with the theater, movie and hall read without locks after the showtime's `FOR SHARE` | §7.5 step 2, one rule. |
| A decline sets `has_declined_payment`; a wallet `cancelled` does not. Both answer `201` with the payment and commit. Retrying needs a new `Idempotency-Key`; the same key replays the decline | §7.5, §14.1 "business results that must persist". |
| **Payment status** (`paymentStatusOf()`, in `booking-status.sql.ts`): `refunded` → `refunded`; `confirmed` → `paid`; `held`: latest sale charge `processing` → `processing`, else `has_declined_payment` → `declined`, else `unpaid` | §7.4 "derived the same way"; PRD "Statuses": a Failed booking's payment status is Declined, even when its last attempt was a closed wallet. |
| **QR payload** `MQ1.<reference>.<qr_version>.<sig>`, `sig` = base64url of the first 16 bytes of HMAC-SHA256(`QR_SIGNING_KEY` bytes, `MQ1.<reference>.<qr_version>`), 22 characters. Verification parses strictly (`^MQ1\.MQ-[2-9A-HJKMNP-Z]{6}\.[1-9][0-9]{0,4}\.[A-Za-z0-9_-]{22}$`) and compares with `safeEqual` | §7.9. U1's `hmacSha256()` returns the whole digest's base64url, whose 22-character prefix is not the 16-byte truncation, so `common/crypto` gains `hmacSha256Bytes()`. |
| `QR_SIGNING_KEY`: base64 of at least 32 bytes, required, and different from `JWT_SECRET_*` and `DATA_ENCRYPTION_KEY` / `_PREVIOUS_KEY` (boot problem otherwise). `AppConfig.tickets.qrSigningKey` | §14.5. One leaked secret must not forge another kind of credential. |
| `ticket` (`{ qrCode, admits }`), `ticket.pdf` and `calendar.ics` exist for the statuses `confirmed` and `completed`; otherwise `409 TICKET_NOT_AVAILABLE { status }`. Another customer, or an unknown reference, `404` | A completed ticket is still a record; a held, failed, abandoned or refunded booking has none. Non-owners learn nothing (§10.4). |
| PDF: pdfkit, A5 portrait, built-in Helvetica, `compress: false`, `info.Title = "Maqady ticket <ref>"`, creation date from the `Clock`. Text: movie and age rating, theater and address, hall, `formatCairoDisplay(startsAt)`, cinema day, seats with zones, "Admits n", total, reference, the entrance line and the policy line. The QR is `QRCode.create(payload, { errorCorrectionLevel: 'M' })` drawn as one rectangle per dark module (nothing else on the page uses `re`). Characters outside WinAnsi print as `?` | PRD "Tickets and QR codes". Uncompressed content keeps the tests honest without a PDF-parsing dependency; a ticket is a few tens of KB. |
| `.ics`: one `VEVENT`, `UID:<reference>@maqady`, `DTSTAMP` from the `Clock`, `DTSTART` / `DTEND` = `starts_at` / `ends_at` in UTC (`YYYYMMDDTHHMMSSZ`, no `VTIMEZONE`), `SUMMARY:<movie> · <theater>`, `LOCATION:<theater>, <address>, <district>, <city>`, `DESCRIPTION` with reference, hall, seats and admits; RFC 5545 escaping, CRLF, lines folded at 75 octets without splitting a UTF-8 character | PRD "Add to calendar gives a calendar file with the showtime and the theater's address". UTC avoids time-zone data. |
| Downloads: `Content-Type: application/pdf` / `text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="maqady-ticket-<ref>.pdf"` / `"maqady-<ref>.ics"`, `Cache-Control: private, no-store` | §7.9: fetched with the `Authorization` header, never a token in a URL. |
| `ShowtimeTicketHolderService` is bound to U7's new `RegisteredTicketHolders` (nobody until a source registers), and `BookingTicketHolders.onModuleInit()` registers itself | Bookings imports showtimes, so showtimes can't import bookings; the registry is the repo's reverse-dependency pattern (U4b, U5, U6). |
| Audit, in the write's transaction: `payment.succeeded`, `payment.declined`, `payment.cancelled`, `payment.processing` (entity `payment`, `bookingId`, metadata `{ method, purpose }`), `payment.refunded` for an automatic refund, `booking.confirmed` (`{ showtimeId, seatCount, channel }`), `booking.refunded` as above. Actor: the customer on the payment route, `system` in settlement. `AuditService.recordMany()` writes a batch in one statement | PRD C11 History "payment received" from real events. No personal data. |

## Open questions decided

1. **The QR in messages is a link.** The tickets email and SMS carry the QR only as a one-time
   link, `${FRONTEND_BASE_URL}/ticket?token=<qr payload>`, whose page draws the code. `qrCode` is
   the templates' secret parameter, so every stored copy (the Message log, `GET
   /admin/messages/{id}`) reads `[one-time link hidden]` and `queue()` refuses a render that
   leaks it (design §13.1, ADR 0004: no secret links in the Message log). An inline image would
   put the payload into `body_html`. The frontend adds the `/ticket` route; the PRD's list of
   link routes ("Payment and messaging providers") should name it (follow-up).
2. **An unverified customer may pay.** PRD Accounts 2: "Verification blocks nothing". Tickets go
   to the account's email whether verified or not; the customer can always open them in My
   Bookings and download the PDF.
3. **Arabic in PDFs.** PRD "Out of scope" excludes "Multiple languages … including Arabic names
   and titles" in v1, so the built-in Helvetica is enough. A character it cannot draw is printed
   as `?` (`winAnsiText()`), never as garbage. Embedding a Unicode font with Arabic shaping is a
   follow-up for when the PRD brings Arabic in.
4. **Sales paused after a hold was created**: the payment is refused (`SHOWTIME_NOT_BOOKABLE
   { reason: 'sales_paused' }`), as design §7.5 step 2 says ("re-check it as in §7.3 step 2").
   "Existing tickets stay valid" (PRD Theaters 1) is about paid tickets, not holds.
5. **No message for settlement's automatic refund.** U11 records the refund row and
   `booking.refunded { reason }`; the refund notice template belongs to U14, which should also send
   it for these refunds (follow-up). With the simulated provider the case cannot arise in normal
   operation (see the decision above).

## Modules and files

**`src/modules/payments/`**: `PaymentsModule`. Imports nothing beyond the global modules.
Providers: `PaymentsRepository`, `PaymentsService`, `SimulatedPaymentProvider`, `{ provide:
PaymentProvider, useExisting: SimulatedPaymentProvider }`. Exports `PaymentsService` and
`PaymentProvider`.

| File | Holds |
|---|---|
| `enums.ts` | `PAYMENT_KINDS`, `PAYMENT_PURPOSES`, `PAYMENT_METHODS`, `ONLINE_PAYMENT_METHODS`, `CHARGE_STATUSES`, `REFUND_STATUSES`, `PAYMENT_STATUSES`, `CARD_BRANDS`, `WALLET_TYPES`, `SIMULATED_PAYMENT_TOKENS` |
| `types.ts` | rows (`PaymentRow`, `NewPaymentRow`, `ChargeResultColumns`, `FinishedChargeRow`, `BookingCountRow`), `Payment`, `PaymentCard`, provider types (`ChargeRequest`, `ChargeResult`, `RetrieveRequest`, `RefundRequest`, `RefundResult`, `SimulatedOutcome`), service inputs (`OnlineChargeInput`, `OnlineRefundInput`, `DueCharge`, `ChargeOutcome`) |
| `payments.constants.ts` | `SIMULATED_SETTLE_SECONDS = 10`, `SETTLEMENT_BATCH_LIMIT = 100`, `PROVIDER_KEY_PATTERN`, `SIMULATED_CHARGE_REFERENCE_PATTERN`, `SIMULATED_REFUND_PREFIX` |
| `simulated-tokens.ts` | pure: `SIMULATED_TOKEN_OUTCOMES`, `isSimulatedToken()`, `outcomeOf()` |
| `payment-provider.ts` | `abstract class PaymentProvider` |
| `simulated-payment.provider.ts` | `SimulatedPaymentProvider` (injects `Clock`) |
| `payments.repository.ts` | `insert`, `recordResult`, `countOf`, `countsOf`, `insertMany`, `latestSalesOf` (one `DISTINCT ON`), `processingSaleBookingIds`, `due(now, limit)`, `finishProcessing(rows, now)` (one `UPDATE … FROM unnest(…) WHERE status = 'processing' RETURNING`) |
| `payments.service.ts` | `PaymentsService`, `toPayment()` |
| `payments.module.ts` | the module |

**`src/modules/bookings/`** additions. `BookingsModule` also imports `PaymentsModule`. New
providers: `BookingViews`, `QrCodeService`, `TicketsService`, `BookingConfirmationService`,
`CheckoutService`, `SettlementService`, `SettleFirstInterceptor`, `BookingTicketHolders`,
`BookingTemplatesRegistrar`. New exports: `SettlementService`, `BookingConfirmationService`,
`TicketsService`, `QrCodeService`, `SettleFirstInterceptor`. `AppModule` imports `PaymentsModule`
before `BookingsModule` and adds `{ provide: APP_INTERCEPTOR, useExisting: SettleFirstInterceptor }`
between the two existing interceptors.

| File | Holds |
|---|---|
| `types.ts` (extended) | `BookingRow.qr_version`; `Booking` gains `confirmedAt`, `paymentStatus`, `payment`, `ticket` (`BookingTicket`); `BookingParts` gains `latestSale`, `qrCode`; `PaymentStatusInput`, `CheckoutInput`, `CheckoutResult`, `ConfirmBookingInput`, `SettlementScope`, `SettlementResult`, `AutomaticRefund`, `TicketHolderRow`, `QrPayload`, `ParsedQr`, `TicketAccess`, `TicketSeat`, `TicketDetails`, `TicketFile`, `QueueTicketsOptions`, `BookingTicketsParams` |
| `enums.ts` (extended) | `PAYMENT_STATUS_DISPLAYS`, `SETTLE_FIRST_KINDS`, `TICKET_STATUSES`, `AUTOMATIC_REFUND_REASONS` |
| `bookings.constants.ts` (extended) | `PROCESSING_GRACE_SECONDS = 30`, `QR_PREFIX`, `QR_SIGNATURE_BYTES = 16`, `QR_PAYLOAD_PATTERN`, `TICKET_LINK_PATH = '/ticket'`, `MY_BOOKINGS_PATH = '/my-bookings'`, `SETTLE_FIRST_METADATA`, `PAYMENT_ENTITY`, `TICKET_CACHE_CONTROL`, `CALENDAR_UID_DOMAIN` |
| `booking-status.sql.ts` (extended) | `paymentStatusOf()` |
| `booking-assembly.ts` (extended) | `toBooking()` with the new fields, `hasTicket()` |
| `booking-views.service.ts` | `BookingViews.of(row, now)`: seats, showtime header, latest sale, QR payload |
| `qr-code.ts` | pure: `signQr()`, `parseQr()`, `verifyQr()` |
| `qr-code.service.ts` | `QrCodeService` (key from `AppConfig.tickets`) |
| `ticket-calendar.ts` | pure: `ticketCalendar(details, now)`, `utcStamp()`, `escapeText()`, `foldLine()` |
| `ticket-pdf.ts` | `renderTicketPdf(details, now)` → `Promise<Buffer>`, `winAnsiText()` |
| `tickets.service.ts` | `TicketsService` |
| `booking-confirmation.service.ts` | `BookingConfirmationService` |
| `checkout.service.ts` | `CheckoutService.pay` |
| `settlement.service.ts` | `SettlementService` |
| `settle-first.decorator.ts` | `SettleFirst(kind)` |
| `settle-first.interceptor.ts` | `SettleFirstInterceptor`, `scopeOf()` |
| `booking-ticket-holders.service.ts` | `BookingTicketHolders` |
| `bookings.repository.ts` (extended) | `findByIds`, `confirm`, `markDeclined`, `extendHold`, `markRefunded`, `ticketHoldersOf`; `qr_version` read |
| `templates/` | `booking-tickets.template.ts`, `booking-tickets-sms.template.ts`, `booking-templates.registrar.ts` |
| `booking-payments.controller.ts` | `@Controller('bookings')`: `POST :ref/payments` |
| `booking-tickets.controller.ts` | `@Controller('bookings')`: `GET :ref/ticket.pdf`, `GET :ref/calendar.ics` |
| `booking-response.mapper.ts` (extended) | `paymentResult()`, `toPaymentResponse()`; `booking()` adds the new fields |
| `dto/` | `create-payment.request.ts`; `payment.response.ts` (`PaymentResponse`, `PaymentCardResponse`), `payment-result.response.ts`, `ticket.response.ts`; `booking.response.ts` extended |

**Changed elsewhere**:

- U10's routes gain `@SettleFirst()`: `GET /showtimes/:id/seats` and `POST /showtimes/:id/holds`
  (`'showtime'`); `POST /holds/:ref/claims`, `DELETE /holds/:ref` and `GET /bookings/:ref`
  (`'booking'`). `HoldsService` (create, claim, release) answers `PAYMENT_IN_PROGRESS` when a
  hold it would release has a processing sale charge, read after locking the bookings, and reads
  bookings through `BookingViews`.
- `SeatClaimService` (seating): `lockFor(seats)`, `confirm(claims)`, `extend(claims, until)`,
  `deleteOwn(claims)`, each one statement.
- `src/modules/showtimes/`: `RegisteredTicketHolders` replaces `NoTicketHolders` and is exported;
  `ShowtimeReadService.lockForShareMany(ids)` (`ShowtimesRepository.findByIdsForShare`).
- `src/modules/theaters/theater-read.service.ts`: `findByIds(ids)` (any status).
- `src/common/crypto/hashing.ts`: `hmacSha256Bytes(key, data)`.
- `src/common/audit/`: `AuditService.recordMany(events)`, `AuditRepository.insertMany(rows)`.
- `src/common/money/money.ts`: `formatMoneyDisplay(money)` → `EGP 380`, `EGP 1,234`,
  `EGP 190.50`.
- `src/common/errors/error-catalogue.ts`: `TICKET_NOT_AVAILABLE` (409); `ALREADY_PAID`,
  `HOLD_EXPIRED`, `PAYMENT_IN_PROGRESS` descriptions name their `details` (`null`). The Swagger
  examples gain `TICKET_NOT_AVAILABLE { status }` and `SHOWTIME_NOT_BOOKABLE { reason }`.
- `src/common/config/*`: `QR_SIGNING_KEY`, `AppConfig.tickets`, the distinct-secret check;
  `.env.example`; `src/cli/contract.ts`; `test/support/test-config.ts` (`TEST_QR_SIGNING_KEY`).
- Tests of earlier units: `load-config.test.ts`, `error-catalogue.test.ts`, `holds.service.test.ts`
  (the new collaborators and the processing refusals), `bookings-contract.test.ts` (its route
  filter leaves out the U11 routes; two 409 examples gain `PAYMENT_IN_PROGRESS`).

## Migration (prefix `0120`)

**`0120_01_create_payments`**. Row-level security enabled. No defaults: times come from the
`Clock`. The full §6.2 table is created now, including the counter and payout columns U13 and
U14 fill, so their CHECKs hold from the first row.

```sql
CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL,                -- fk_payments_booking_id
  kind VARCHAR(8) NOT NULL,                  -- charge | refund
  purpose VARCHAR(16) NOT NULL,              -- sale | edit_difference | cancellation (per kind)
  method VARCHAR(16) NOT NULL,               -- card | wallet | cash | card_terminal
  status VARCHAR(16) NOT NULL,               -- charge: processing | succeeded | declined | cancelled; refund: pending | succeeded
  amount INT NOT NULL, currency VARCHAR(3) NOT NULL,
  refund_of_payment_id BIGINT NULL,          -- fk_payments_refund_of_payment_id (self)
  provider_idempotency_key VARCHAR(32) NULL, -- online only: <reference>-c<n> / -r<n>
  provider_reference VARCHAR(100) NULL,
  card_brand VARCHAR(16) NULL, card_last4 VARCHAR(4) NULL, wallet_type VARCHAR(16) NULL,
  settles_at TIMESTAMPTZ NULL, completed_at TIMESTAMPTZ NULL,
  collected_by_staff_id BIGINT NULL, paid_out_at TIMESTAMPTZ NULL, paid_out_by_staff_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
  -- CHECKs: kind; purpose per kind; method; status per kind; processing/declined/cancelled only
  -- online; a pending refund only at the counter; amount > 0; currency EGP; refund_of exactly for
  -- refunds; a provider key exactly for online methods; card brand and last4 together, only for
  -- cards; wallet only for wallets; settles_at only online; completed_at exactly when final;
  -- collected_by exactly for counter charges; paid out only for succeeded counter refunds.
);
```

| Index | Query it serves |
|---|---|
| `uq_payments_booking_id_live_sale (booking_id) WHERE kind = 'charge' AND purpose = 'sale' AND status IN ('processing', 'succeeded')` | §6.3: at most one in-flight or successful sale charge per booking; the backstop of `ALREADY_PAID` / `PAYMENT_IN_PROGRESS` |
| `idx_payments_booking_id_created_at (booking_id, created_at, id)` | Covers `fk_payments_booking_id`. The latest sale charge (`DISTINCT ON`), the counts behind provider keys, the processing check |
| `idx_payments_settles_at_processing (settles_at) WHERE status = 'processing'` | Due charges: `status = 'processing' AND settles_at <= ? ORDER BY settles_at, id LIMIT ?` |
| `uq_payments_provider_idempotency_key (provider_idempotency_key) WHERE … IS NOT NULL` | One provider call per attempt key |
| `idx_payments_refund_of_payment_id … WHERE … IS NOT NULL` | Covers the self FK; a charge's refunds (U14) |
| `idx_payments_collected_by_staff_id … WHERE … IS NOT NULL` | Covers `fk_payments_collected_by_staff_id` (U13) |
| `idx_payments_paid_out_by_staff_id … WHERE … IS NOT NULL` | Covers `fk_payments_paid_out_by_staff_id` (U14) |

No `ON DELETE`: payments are never deleted.

## Behaviour

**Pay** (`POST /bookings/{ref}/payments`, the request transaction, `CheckoutService.pay`).
`SettleFirstInterceptor` has already settled the booking's and the caller's due charges.

1. The DTO refuses an unknown token, or a token of the other method (`400` on `token`).
2. `findByReference(ref)`. Missing, or not the caller's → `404`. `confirmed` / `refunded` →
   `409 ALREADY_PAID`.
3. `BookingShowtimeService.lockedBookingContext()` (the showtime `FOR SHARE`, §7.1 step 2), the
   hall unlocked; `notBookableReason()` → `409 SHOWTIME_NOT_BOOKABLE { reason }`.
4. `CustomerService.findByIdForUpdate(caller)` (step 4). Null or anonymised → `401
   UNAUTHENTICATED`; `blocked` → `403 ACCOUNT_BLOCKED`.
5. `BookingsRepository.lockForUpdate([id])` (step 5). Re-check: `ALREADY_PAID`; `hold_expires_at
   <= now` → `409 HOLD_EXPIRED`; a processing sale charge → `409 PAYMENT_IN_PROGRESS`.
6. `SeatClaimService.lockFor([{ showtimeId, labels }])` (step 6, the booking's `booking_seats`
   labels). Every seat must have a claim of this booking that is live (`claimed_until > now`),
   else `HOLD_EXPIRED`. From here no rival upsert can take them (§7.5 step 4).
7. `PaymentsService.chargeOnline()`: insert `charge` / `sale` / `processing` with `<ref>-c<n>`,
   `provider.charge()`, record the result (`status`, `provider_reference`, card or wallet,
   `settles_at` while processing, `completed_at` once final).
8. By result: **succeeded** → `BookingConfirmationService.confirm()`; **declined** →
   `markDeclined()`; **cancelled** → nothing; **processing** → when `settles_at + 30 s` is later
   than the hold's end, `extendHold()` and `SeatClaimService.extend()` to it, and `seat.held` after
   commit. Audit `payment.<status>`.
9. `201 PaymentResultResponse`: the payment and the booking (`BookingViews`) as they are now.

**Confirm** (`BookingConfirmationService.confirm(items, actor)`, in the open transaction, the
bookings and claims locked by the caller): `BookingsRepository.confirm(ids)` (`WHERE status =
'held'`, every row must come back), `SeatClaimService.confirm()` (`claimed_until = NULL`, the
count must equal the seats, else `INTERNAL`), `TicketsService.queueTickets(ids, { sms: true })`,
`AuditService.recordMany(booking.confirmed…)`, and `seat.booked` per booking after commit. A
fixed number of statements for any batch size.

**Settle** (`SettlementService.settleDue(scope)`; `INTERNAL` inside an open transaction):

1. `PaymentsService.due(100)`: processing charges with `settles_at <= now`. None → `{ confirmed:
   0, declined: 0, refunded: 0 }` with no transaction. Otherwise their bookings by id, filtered by
   the scope; none left → the same.
2. In one transaction: `ShowtimeReadService.lockForShareMany()`, `BookingsRepository
   .lockForUpdate()`, `seatsOf()`, `SeatClaimService.lockFor()`.
3. `provider.retrieve()` per due charge; `PaymentsService.finishProcessing()`: only rows still
   `processing` come back (two polling tabs settle a charge once); a result still `processing` is
   skipped.
4. Apply in batches: confirm (actor `system`), refund at once, or mark declined. Audit
   `payment.<status>` for each finished charge.
5. `settleAllDue()` is the same without a scope (U14, U16, U17 before their lists).

**`SettleFirstInterceptor`**: for an HTTP route with `SETTLE_FIRST_METADATA`, the scope is
`params.ref` (matching `REFERENCE_PATTERN`) or `params.id` (a positive safe integer), plus
`customerId` when the principal is a customer; it awaits `settleDue()`, then `next.handle()`. A
malformed parameter settles nothing. Other routes and contexts pass straight through. Settlement
errors propagate (`503` when the database is down).

**Lock order, all paths** (§7.1). Pay takes 2 → 4 → 5 → 6, then writes its own booking's payment
row. Settlement takes 2 → 5 → 6 → payment rows of bookings it holds. U10's hold takes 2 → 3 → 4 → 5
→ 6, claim 4 → 5 → 6, release 5 → 6. Every path is a subsequence of one order, so none can form a
cycle:

- **Duplicate payments, distinct keys**: both wait on the customer, then the booking lock. The
  second then sees `confirmed` (`ALREADY_PAID`), the processing charge (`PAYMENT_IN_PROGRESS`),
  or the decline and runs as a retry. The partial unique index backs it.
- **Same key**: the idempotency claim waits for the first request's commit and replays it
  (`Idempotent-Replayed: true`), so the provider is called once.
- **Pay vs release, or vs the customer's re-pick**: both lock the booking. Release first →
  `HOLD_EXPIRED`. Pay first → the release sees `confirmed` (`ALREADY_PAID`) or a processing charge
  (`PAYMENT_IN_PROGRESS`); a re-pick no longer counts a confirmed booking as a live hold.
- **Pay vs a rival hold on the same seats**: the rival's upsert waits on the claim locks of step 6,
  then sees `claimed_until IS NULL` (or the extended hold) and gets `SEAT_TAKEN`.
- **Pay or settle vs U7 move, re-price, cancel**: those take the showtime `FOR UPDATE`, so they run
  wholly before or after. A cancel committed first makes the payment `SHOWTIME_NOT_BOOKABLE
  cancelled` and a due success a refund at once.
- **The clock during the provider call**: the claims are locked from step 6, so reaching
  `hold_expires_at` mid-call changes nothing (PRD Seats 5). The simulated provider answers in
  memory, well inside `idle_in_transaction_session_timeout` (15 s).

## Endpoints

All under `/api/v1`, with a summary, a description and `@ApiErrorResponses(...)`; U1 adds the
access, idempotency and `429` docs.

| Route | Access | Idem. | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /bookings/{ref}/payments` | `@Customer()` (owner checked in the service), `@RateLimit('payment')` (10 / 5 min per booking), `@SettleFirst('booking')` | **S** | `BookingRefParams`, `CreatePaymentRequest` | `201 PaymentResultResponse` | `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `UNAUTHENTICATED`, `ACCOUNT_BLOCKED`, `NOT_FOUND`, `SHOWTIME_NOT_BOOKABLE`, `HOLD_EXPIRED`, `ALREADY_PAID`, `PAYMENT_IN_PROGRESS`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE` |
| `GET /bookings/{ref}/ticket.pdf` | `@Customer()` (owner), `@SettleFirst('booking')` | — | `BookingRefParams` | `200 application/pdf` (binary) | `VALIDATION_FAILED`, `UNAUTHENTICATED`, `NOT_FOUND`, `TICKET_NOT_AVAILABLE` |
| `GET /bookings/{ref}/calendar.ics` | `@Customer()` (owner), `@SettleFirst('booking')` | — | `BookingRefParams` | `200 text/calendar` (string) | `VALIDATION_FAILED`, `UNAUTHENTICATED`, `NOT_FOUND`, `TICKET_NOT_AVAILABLE` |

U10's routes keep their contracts; `GET /bookings/{ref}` and the hold responses gain the booking
fields below, and `POST /showtimes/{id}/holds`, `POST /holds/{ref}/claims` and `DELETE
/holds/{ref}` gain `PAYMENT_IN_PROGRESS`. The downloads use `@ApiProduces()`, a `StreamableFile`
and the headers above.

**Request DTO**: `CreatePaymentRequest` (schema `CreatePaymentRequest`): `method` (`card` \|
`wallet`), `token` (`SIMULATED_PAYMENT_TOKENS`, described with the table below).

**Response DTOs** (times `formatCairoIso`, money `MoneyResponse`):

- `PaymentResponse` (schema `Payment`): `status` (`processing` \| `succeeded` \| `declined` \|
  `cancelled`), `method`, `amount`, `card` (`PaymentCard { brand, last4 }` \| null), `walletType`
  (\| null), `createdAt`, `completedAt` (\| null), `settlesAt` (only while `processing`). No
  internal id, no provider reference.
- `PaymentResultResponse` (schema `PaymentResult`): `payment`, `booking` (`Booking`).
- `TicketResponse` (schema `Ticket`): `qrCode` (the payload), `admits`.
- `BookingResponse` (U10's `Booking`) gains `confirmedAt` (\| null), `paymentStatus`
  (`BookingPaymentStatus`), `payment` (`Payment` \| null, the latest sale charge) and `ticket`
  (`Ticket` \| null, set for `confirmed` and `completed`).

**Error shapes**: `TICKET_NOT_AVAILABLE { status }`; `SHOWTIME_NOT_BOOKABLE { reason }` as U10;
`ALREADY_PAID`, `HOLD_EXPIRED`, `PAYMENT_IN_PROGRESS` with `details: null`.

**Simulated test tokens** (`SIMULATED_PAYMENT_TOKENS`, README "Checkout and tickets"):

| Token | Method | Result | Recorded |
|---|---|---|---|
| `sim_card_visa` | card | succeeded | `visa` `4242` |
| `sim_card_mastercard` | card | succeeded | `mastercard` `4444` |
| `sim_card_meeza` | card | succeeded | `meeza` `0011` |
| `sim_card_declined` | card | declined | `visa` `0002` |
| `sim_card_slow` | card | processing, succeeded at `now + 10 s` | `visa` `3184` |
| `sim_card_slow_declined` | card | processing, declined at `now + 10 s` | `visa` `0341` |
| `sim_wallet_apple_pay` | wallet | succeeded | `apple_pay` |
| `sim_wallet_google_pay` | wallet | succeeded | `google_pay` |
| `sim_wallet_cancelled` | wallet | cancelled (not a decline) | `apple_pay` |

## Services

**Exported by `PaymentsModule`**:

```ts
abstract class PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
  retrieve(request: RetrieveRequest): Promise<ChargeResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
}
// ChargeRequest = { amount: Money; method: 'card' | 'wallet'; token: string; idempotencyKey: string }
// ChargeResult = { status: 'processing' | 'succeeded' | 'declined' | 'cancelled'; providerReference: string;
//   settlesAt: Date | null; card: { brand; last4 } | null; walletType: WalletType | null }
// RetrieveRequest = { providerReference }   RefundRequest = { chargeReference; amount: Money; idempotencyKey }
// RefundResult = { status: 'succeeded'; providerReference }

class PaymentsService {                       // writes need an open transaction (INTERNAL otherwise)
  chargeOnline(input: OnlineChargeInput): Promise<Payment>;   // { bookingId, reference, amount, method, token }
  finishProcessing(outcomes: readonly ChargeOutcome[]): Promise<readonly Payment[]>;  // { paymentId, result }
  refundOnline(inputs: readonly OnlineRefundInput[]): Promise<readonly Payment[]>;    // { charge, reference }
  latestSalesOf(bookingIds: readonly number[]): Promise<ReadonlyMap<number, Payment>>;
  processingSaleBookingIds(bookingIds: readonly number[]): Promise<ReadonlySet<number>>;
  due(limit: number): Promise<readonly DueCharge[]>;           // { paymentId, bookingId, providerReference }
}
```

**Exported by `BookingsModule`** (added):

```ts
class SettlementService {
  settleDue(scope: SettlementScope): Promise<SettlementResult>;   // own transaction; INTERNAL inside one
  settleAllDue(): Promise<SettlementResult>;                       // U14, U16, U17 lists
}
// SettlementScope = { bookingReference?; showtimeId?; customerId? } (at least one)
// SettlementResult = { confirmed: number; declined: number; refunded: number }

class BookingConfirmationService {           // U13 counter payments reuse it
  confirm(items: readonly ConfirmBookingInput[], actor: AuditActor): Promise<void>;
}
// ConfirmBookingInput = { bookingId; showtimeId; channel; labels: readonly string[] }

class TicketsService {
  queueTickets(bookingIds: readonly number[], options: { sms: boolean }): Promise<void>; // open txn; U12, U13, U14
  ticketPdf(reference: string, access: TicketAccess): Promise<TicketFile>;
  ticketCalendar(reference: string, access: TicketAccess): Promise<TicketFile>;
}
// TicketAccess = { kind: 'owner'; customerId } | { kind: 'staff' }   (U13 passes staff)
// TicketFile = { filename; contentType; body: Buffer }

class QrCodeService {
  payloadFor(reference: string, version: number): string;
  verify(code: string): QrPayload | null;      // QrPayload = { reference; version }; U13 scanning
}

function SettleFirst(kind: 'booking' | 'showtime'): MethodDecorator;   // U13, U14 routes reuse it
```

Also exported by path: `paymentStatusOf()`, `hasTicket()`, `toPaymentResponse()`,
`PaymentResponse`, `TicketResponse`, `PAYMENT_STATUS_DISPLAYS`, `toPayment()`,
`SIMULATED_TOKEN_OUTCOMES`, and the test helpers of `test/support/checkout.ts`.

**Added to other modules**:

```ts
// seating (U10)
SeatClaimService.lockFor(seats: readonly { showtimeId; labels }[]): Promise<readonly LockedClaimRow[]>;
SeatClaimService.confirm(claims: readonly BookingClaims[]): Promise<number>;       // BookingClaims = { showtimeId; bookingId; labels }
SeatClaimService.extend(claims: BookingClaims, until: Date): Promise<number>;
SeatClaimService.deleteOwn(claims: readonly BookingClaims[]): Promise<readonly { showtimeId; labels }[]>;
// showtimes (U7)
ShowtimeReadService.lockForShareMany(ids: readonly number[]): Promise<ReadonlyMap<number, ShowtimeView>>;
RegisteredTicketHolders.register(source: ShowtimeTicketHolderService): void;
// theaters (U4b)
TheaterReadService.findByIds(ids: readonly number[]): Promise<ReadonlyMap<number, TheaterDetails>>;
// common
hmacSha256Bytes(key: Buffer, data: string): Buffer;
AuditService.recordMany(events: readonly AuditEventInput[]): Promise<void>;
formatMoneyDisplay(value: Money): string;
```

**Templates** (registered by `BookingTemplatesRegistrar.onModuleInit()`), both with
`secretParams: ['qrCode']` and `BookingTicketsParams` (`reference`, `customerName`, `movieTitle`,
`ageRating`, `theaterName`, `theaterAddress`, `hallName`, `startsAt` (`formatCairoDisplay`),
`seats` (`F7, F8`), `admits`, `total` (`formatMoneyDisplay`), `qrCode`):

- `booking.tickets` (email): subject `Your Maqady tickets · <reference>`; the details, the action
  "Show ticket QR code" → `links.oneTime('/ticket', qrCode)`, the booking page
  `links.page('/my-bookings/<reference>')`, the entrance line and the policy line.
- `booking.tickets_sms` (sms): `Maqady <ref>: <movie>, <startsAt>, <theater> hall <hall>, seats
  <seats>. Ticket: <one-time link>`.

## Tests

**Unit** (`test/unit/…` mirroring `src/`; collaborators mocked, a fixed `TestClock`):

- `modules/payments/simulated-payment.provider.test.ts`: every token's result and card or wallet;
  slow tokens `processing` with `settlesAt = now + 10 s`; `retrieve()` 1 ms before, at and after
  `settlesAt`; the same key gives the same reference; malformed references and unknown or
  mismatched tokens are `INTERNAL`; `refund()`.
- `modules/payments/payments.service.test.ts`: the charge inserted `processing` before the
  provider call, with `<ref>-c<n>`; the result recorded; `finishProcessing` skips processing
  results; refunds with `<ref>-r<n>` per booking; `INTERNAL` outside a transaction.
- `modules/bookings/qr-code.test.ts`: the pattern; the signature equals an independent
  `createHmac(...).digest().subarray(0, 16).toString('base64url')`; round trip; a changed
  reference, version, signature character, extra segment, `mq1` prefix, version `0` or `01`, or
  another key → `null`.
- `modules/bookings/ticket-calendar.test.ts`: CRLF only; UTC `DTSTART` / `DTEND`; escaping of
  `,` `;` `\` and newlines; folding at 75 octets never splits a multi-byte character; `UID`.
- `modules/bookings/booking-status.sql.test.ts` (extended): `paymentStatusOf()` for every case.
- `modules/bookings/templates/booking-tickets.template.test.ts`: the storage render holds
  `[one-time link hidden]` and none of the payload's raw, URL-encoded or HTML-escaped forms; the
  delivery render holds `/ticket?token=` + the encoded payload.
- `modules/bookings/checkout.service.test.ts`: the call order (booking read → showtime lock →
  customer lock → booking lock → claim lock → charge → confirm or extend → audit); each refusal of
  the precedence table writes nothing; extension never shortens; a datastore outage → `503`.
- `modules/bookings/settlement.service.test.ts`: nothing due → no transaction; inside a
  transaction → `INTERNAL`; the scope; only `finishProcessing` winners are applied; lost claims and
  a cancelled showtime refund; a decline marks the hold; the lock order.
- `modules/bookings/settle-first.interceptor.test.ts`: the scope from `ref` / `id` plus the
  customer; a malformed parameter, no metadata or a WebSocket context → no settlement; settlement
  before `next.handle()`.
- `common/config/load-config.test.ts` (extended): `QR_SIGNING_KEY` missing, under 32 bytes, or
  equal to another secret → a boot problem. `common/money/money.test.ts`: `formatMoneyDisplay`.
  `common/crypto/hashing.test.ts`: `hmacSha256Bytes`. `common/audit/audit.service.test.ts`:
  `recordMany`.

**Integration** (`test/integration/modules/bookings/`; the real app, real Postgres, `TestClock`,
`RecordingEmailSender` at the email boundary; nothing of ours mocked). New
`test/support/checkout.ts`: `customerHold()` (a signed-in customer's hold through the real
routes), `pay()`, `readPayments()`, and `pdfText()` (the text of an uncompressed pdfkit file).

- `booking-payments.controller.test.ts`: success by card and wallet (booking `confirmed`, `paid`,
  `ticket.admits`, claims sold, `qr_version 1`, `seat.booked` on the map, audit rows); a decline
  (`201`, hold still payable, then paid with a new key; the same key replays it); a closed wallet;
  declined then expired → `failed`; an expired hold (`1 ms` before pays, at the instant is
  `HOLD_EXPIRED` and writes nothing); a seat taken over after expiry; started, cancelled and paused
  → `SHOWTIME_NOT_BOOKABLE`; `ALREADY_PAID`; `PAYMENT_IN_PROGRESS`; a blocked customer; another
  customer, a guest, a staff token, an unknown or malformed reference; no key; a mismatched
  token; the payment rate limit.
- `payment-concurrency.test.ts`: 10 parallel payments with distinct keys → one `201`, nine `409
  ALREADY_PAID`, one charge, one confirmation, one tickets message; 10 with one key → one charge,
  replays with an identical body; payments racing their owner's release; no `40P01`.
- `settlement.test.ts`: `sim_card_slow` → `processing`, the hold extended and `seat.held`; `GET
  /bookings/{ref}` 1 ms before `settlesAt` → still processing, at it → confirmed with its tickets
  message and `seat.booked`; **read equals write** (one booking settled by a read, a twin by
  another customer's hold on its showtime: equal normalised rows); 10 parallel reads settle once;
  `sim_card_slow_declined` → declined, then payable until its end; settled long after the hold
  ended (claims intact) → confirmed; claims lost and showtime cancelled → refunded at once; a
  processing hold is never released or replaced (`PAYMENT_IN_PROGRESS`).
- `tickets.test.ts`: the tickets email and SMS queued in the confirming transaction, sent after
  commit with the real `/ticket?token=` link, no stored copy or Message log entry holding the
  payload; nothing queued or announced when the confirming transaction rolls back (a probe
  route); the QR verifies and tampering fails; the PDF and `.ics` with their headers and data;
  `TICKET_NOT_AVAILABLE`; another customer `404`; U7's move notifies the confirmed booking only.
- `dto/checkout-contract.test.ts`: the 3 routes and their access, tags, prose, errors, the binary
  responses, the schemas `CreatePaymentRequest`, `Payment`, `PaymentCard`, `PaymentResult`,
  `Ticket`, and `Booking`'s new fields.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (nonzero passes, no failures, no skips),
  `npm run build`, and `npm run contract` with no diff left and a clean `git status`.
- The tests above pass against real Postgres and prove issue #12:
  - a payment confirms the hold exactly once under concurrent duplicate submissions and
    idempotent replays (one charge row, one confirmation, one tickets message);
  - paying an expired hold is `HOLD_EXPIRED` and writes and settles nothing;
  - a declined payment leaves the hold payable until it expires;
  - settlement on read reaches the same state as settlement on write, exactly once;
  - the tickets email is queued in the confirming transaction, sent only after commit, and no
    stored copy holds the QR payload;
  - the QR signature verifies and every tampered form fails;
  - the PDF and `.ics` come with the right content type and data;
  - another customer gets `404` on the payment, PDF and calendar routes.
- `docs/system-design.md` records what was built (§5, §6.2, §7.1, §7.5, §7.9, §13.1, §14.1,
  §14.3, §14.5); README "Checkout and tickets"; `docs/gh-12-checkout/qa.md`.

## Follow-ups

- **U12**: "Email again" calls `TicketsService.queueTickets(ids, { sms: false })`; the SQL form of
  `paymentStatusOf()` for My Bookings lists; History maps `payment.*` and `booking.confirmed`.
- **U13**: counter payments call `BookingConfirmationService.confirm()` with actor `staff` and
  `channel: 'counter'`; the staff download calls `TicketsService.ticketPdf(ref, { kind: 'staff' })`;
  scanning uses `QrCodeService.verify()` and then checks `qr_version`.
- **U14**: `@SettleFirst('showtime')` on showtime cancellation and `settleAllDue()` before admin
  lists; the refund notice template, also for settlement's automatic refunds (open question 5);
  `SeatClaimService.deleteOwn()` for refunds; an edit increments `qr_version`.
- **U16, U17**: `settleAllDue()` before the Payments screen, the Overview and the bell.
- **Frontend and PRD**: the `/ticket?token=<qr payload>` page that draws the QR code from the
  tickets email and SMS; the PRD's list of link routes should name it.
- **Arabic tickets**: embed a Unicode font with Arabic shaping in the PDF if the PRD ever brings
  Arabic names or titles into scope.
