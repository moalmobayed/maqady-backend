---
title: U12 — Customer bookings - My Bookings, booking details and history, Email again
owner: Mohamed Tarek
status: Built
last_verified: 2026-10-20
tags: [bookings, my-bookings, history, audit, tickets, email-again, rate-limit, clock, cinema-day, pagination, profile]
---

# U12 — Customer bookings: My Bookings, booking details and history, Email again

Issue: #13. Docs folder: `docs/gh-13-customer-bookings/`. Migration prefix `0130`. Depends on U11
(`SettlementService`, `@SettleFirst()`, `TicketsService`, `PaymentsService.latestSalesOf()`,
`paymentStatusOf()`, `TICKET_STATUSES`, `test/support/checkout.ts`) and, through it, U10
(`BookingsRepository`, `BookingReadService`, `BookingViews`, `booking-status.sql.ts`,
`BookingResponse`, `REFERENCE_PATTERN`), U9 (`CustomerService`, `/me`), U7 (`ShowtimeReadService`,
the `showtime.moved` audit row), U6, U4b, U4a, U3 and U1. Design: `docs/system-design.md` §5, §6.1,
§7.1, §7.4, §7.9, §8 (cinema day), §10.4, §10.6, §11, §13.1, §13.5, §14; PRD v2 C10, C11, C12
("booking count"), "Email and SMS", "Statuses and definitions".

## Goal

A signed-in customer sees their own bookings in two tabs. **Upcoming** is every Confirmed booking
whose showtime hasn't ended; **Past** is Completed, Refunded and Failed. Both are decided at read
time from stored timestamps against the `Clock`, never by a job, and Abandoned bookings and live
holds never appear. A booking's details add the seat lines by zone, the refund and the theater's
address and coordinates for Directions, and a History built from real audit events. "Email
again" queues the tickets email to the customer's own address once per idempotent request, at
most 3 times an hour. Anyone but the owner gets `404` on every booking route.

## Scope

- Migration `0130_01_add_audit_events_entity_index`.
- In `src/modules/bookings/`: `GET /me/bookings`, `GET /bookings/{ref}/history`,
  `POST /bookings/{ref}/ticket-deliveries`; every `Booking` response (`GET /bookings/{ref}`, the
  hold and payment responses) gains `seatLines` and `refund`, and its `showtime.theater` the
  address and coordinates; the Profile's `bookingCount` (the U9 follow-up).
- `common/audit` gains a read side, `AuditReadService` (a booking's events).
- `common/rate-limit` gains the `customerAndBookingRef` key, used by `ticketEmail`.
- Small additions in U11 (`SettleFirst('customer')`, `queueTickets` `emailTo`, `BookingViews.ofMany`)
  and U9 (`CustomerBookingCountRegistry`, `CustomerProfileResponse.bookingCount`).
- Complete Swagger: a `My bookings` tag in `API_TAGS`, summaries, descriptions,
  `@ApiErrorResponses(...)`, examples. Contract regenerated.
- `docs/system-design.md` §5, §10.6, §11, §13.5 updated (Decisions below); `docs/INDEX.md`.

## Out of scope

- Staff resend with SMS (`POST /admin/bookings/{ref}/ticket-deliveries`), cancel and refund, edits
  and the showtime-cancellation fan-out (U14). U14 writes the audit actions this unit's History
  maps (`booking.refunded`, `booking.edited`, `booking.tickets_resent`).
- Counter sales and their `payment.succeeded` audit (U13).
- The SQL form of the payment status. My Bookings neither filters nor sorts by it, so it uses U11's
  `paymentStatusOf()` over one batched `latestSalesOf()`. U16 adds the SQL form.
- PDF and calendar downloads (U11, unchanged).

## Open questions decided

1. **Past tab order: by the showtime's start, newest first.** One keyset (`s.starts_at`, `b.id`)
   serves both tabs, and the list reads like the theater's schedule. Sorting by "when the booking
   became final" (the show's end, `refunded_at`, the hold's end) would need a `CASE` expression as
   the cursor key with no index behind it, for no rule in the PRD; a refunded booking of a future
   show sitting at the top of Past is accurate (it is the most recent show).
2. **Email again is allowed for Completed bookings**, the same rule as U11's PDF and calendar
   downloads (`TICKET_STATUSES`: `confirmed`, `completed`). A completed ticket is still a record of
   the visit, and one rule for "has a ticket" is simpler for the frontend. Anything else is
   `409 TICKET_NOT_AVAILABLE { status }`.
3. **History shows exactly PRD C11's five kinds**: seats held, payment received, refunded, changed
   by the cinema, tickets resent. Declined payments and the entrance check-in (U13) stay internal;
   a Failed booking's History is "Seats held", and its `paymentStatus: declined` already says why.
   Adding kinds later is additive (follow-up for the product owner).
4. **Email again's limit is keyed by the booking and the signed-in customer**, not by the booking
   alone. The throttler runs before the access guard (U1), so with a booking-only key anyone who
   knows a reference, even without a token, could spend the owner's three sends for the hour.
   Only the owner can ever send, so the limit is still 3 emails an hour per booking (§10.6
   updated). A caller who is not signed in is counted by address.
5. **Profile `bookingCount` counts Confirmed and Completed bookings** (stored `status =
   'confirmed'`), U9's recommendation: the bookings the customer paid for and kept, the same set as
   the dashboard's "Tickets sold". A refunded booking drops out, like it drops out of revenue.

## Decisions taken here

| Decision | Why |
|---|---|
| **Tabs by stored status and the `Clock`**: Upcoming = `bookingStatusPredicate('confirmed')` (`b.status = 'confirmed' AND s.ends_at > :now`); Past = `completed OR refunded OR failed`. Both restricted to `b.customer_id = :caller`, any channel. Abandoned and live `held` match neither | PRD C10 and the status table; the §7.4 predicates of `booking-status.sql.ts`, so the rule stays in one file |
| **The split is by the showtime's `ends_at`, never by the cinema date.** Every row carries `showtime.cinemaDate` (§8: a 00:30 show belongs to the previous cinema day) | "hasn't ended" is an instant; the cinema day labels the row the way the theater's schedule does |
| Order: Upcoming `s.starts_at ASC, b.id ASC` (soonest first); Past `s.starts_at DESC, b.id DESC`. Cursor sort key `instant` = `starts_at.toISOString()` | Open question 1. `formatCairoIso()` drops milliseconds, so it can't be a keyset value. A showtime move (U7) can reorder rows between pages, acceptable for a customer's short list |
| `tab` defaults to `upcoming`; the page carries `tabCounts { upcoming, past }` from one `COUNT(*) FILTER` query | The page opens on Upcoming; the design shows "Upcoming n" / "Past n" on the tabs (design inventory, Customer 10) |
| **Settle first for the list**: `SETTLE_FIRST_KINDS` gains `'customer'`; `@SettleFirst('customer')` settles `{ customerId }` before the read; another principal settles nothing | A slow payment past `settles_at` would otherwise read as a live hold (hidden) until something else settled it. Read equals write (U11) |
| **No N+1**: one page query (bookings joined to `showtimes`, `limit + 1` rows), one count query, then `BookingViews.ofMany()`: one batch each of seats, showtimes, theaters, movies and latest sale charges. A fixed query count for any page size. `BookingViews.of()` is `ofMany()` of one row | CLAUDE.md "No N+1"; one mapping of a booking for every read |
| The join to `showtimes` lives in `BookingsRepository` | §5: "bookings reads showtimes through its own SQL joins"; the Completed/Confirmed split needs `ends_at` in SQL. The rest of the showtime comes through `ShowtimeReadService` |
| No new `bookings` index. `idx_bookings_customer_id_status_hold_expires_at` serves `customer_id = ?`; a customer's bookings are few, so the join and sort run on that set | Avoids a write-cost index without a measured need |
| **History = the customer-visible subset of the booking's audit events**, oldest first, cursor-paginated (sort key `occurred_at.toISOString()`). `booking.held` → `seats_held`; `payment.succeeded` → `payment_received`; `booking.refunded` → `refunded`; `booking.edited` → `changed_by_cinema`; `booking.tickets_resent` → `tickets_resent`; plus `showtime.moved` of the booking's showtime while it held a ticket (`confirmed_at <= occurred_at`, and before `refunded_at` when refunded) → `changed_by_cinema`. Every other action is hidden | Open question 3; §13.5. A move changes the customer's ticket only while they hold one. `booking.confirmed` duplicates "Payment received" |
| History items carry `kind`, `label` and `occurredAt` only: no actor, no metadata | Staff identities and internal facts stay internal |
| `AuditReadService` lives in `common/audit`, next to the write side; bookings owns the mapping | `audit_events` belongs to `common/audit` (§5); a module never reads another's table |
| Migration `0130_01`: `idx_audit_events_entity_type_entity_id_occurred_at` | The `showtime.moved` branch (`entity_type = 'showtime' AND entity_id = ?`) has no index today (`idx_audit_events_entity_type` scans every showtime event); the booking branch uses `idx_audit_events_booking_id`. U19's per-entity activity reuses it |
| **Email again** goes to the customer's account email (`CustomerService.findById(caller).email`), not `contact_email`, and never sends SMS: `TicketsService.queueTickets([id], { sms: false, emailTo })`, the `booking.tickets` template of U11, `related: { customerId, bookingId }` | PRD C11 "to the customer's own email"; "Email and SMS": SMS on staff resend only. A U14 edit can change the contact |
| Email again locks the booking `FOR UPDATE` (§7.1 step 5 only), then decides its status under the lock, then queues | A refund (U14) committed first is seen (`409`); one committing later waits, and the tickets went out while the booking was still confirmed. The queued QR is the version under the lock |
| Limit `@RateLimit('ticketEmail')` (`3/1h`, key `customerAndBookingRef`), counted by the guard before the handler, so replays, `404`s and `409`s count too. Strict (`Idempotency-Key` required): a replay returns the stored `201` with `Idempotent-Replayed: true` and queues nothing | §10.6, open question 4; §14.1 |
| Email again answers `201 TicketDelivery { channel: 'email', queuedAt }`. The address is not echoed | The response is stored (encrypted) for replays; the page already knows the account email from `GET /me` |
| Audit `booking.tickets_resent` (entity `booking`, `bookingId`, metadata `{ channel: 'email' }`, actor the customer), in the request transaction | PRD C11 History "tickets resent"; U14's staff resend writes the same action |
| **`Booking` gains `seatLines`** (grouped by zone and price, zones `front` → `middle` → `back`, labels in seat order: row, then number, so `F2` before `F10`) **and `refund`** (`{ amount, refundedAt }` for a refunded booking, else `null`) | PRD C8 and C11: "seat lines by zone", "Refunded bookings show the refund amount and date" |
| The refund amount is the booking's `total` | PRD "Statuses": Refunded is "cancelled with a full refund", and an edit (U14) keeps `total` equal to what was paid. No extra query |
| **`showtime.theater` becomes `BookingTheater`** (`id`, `name`, `address`, `district`, `city`, `latitude`, `longitude`) everywhere a `BookingShowtime` appears (bookings, holds, the seat page header) | PRD C9 and C11 "Directions"; a theater's address is public data. Additive for every existing client |
| **Profile `bookingCount`**: `CustomersModule` exports `CustomerBookingCountRegistry` (answers `0` until a source registers; a second registration is `INTERNAL`), and bookings' `BookingCountsRegistrar.onModuleInit()` registers `BookingsRepository.countConfirmedOfCustomer` | Open question 5; customers can't import bookings, so the repo's registry pattern (U5, U6, U4b, U11) |
| `Cache-Control: private, no-store` on `GET /me/bookings` and `GET /bookings/{ref}/history` | Personal, and changes with the clock |

## Modules and files

**`src/modules/bookings/`** additions. `BookingsModule` registers the new controllers and providers
(`MyBookingsService`, `BookingHistoryService`, `TicketDeliveryService`, `BookingCountsRegistrar`).
No new export.

| File | Holds |
|---|---|
| `enums.ts` (extended) | `MY_BOOKINGS_TABS = ['upcoming', 'past']`, `BOOKING_HISTORY_KINDS`, `TICKET_DELIVERY_CHANNELS = ['email']`; `SETTLE_FIRST_KINDS` gains `'customer'` |
| `types.ts` (extended) | `MyBookingsTab`, `MyBookingsQueryInput`, `MyBookingsTabCounts`, `MyBookingsPage`, `MyBookingRow`, `BookingHistoryKind`, `BookingHistoryEvent`, `SeatLine`, `BookingRefund`, `BookingTheater`, `TicketDeliveryChannel`, `TicketDelivery`, `BookingCountRow`; `Booking` gains `seatLines` and `refund`; `BookingShowtime.theater` is a `BookingTheater`; `QueueTicketsOptions.emailTo` |
| `bookings.constants.ts` (extended) | `TICKETS_RESENT_ACTION`, `HISTORY_BOOKING_ACTIONS`, `HISTORY_SHOWTIME_ACTIONS`, `HISTORY_LABELS`, `PRIVATE_CACHE_CONTROL` |
| `booking-history.ts` | pure: `toHistoryEvent(event)` → `BookingHistoryEvent \| null` |
| `seat-lines.ts` | pure: `seatLinesOf(seats)` → `SeatLine[]`, `inSeatOrder(seats)` |
| `my-bookings.sql.ts` | pure: `tabPredicate(tab, aliases, now)` built from `bookingStatusPredicate()` |
| `bookings.repository.ts` (extended) | `pageForCustomer(customerId, tab, now, page)`, `tabCountsOfCustomer(customerId, now)`, `countConfirmedOfCustomer(customerId)` |
| `booking-showtime.service.ts` (extended) | `headersOf(showtimeIds)`: the headers of many showtimes in a fixed number of queries; headers carry `BookingTheater` |
| `booking-views.service.ts` (extended) | `ofMany(rows, now)`; `of()` delegates to it |
| `booking-assembly.ts` (extended) | `toBooking()` adds `seatLines` and `refund` |
| `my-bookings.service.ts` | `MyBookingsService.list(customerId, query)` |
| `booking-history.service.ts` | `BookingHistoryService.list(reference, customerId, query)` |
| `ticket-delivery.service.ts` | `TicketDeliveryService.emailAgain(reference, customerId)` |
| `booking-counts.registrar.ts` | `BookingCountsRegistrar` |
| `my-bookings.controller.ts` | `@Controller('me/bookings')`: `GET` |
| `booking-history.controller.ts` | `@Controller('bookings')`: `GET :ref/history` |
| `ticket-deliveries.controller.ts` | `@Controller('bookings')`: `POST :ref/ticket-deliveries` |
| `settle-first.interceptor.ts` (extended) | kind `'customer'` → `{ customerId }` of a customer principal; anyone else settles nothing |
| `tickets.service.ts` (extended) | `queueTickets` honours `emailTo` (with more than one booking → `INTERNAL`) |
| `booking-response.mapper.ts` (extended) | `myBookingPage()`, `historyPage()`, `ticketDelivery()`; `booking()` adds `seatLines`, `refund` and the theater's location |
| `dto/` | requests: `my-bookings.query.ts`; responses: `my-booking.response.ts` (`MyBooking`, `MyBookingTabCounts`, `MyBookingPage`), `booking-history-event.response.ts` (`BookingHistoryEvent`, `BookingHistoryEventPage`), `ticket-delivery.response.ts`, `seat-line.response.ts`, `booking-refund.response.ts`; `booking-showtime.response.ts` gains `BookingTheaterResponse` |

**Changed elsewhere**:

- `src/common/audit/`: `audit-read.repository.ts` (`AuditReadRepository.bookingEvents(filter, page)`
  and `.countBookingEvents(filter)`), `audit-read.service.ts` (`AuditReadService`), types
  `BookingEventsFilter`, `AuditEventView`; `AuditModule` provides and exports `AuditReadService`.
- `src/common/rate-limit/`: key `customerAndBookingRef` (`customer:<id>|booking:<REF>`, the address
  in place of the customer when nobody is signed in); `ticketEmail` uses it.
- `src/modules/customers/`: `customer-booking-count.registry.ts` (`CustomerBookingCountRegistry`),
  exported; `CustomerBookingCountSource` in `types.ts`; `CustomerProfileService.bookingCount()`;
  `CustomerProfileResponse.from(customer, bookingCount)` adds `bookingCount`.
- `src/common/swagger/swagger.constants.ts`: tag `My bookings`.

## Migration (prefix `0130`)

**`0130_01_add_audit_events_entity_index`**

```sql
CREATE INDEX idx_audit_events_entity_type_entity_id_occurred_at
  ON audit_events (entity_type, entity_id, occurred_at);
COMMENT ON INDEX idx_audit_events_entity_type_entity_id_occurred_at IS
  'A booking''s History, showtime branch: WHERE entity_type = ''showtime'' AND entity_id = ? AND action = ANY(?) AND occurred_at >= ? (U12). Also an entity''s own activity (U19).';
```

`down` drops the index. No table, column or constraint changes.

## Behaviour

**My Bookings** (`MyBookingsService.list`, no transaction; settlement already ran):

1. `toPageRequest(query, 'instant')` (a cursor of the wrong kind is `VALIDATION_FAILED`).
2. `now = Clock.now()`, read once and used for the page, the counts and every status.
3. `pageForCustomer()` and `tabCountsOfCustomer()`.
4. `BookingViews.ofMany(rows, now)`; each row's `status` from `bookingStatusOf()` (always one of
   the tab's statuses, by construction), `paymentStatus` from `paymentStatusOf()`.
5. `toPage(...)` with position `{ sortKey: starts_at.toISOString(), id }`, plus `tabCounts`.

**History** (`BookingHistoryService.list`): `findByReference(ref)`; missing or `customer_id` not the
caller → `404`. Then `AuditReadService.bookingEvents({ bookingId, bookingActions, showtimeId,
showtimeActions, showtimeFrom: confirmed_at, showtimeUntil: refunded_at }, page)`, the showtime
branch off for a booking never confirmed. One query and one count:

```sql
SELECT id, occurred_at, action FROM audit_events
WHERE ((booking_id = :booking_id AND action = ANY(:booking_actions))
    OR (entity_type = 'showtime' AND entity_id = :showtime_id AND action = ANY(:showtime_actions)
        AND occurred_at >= :from AND occurred_at < :until))      -- only when confirmed
  AND (occurred_at, id) > (:after_at, :after_id)               -- only with a cursor
ORDER BY occurred_at, id
LIMIT :limit_plus_one;
```

Each row maps through `toHistoryEvent()`.

**Email again** (`TicketDeliveryService.emailAgain`, the request transaction):

1. `findByReference(ref)`; missing or not the caller's → `404`, before any lock.
2. `BookingsRepository.lockForUpdate([id])`; its status under the lock against the showtime's
   `ends_at`; not `confirmed` or `completed` → `409 TICKET_NOT_AVAILABLE { status }`.
3. `CustomerService.findById(caller)`; null or no email (anonymised) → `401 UNAUTHENTICATED`.
4. `TicketsService.queueTickets([id], { sms: false, emailTo: customer.email })`.
5. `AuditService.record({ action: 'booking.tickets_resent', ... })`.
6. `201 { channel: 'email', queuedAt: now }`. The outbox drains after commit (U3).

**Lock order and concurrency** (§7.1). The two reads take no locks. Email again takes only step 5
(the booking), after U11's settlement has committed in its own transaction:

- **vs U14 refund / edit / showtime cancellation** (showtime `FOR UPDATE` → booking `FOR UPDATE`):
  Email again holds one lock and waits for nothing else, so no cycle. Refund first → Email again
  sees `refunded` → `409`. Email again first → the refund waits.
- **vs U11 settlement** (showtime `FOR SHARE` → booking `FOR UPDATE`): same reasoning; a booking
  only reaches `confirmed` there, and Email again then sees it.
- **Parallel Email again, same key**: the idempotency claim waits for the first commit and replays
  it: one message. **Distinct keys**: they serialize on the booking lock; each queues one message
  until the throttler refuses the 4th within the hour.

## Endpoints

All under `/api/v1`, `@ApiTags('My bookings')`, a summary, a description and
`@ApiErrorResponses(...)`. U1 documents access, idempotency and `429`.

| Route | Access | Idem. | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /me/bookings` | `@Customer()`, `@SettleFirst('customer')` | — | `MyBookingsQuery` (`tab` `upcoming` \| `past`, default `upcoming`; `cursor`; `limit` 1–100, default 20) | `200 MyBookingPage` | `VALIDATION_FAILED`, `UNAUTHENTICATED` |
| `GET /bookings/{ref}/history` | `@Customer()` (owner checked in the service), `@SettleFirst('booking')` | — | `BookingRefParams`, `PageQuery` | `200 BookingHistoryEventPage` | `VALIDATION_FAILED`, `UNAUTHENTICATED`, `NOT_FOUND` |
| `POST /bookings/{ref}/ticket-deliveries` | `@Customer()` (owner), `@RateLimit('ticketEmail')`, `@SettleFirst('booking')` | **S** | `BookingRefParams`, no body | `201 TicketDelivery` | `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `UNAUTHENTICATED`, `NOT_FOUND`, `TICKET_NOT_AVAILABLE`, `RATE_LIMITED` |
| `GET /bookings/{ref}` (U10/U11, extended) | unchanged | — | unchanged | `200 Booking` with the fields below | unchanged |
| `GET /me` · `PATCH /me` (U9, extended) | unchanged | — | unchanged | `CustomerProfileResponse` gains `bookingCount` | unchanged |

**Request DTO**: `MyBookingsQuery extends PageQuery`: `tab` `@IsOptional() @IsIn(MY_BOOKINGS_TABS)`,
Swagger enum with default `upcoming`. An unknown query field is `VALIDATION_FAILED` (global pipe).

**Response DTOs** (times `formatCairoIso`, money `MoneyResponse`):

- `MyBookingResponse` (schema `MyBooking`): `reference`; `status` (`confirmed`, `completed`,
  `refunded`, `failed` of the `BookingStatus` enum); `paymentStatus`; `channel`; `showtime`
  (`BookingShowtime`); `seatLabels` (seat order); `seatCount`; `total`; `payment` (`Payment \| null`,
  the latest sale charge: "Visa •••• 4242"); `confirmedAt` (`\| null`); `refund`
  (`BookingRefund \| null`).
- `MyBookingPageResponse` (schema `MyBookingPage`): `items`, `nextCursor`, `total` (this tab),
  `tabCounts` (`MyBookingTabCounts { upcoming, past }`).
- `BookingHistoryEventResponse` (schema `BookingHistoryEvent`): `kind` (`BOOKING_HISTORY_KINDS`),
  `label` ("Seats held", "Payment received", "Refunded", "Changed by the cinema", "Tickets
  resent"), `occurredAt`. Page schema `BookingHistoryEventPage`.
- `TicketDeliveryResponse` (schema `TicketDelivery`): `channel` (`email`), `queuedAt`.
- `SeatLineResponse` (schema `SeatLine`): `zone`, `labels`, `count`, `unitPrice`, `amount`.
- `BookingRefundResponse` (schema `BookingRefund`): `amount`, `refundedAt`.
- `BookingTheaterResponse` (schema `BookingTheater`): `id`, `name`, `address`, `district`, `city`,
  `latitude`, `longitude`. Replaces `NamedRef` for `BookingShowtime.theater`.
- `Booking` gains `seatLines` and `refund` (`\| null`).
- `CustomerProfileResponse` gains `bookingCount` (integer ≥ 0).

**Error shapes**: `TICKET_NOT_AVAILABLE { status }` (U11). No new codes.

## Services

**Added in `bookings`** (module-internal):

```ts
class MyBookingsService {
  list(customerId: number, query: MyBookingsQueryInput): Promise<MyBookingsPage>;
}
// MyBookingsQueryInput = { tab: 'upcoming' | 'past'; cursor?: string; limit?: number }
// MyBookingsPage = Page<Booking> & { tabCounts: { upcoming: number; past: number } }

class BookingHistoryService {
  list(reference: string, customerId: number, query: PageQueryInput): Promise<Page<BookingHistoryEvent>>;
}
// BookingHistoryEvent = { kind: BookingHistoryKind; label: string; occurredAt: Date }

class TicketDeliveryService {
  emailAgain(reference: string, customerId: number): Promise<TicketDelivery>;   // request transaction
}
// TicketDelivery = { channel: 'email'; queuedAt: Date }
```

Exported by path for U14 (it writes the same action names): `TICKETS_RESENT_ACTION`,
`HISTORY_BOOKING_ACTIONS`, `seatLinesOf()`.

**Added to other modules and to U11's services**:

```ts
// common/audit (exported by the global AuditModule)
class AuditReadService {
  bookingEvents(filter: BookingEventsFilter, page: PageRequest): Promise<{ rows: readonly AuditEventView[]; total: number }>;
}
// BookingEventsFilter = { bookingId: number; bookingActions: readonly string[];
//   showtime: { id: number; actions: readonly string[]; from: Date; until: Date | null } | null }
// AuditEventView = { id: number; occurredAt: Date; action: string }

// bookings (U11)
TicketsService.queueTickets(bookingIds: readonly number[], options: { sms: boolean; emailTo?: string }): Promise<void>;
SettleFirst(kind: 'booking' | 'showtime' | 'customer'): MethodDecorator;
BookingViews.ofMany(rows: readonly BookingRow[], now: Date): Promise<readonly Booking[]>;   // fixed query count
BookingShowtimeService.headersOf(showtimeIds: readonly number[]): Promise<ReadonlyMap<number, BookingShowtime>>;

// customers (U9, exported by CustomersModule)
class CustomerBookingCountRegistry {
  register(source: CustomerBookingCountSource): void;   // INTERNAL on a second registration
  countFor(customerId: number): Promise<number>;          // 0 with no source
}
// CustomerBookingCountSource = { countFor(customerId: number): Promise<number> }
```

**Consumed** (exact names): U11 `SettlementService` (through `SettleFirstInterceptor`),
`TicketsService.queueTickets()`, `PaymentsService.latestSalesOf()`, `paymentStatusOf()`,
`toPaymentResponse()`, `TICKET_STATUSES`, `hasTicket()`; U10 `BookingsRepository`
(`findByReference`, `lockForUpdate`, `seatsOf`), `BookingViews`, `bookingStatusOf()`,
`bookingStatusPredicate()`, `BookingRefParams`, `BookingResponse`, `BookingShowtimeResponse`; U9
`CustomerService.findById()`, `CustomerProfileService`, `CustomerProfileResponse`; U7
`ShowtimeReadService.findById()` / `.findByIds()`; U6 `CatalogReadService.findMoviesByIds()`; U4b
`TheaterReadService.findByIds()`; U4a `MediaService.toImageResponse()`; U1 `Customer()`,
`CurrentPrincipal()`, `Strict()`, `RateLimit()`, `AuditService.record()`, `Clock`,
`formatCairoIso()`, `PageQuery`, `toPageRequest()`, `toPage()`, `MoneyResponse`, `AppError`,
`ApiErrorResponses()`, `REQUEST_ID_RESPONSE_HEADER`. Tests: `customerHold()`, `pay()` (U11),
`bookableShowtime()`, `expectHold()`, `SMALL_LAYOUT` (U10), `createSchedulingFixture()`,
`scheduleShowtime()`, `cancelShowtime()` (U7), `registerCustomer()` (U9), `staffSession()`,
`listHttpRoutes()` (U2a), `RecordingEmailSender` (U3), `TestClock`, `buildTestConfig()`.

## Tests

**Unit** (`test/unit/…` mirroring `src/`; collaborators mocked, a fixed clock):

- `modules/bookings/booking-history.test.ts`: each mapped action → its kind and label; every hidden
  action and an unknown one → `null`.
- `modules/bookings/seat-lines.test.ts`: grouping by zone and price, zone order front → middle →
  back, labels in seat order (`F2` before `F10`), `count × unitPrice = amount`, one zone at two
  prices → two lines.
- `modules/bookings/my-bookings.sql.test.ts`: the predicate per tab names the §7.4 conditions, binds
  `now` once per condition, never matches live holds or Abandoned.
- `modules/bookings/my-bookings.service.test.ts`: `now` read once and passed to the page, the
  counts and the views; `nextCursor` from the last row's `starts_at` (with milliseconds) and id; a
  cursor of the wrong kind → `VALIDATION_FAILED` with no query; a datastore outage → `503`.
- `modules/bookings/booking-history.service.test.ts`: not the owner → `404` with no audit read;
  the filter for a confirmed, a refunded and a never-confirmed booking; unknown actions dropped.
- `modules/bookings/ticket-delivery.service.test.ts`: call order (find → lock → customer → queue →
  audit); not the owner → `404` with no lock; each non-ticket status → `409 { status }` with
  nothing queued; `queueTickets([id], { sms: false, emailTo })`; an anonymised customer → `401`.
- `modules/bookings/settle-first.interceptor.test.ts` (extended): `'customer'` → `{ customerId }`;
  a staff principal or none → no settlement.
- `modules/customers/customer-booking-count.registry.test.ts`: `0` without a source; delegates once
  registered; a second `register` → `INTERNAL`.
- `common/audit/audit-read.service.test.ts`: passes the filter and page through and returns rows
  with the total.
- `common/rate-limit/trackers.test.ts` (extended): `customerAndBookingRef` for a customer and for
  an anonymous caller.

**Integration** (`test/integration/…`; real app, real Postgres, `TestClock`, `RecordingEmailSender`
at the email boundary; nothing of ours mocked):

- `modules/bookings/my-bookings.controller.test.ts`:
  - one customer with a confirmed booking, a refunded one, a failed one, an abandoned hold and a
    live hold: Upcoming lists only the confirmed one (`paymentStatus paid`, `payment.card visa
    4242`); Past lists refunded (`refund`) and failed; abandoned and live holds appear in neither;
    `total` and `tabCounts` match;
  - at `endsAt − 1 ms` the booking is Upcoming `confirmed`; at `endsAt` it is Past `completed`, with
    no write in between;
  - **cinema day**: a theater open until 03:00, showtimes at 23:00 and 00:30 of one cinema date: the
    00:30 row's `cinemaDate` is the previous calendar date, Upcoming orders the 23:00 show first,
    and at 00:45 the 00:30 show is still Upcoming while the 23:00 one is Completed;
  - a `sim_card_slow` payment left past `settlesAt`: the list settles it first and shows it in
    Upcoming as `confirmed`;
  - ordering and pages: 12 confirmed bookings → `limit=5` pages of 5, 5, 2 in start order (Past
    descending once ended), no duplicates or gaps, `nextCursor` null on the last; a tampered cursor
    and `tab=later` → `400`;
  - the same number of queries for a page of 1 and of 12;
  - another customer sees none of these; no token → `401`; a staff token → `401`;
    `Cache-Control: private, no-store`.
- `modules/bookings/bookings.controller.test.ts` (details): `seatLines` for a two-zone booking;
  `showtime.theater` with the address and coordinates; a refunded booking has `refund { amount =
  total, refundedAt }`, a confirmed one `refund: null`; another customer → `404`.
- `modules/bookings/booking-history.controller.test.ts`: a guest hold claimed after sign-in, a
  decline, then a success, then Email again: `seats_held`, `payment_received`, `tickets_resent` in
  that order; a U7 move after confirmation adds `changed_by_cinema`, a move of a booking not yet
  confirmed and a move of another showtime do not; refunded → `refunded`; paging with `limit=1`;
  another customer → `404`; no token and a staff token → `401`.
- `modules/bookings/ticket-deliveries.controller.test.ts` (a test app with
  `RATE_LIMIT_TICKET_EMAIL=3/1h`): `201 { channel: 'email' }`; exactly one new `booking.tickets`
  message to the account email with `related_booking_id` and `related_customer_id`, no SMS although
  the customer has a phone; the email sent after the response with the `/ticket?token=` link and the
  stored copy redacted; one `booking.tickets_resent` audit row; a contact email changed by SQL (as a
  U14 edit will) does not redirect it; the same key again → `201` replayed, no new message; 5
  parallel requests with one key → one message; three distinct keys → three messages, the 4th →
  `429` with `Retry-After` and no message; another customer's attempts do not spend the owner's
  limit; held, failed, abandoned and refunded → `409 TICKET_NOT_AVAILABLE { status }`, no message;
  completed → `201`; another customer → `404`; no key → `400 IDEMPOTENCY_KEY_REQUIRED`; malformed
  reference → `400`; no token → `401`.
- `modules/customers/me.controller.test.ts` (extended): `bookingCount` 0 for a new customer; 2
  after two confirmed bookings; unchanged by a live hold.
- `modules/bookings/dto/my-bookings-contract.test.ts`: the 3 routes as `customer`, their tag, prose,
  errors and security, the schemas `MyBooking`, `MyBookingPage`, `BookingHistoryEvent`,
  `BookingHistoryEventPage`, `TicketDelivery`, `SeatLine`, `BookingRefund`, `BookingTheater`, and
  the new `Booking` and `CustomerProfileResponse` fields.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (nonzero passes, no failures, no skips),
  `npm run build`, `npm run contract` with no diff left, and a clean `git status`.
- The tests above pass against real Postgres and prove issue #13:
  - Upcoming and Past split by the `Clock` against the showtime's end, with the cinema date on each
    row and a past-midnight show handled by its cinema day;
  - every status is derived from stored timestamps (`completed` at `endsAt`, `failed` after a
    declined hold ends, abandoned never listed), and a due slow payment is settled before the read;
  - another customer gets `404` on details, history and Email again, and sees nothing in the list;
  - Email again queues exactly one tickets email per idempotent request, to the account email,
    without SMS, and the 4th request in an hour is `429`.
- `docs/system-design.md` updated: §5 (`common/audit` has a read side; customers' booking-count
  registry); §10.6 (Email again keyed by booking and customer); §11 (`GET /bookings/{ref}/history`,
  My Bookings tabs, order and counts, Email again's `201`); §13.5 (the History mapping).

## Follow-ups

- **U13**: counter payments write `payment.succeeded` with `bookingId`, so History shows "Payment
  received" for them.
- **U14**: `booking.refunded` per booking on cancel and on the showtime-cancellation fan-out,
  `booking.edited` on edits, and the staff resend writes `booking.tickets_resent` and calls
  `queueTickets([id], { sms: true })`. An edit that moves a booking to another showtime should make
  History stop counting moves of the old showtime (today it reads moves of the current one from
  `confirmed_at`).
- **U16**: the SQL form of the payment status.
- **U19**: `idx_audit_events_entity_type_entity_id_occurred_at` serves an entity's own activity.
- **Product**: whether declined payments and the entrance check-in should join History (open
  question 3).
- **Docs (adjacent, not fixed here)**: `API_TAGS` lists none of the U10/U11 tags (`Seats and
  holds`, `Checkout`, `Tickets`), so Swagger UI shows them after the listed ones.
