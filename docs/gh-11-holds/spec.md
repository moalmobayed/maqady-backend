---
title: U10 — Holds and live seat map - seat claims, holds, availability, WebSocket gateway
owner: Mohamed Tarek
status: In progress
last_verified: 2026-10-20
tags: [holds, seat-claims, lock-order, concurrency, hold-code, availability, websocket, seat-map, hold-refusals, bookings]
---

# U10 — Holds and live seat map: seat claims, holds, availability, WebSocket gateway

Issue: #11. Docs folder: `docs/gh-11-holds/`. Migration prefix `0110`. Depends on U7
(`ShowtimeReadService`, the `ShowtimeSeatClaimService` seam, `test/support/showtimes.ts`) and U9
(`CustomerService`, the customer resolver, `test/support/customer-auth.ts`), and through them U5
(`HallReadService`, `layoutSeats()`), U6 (`CatalogReadService`), U4b (`TheaterReadService`), U3,
U2a and U1. Design: `docs/system-design.md` §5, §6.1, §6.2 (`bookings`, `booking_seats`,
`seat_claims`, `hold_refusals`), §6.3, §7.1–§7.4, §7.9 (reference), §7.10, §10.3–§10.6, §11, §12,
§14; PRD v2 "Seats and holds" 1–7, "Prices" 1–3, C6, C7, "Live seat map", "Frontend integration
contract".

## Goal

A guest or a signed-in customer picks up to 8 seats on a showtime's live map and holds them for
5 minutes. Postgres guarantees that each seat has at most one live claim, also under a burst of
concurrent holds. A seat whose hold ran out is free the moment the `Clock` passes its stored
expiry, with no job running. A guest gets a hold code once. Signing in claims the hold with that
code, and nobody else can see the hold at all (`404`). Everyone viewing the map gets
`seat.held` / `seat.released` over a plain WebSocket, sent only after the transaction that caused
them commits.

## Scope

- Migrations `0110_01`–`0110_05`: `bookings`, `booking_seats`, `seat_claims`, `hold_refusals`, and
  the deferred `bookings` FKs on `audit_events` and `messages`.
- `src/modules/seating/` (`SeatingModule`): seat-claim writes (the §7.2 upsert, extended to
  release in the same ordered statement), the availability snapshot, `hold_refusals`, the
  in-process seat event bus and after-commit publisher, the `/ws` gateway.
- `src/modules/bookings/` (`BookingsModule`): holds (create, claim, release), the single-file
  clock-derived statuses (`booking-status.sql.ts`), booking references, 6 public routes, audit
  events, complete Swagger.
- U7's `ShowtimeSeatClaimService` seam rebound to seating's live claims, which makes
  `HALL_IN_USE` fire for real. `ShowtimeReadService.lockForShare()` is added to U7's module.
- `TransactionRepository.afterRollback()` (U1's `common/database`), for the refusal row.
- WebSocket config (`WS_CONNECTIONS_PER_IP`, `WS_SUBSCRIPTIONS_PER_CONNECTION`), the `WsAdapter`
  in `configureApp()`, and the dependencies `@nestjs/websockets`, `@nestjs/platform-ws` (both
  `11.2.7`, like `@nestjs/core`) and `ws`, pinned to the version `@nestjs/platform-ws@11.2.7`
  resolves, with `@types/ws` as a dev dependency.
- `docs/system-design.md` §5, §6.2, §7.2, §7.3, §12 and §14.1 updated (Decisions below); README
  "Live seat map" section; `docs/INDEX.md`.

## Out of scope

- Payments, settlement, confirmation, `seat.booked`, hold extension (U11). U11 adds two things to
  `HoldsService`: the "settle due payments first" call (§7.1 step 1) and the `PAYMENT_IN_PROGRESS`
  refusal when releasing a hold that has a processing charge. Until then nothing can be
  processing, so both are no-ops.
- `ShowtimeTicketHolderService` (U7's move notifications). Only confirmed bookings hold tickets,
  and U11 creates the first ones, so U11 rebinds it.
- Counter holds and the staff hold owner (U13). `bookings.channel` / `created_by_staff_id` and
  their CHECK exist now. `HoldHolder` gets a `staff` kind in U13.
- Owner reads of confirmed bookings beyond `GET /bookings/{ref}`, My Bookings and History (U12).
  Refunds and edits deleting claims (U14).
- "Sold out" on discovery chips (U8b): it reads `SeatAvailabilityService.takenCounts()`.

## Decisions taken here

| Decision | Why |
|---|---|
| **Release expires claims instead of deleting them**: `claimed_until = :now`, `booking_id` kept. Refunds and edits (U14) still delete | An expired claim is already free under §7.2 (taken over, absent from the snapshot). Expiring lets a release and a new claim on the same showtime run as **one** ordered upsert. A `DELETE` followed by an `INSERT` would lock some labels out of order and could deadlock against a rival hold. |
| **Every claim write is one `INSERT … ON CONFLICT` per showtime**, rows sorted by label. With several showtimes (a re-pick across showtimes), one statement per showtime, in showtime id order | Keeps §7.1 step 6 literally true, including the rows an `ON CONFLICT` locks when its `WHERE` fails. |
| The upsert takes over a row when it is expired **or** belongs to a booking this transaction is releasing (and holds `FOR UPDATE`) | Re-picking an overlapping set of seats keeps the overlap in the same statement. |
| `SEAT_TAKEN` → the request transaction rolls back. A `TransactionRepository.afterRollback()` hook then writes `hold_refusals` in its own transaction | Design §7.2 "a separate small transaction". A second pool connection *inside* the request would starve the 5-connection pool under a burst. |
| Bookability, in order of precedence: `cancelled`, `started` (`starts_at <= now`), `sales_paused` (theater), `movie_unavailable` (movie not `now_showing`), `hall_unavailable` (hall not `active`) → `409 SHOWTIME_NOT_BOOKABLE { reason }` | Design §7.3 step 2–3. One reason per refusal, so the UI shows one message. |
| Visibility: `GET /showtimes/{id}`, `/seats` and holds answer `404` only for an unknown showtime or a `draft` theater. Otherwise `200` with `bookable` and `notBookableReason` | A customer already on the map when sales pause or the showtime starts gets a reason, not a dead page. A draft theater is unpublished, so it stays invisible (U8a). |
| `hold_expires_at = min(now + 5 min, starts_at)`. A claim never changes it | §7.3 step 5. PRD Seats 2: "signing in does not restart it". |
| One live online hold per customer. A new hold releases the customer's live hold, and also the live unowned hold whose code `X-Hold-Token` presents. A guest releases only the hold its code presents | §7.3 step 4, PRD Seats 4. |
| A guest's hold code is `randomToken()` (32 bytes, base64url, 43 characters). Only `sha256Hex` is stored, in `hold_token_hash`, UNIQUE where not NULL. The code is returned once, in the `201` (encrypted at rest in the idempotency row, §14.1) | §7.3 step 7. The hash is the lookup key for "release the hold this browser presents". |
| Code checks compare `sha256Hex(code)` with `safeEqual`. A missing, malformed (`^[A-Za-z0-9_-]{43}$`) or wrong code reads as no code | §10.4. Anyone else gets `404`, never `403`. |
| `POST /holds/{ref}/claims`: a missing `X-Hold-Token` → `400 VALIDATION_FAILED` (field `X-Hold-Token`). A wrong code → `404`. A matching code on an ended hold → `409 HOLD_EXPIRED`. A hold already owned by the caller → `201` again, without needing the code | Claiming clears the hash (§7.3), so a second tab's claim can't re-prove the code. Ownership proves it. `HOLD_ALREADY_CLAIMED` is unused: a hold owned by someone else reads as `404`. |
| `DELETE /holds/{ref}`: owner or code holder. An already-ended hold → `204` with no change. `confirmed` / `refunded` → `409 ALREADY_PAID` | A `DELETE` is idempotent, and a paid booking is never released by its customer (PRD Cancellations 1). |
| `GET /bookings/{ref}`: the owner (any status), or a valid code while the hold is live and unowned; anyone else `404` | §11 "Owner, or Guest with the hold code while held". U12 widens nothing: owners already see everything. |
| A customer becoming the owner (by creating or claiming) copies their name, email and phone into the booking's contact fields. Guest holds have none | The checkout summary and the box office search have a contact without a join. U15's anonymisation nulls them. |
| Seats are labels such as `F7` (`^[A-HJ-P]([1-9]\|1[0-9]\|20)$`), 1–8 of them, unique. A label outside the hall's layout, or on a `no_seat` gap → `400 VALIDATION_FAILED` on `seats.<i>` | Shape in the DTO. The layout check runs under the hall lock, because only then is the layout fixed. |
| Prices come from the showtime's zone prices, read under its `FOR SHARE` lock, and are snapshotted per seat in `booking_seats.price`. `total_amount` is their sum | §7.10, PRD Prices 3. A price change (U7, `FOR UPDATE`) waits for the hold or applies to the next one. |
| Audit, in the write's transaction: `booking.held`, `booking.claimed`, `booking.released`, with `bookingId` so U12's History shows them. Actor: the acting customer, else `system` for a guest, with `metadata.holder` `guest` or `customer` | PRD C11 "History from real events: seats held". No personal data, and no metadata key containing `token`. See open question 3. |
| No `has_bookings` movie deletion blocker | A booking always belongs to a showtime of the movie, showtimes are never deleted, and U7's `has_showtimes` already refuses deleting a movie that ever had one; `fk_bookings_showtime_id` is the database backstop. A second blocker would answer the same, one query later. |
| The gateway checks no showtime: `subscribe` to any positive integer id answers its snapshot (empty for an unknown id) | Seat labels are public. Seating then depends on no feature module (design §5). |
| WebSocket admission: an `Origin` that is missing or not in `CORS_ORIGINS` → `error { code: 'FORBIDDEN' }` and close `1008`. Beyond `WS_CONNECTIONS_PER_IP` (default 20) open connections → `error { code: 'RATE_LIMITED' }` and close `1013`. A subscription beyond `WS_SUBSCRIPTIONS_PER_CONNECTION` (default 3) → `error { code: 'RATE_LIMITED' }`, connection kept. An invalid `showtimeId` → `error { code: 'VALIDATION_FAILED' }`. Unparseable or unknown messages are ignored (Nest's `WsAdapter`) | Design §10.6 and §12. The client address is the rightmost `X-Forwarded-For` entry, else the socket address: one trusted hop, like Express's `trust proxy 1`. |
| A new subscription buffers seat events until its snapshot is sent, then flushes them in order. Events are idempotent state sets | Register-then-read means the snapshot misses nothing, and the buffer means no event is overtaken by an older snapshot. |
| `Cache-Control: no-store` on `GET /showtimes/{id}` and `/seats` | Prices and bookability change. The map is live, unlike U8a's 60-second discovery reads. |
| `takenCounts()` and `available = seatCapacity − taken`: a live claim always sits on a seat of the current layout, because a layout with live claims can't be saved | U7 refreshes `seat_capacity` on a layout save. |

## Open questions decided

1. **Seat page visibility.** `GET /showtimes/{id}` and `/seats` answer `200` with `bookable: false`
   and a reason for a cancelled or started showtime and for a theater whose sales are paused; only
   an unknown id or a draft theater is `404`. Design §11 lists these routes as public reads of the
   seat page, not discovery lists: U8a hides paused theaters from what it lists and from its own
   theater page, so nobody is sent to such a showtime, but a customer already on the map (another
   tab, a link, the seconds between "pause" and their "Continue") is told why instead of seeing a
   dead page. Nothing private is shown: the theater was public until it paused. A hold on any of
   them is still refused (`409 SHOWTIME_NOT_BOOKABLE { reason }`).
2. **One live online hold per customer, across showtimes.** A new hold releases the customer's
   earlier live hold on any showtime. Design §7.3 step 4 releases "that principal's previous live
   hold", PRD Seats 2 limits a hold to 8 seats (several holds would bypass it), and PRD Seats 4
   says picking new seats replaces the previous hold. A second tab therefore replaces the first
   tab's hold; the first tab learns it from `seat.released` and its own `GET /bookings/{ref}`
   (`abandoned`).
3. **Guest audit actor.** Guest holds are recorded with actor `system` (the only actor kind
   without an account row; `audit_events.actor_kind` stays as U1 defined it) plus
   `metadata.holder: 'guest'`, so the Activity log (U19) and History (U12) can show "Guest"
   rather than "System". Once claimed, the booking's later events have the customer as actor.

## Modules and files

**`src/modules/seating/`**: `SeatingModule`. It imports nothing beyond the global modules.
Providers: `SeatClaimsRepository`, `HoldRefusalsRepository`, `SeatClaimService`,
`SeatAvailabilityService`, `HoldRefusalService`, `SeatEventBus`, `SeatEventPublisher`,
`SeatMapConnections`, `SeatMapGateway`. Exports `SeatClaimService`, `SeatAvailabilityService`,
`HoldRefusalService` and `SeatEventPublisher`.

| File | Holds |
|---|---|
| `enums.ts` | `SEAT_STATES = ['held','booked']`, `SEAT_EVENT_TYPES = ['seat.held','seat.released','seat.booked']`, `SEAT_MAP_ERROR_CODES = ['VALIDATION_FAILED','RATE_LIMITED','FORBIDDEN']` |
| `types.ts` | `SeatClaimRow`, `ClaimWriteRow` (`{ label, bookingId, claimedUntil }`), `ClaimPlan`, `ReleasedClaims`, `ClaimOutcome`, `SeatState`, `SeatSnapshot`, `SeatEvent` (union), `SeatEventListener`, `SeatMapClientState`, `OutboundSeatMapMessage` |
| `seating.constants.ts` | `SEAT_MAP_PATH = '/ws'`, `SEAT_MAP_MAX_PAYLOAD_BYTES = 4096`, `SEAT_MAP_PING_INTERVAL_MS = 30_000`, `SEAT_LABEL_PATTERN`, close codes `1008` / `1013` |
| `claim-plan.ts` | pure: `claimStatements(plan)` → per-showtime `{ showtimeId, rows: ClaimWriteRow[] (sorted, unique), takeOverFrom: number[] }`, ordered by showtime id; new seats win over released ones on the same label |
| `seat-claims.repository.ts` | `upsert(showtimeId, rows, takeOverFrom, now)` (the one statement below), `live(showtimeId, now)`, `takenCounts(showtimeIds, now)`, `showtimeIdsWithLive(showtimeIds, now)` |
| `hold-refusals.repository.ts` | `insert({ showtime_id, refused_at, seat_count })` |
| `seat-claim.service.ts` | `SeatClaimService.write(plan)` |
| `seat-availability.service.ts` | `snapshot`, `takenCounts`, `showtimeIdsWithLiveClaims` |
| `hold-refusal.service.ts` | `recordAfterRollback(showtimeId, seatCount)` |
| `seat-event.bus.ts` | `SeatEventBus`: `publish(event)`, `subscribe(listener) → () => void` (in-process, synchronous fan-out, a throwing listener is logged) |
| `seat-event.publisher.ts` | `SeatEventPublisher.publishAfterCommit(event)` → `TransactionRepository.afterCommit(() => bus.publish(event))` |
| `seat-map.messages.ts` | pure: `parseShowtimeId(data)`, `snapshotMessage(snapshot)`, `eventMessage(event)`, `errorMessage(code)` (times `formatCairoIso`) |
| `client-address.ts` | pure: `clientAddressOf(request: IncomingMessage)` |
| `seat-map.connections.ts` | `SeatMapConnections`: per-IP counts, per-client subscriptions with their pending buffers, liveness flags |
| `seat-map.gateway.ts` | `SeatMapGateway` (`@WebSocketGateway({ path: SEAT_MAP_PATH, maxPayload: SEAT_MAP_MAX_PAYLOAD_BYTES })`, `@Public()`): `handleConnection`, `handleDisconnect`, `@SubscribeMessage('subscribe')`, `@SubscribeMessage('unsubscribe')`, `onModuleInit` (bus subscription and an `unref()`'d ping interval), `onModuleDestroy`, `sweepConnections()` (the interval body, public for tests) |
| `seating.module.ts` | the module |

**`src/modules/bookings/`**: `BookingsModule`. It imports `ShowtimesModule`, `HallsModule`,
`CatalogModule`, `TheatersModule`, `CustomersModule`, `SeatingModule` and `MediaModule` (for
posters). Providers: `BookingsRepository`, `HoldsService`, `BookingReadService`,
`ShowtimeSeatMapService`. Exports `HoldsService` and `BookingReadService` (U11–U14).
`AppModule` imports `SeatingModule`, then `BookingsModule`, after `ShowtimesModule`.

| File | Holds |
|---|---|
| `enums.ts` | `BOOKING_STATUSES = ['held','confirmed','refunded']` (stored), `BOOKING_DISPLAY_STATUSES = ['held','failed','abandoned','confirmed','completed','refunded']`, `BOOKING_CHANNELS = ['online','counter']`, `NOT_BOOKABLE_REASONS = ['cancelled','started','sales_paused','movie_unavailable','hall_unavailable']`, `HOLD_OWNERS = ['guest','customer']` |
| `types.ts` | `BookingRow`, `NewBookingRow`, `BookingSeatRow`, `BookingStatus`, `BookingDisplayStatus`, `BookingChannel`, `NotBookableReason`, `HoldHolder`, `CreateHoldInput`, `HoldAccess`, `Booking` (domain, seats included), `CreatedHold` (`Booking` + `holdCode`), `BookingShowtime` (header), `ShowtimeSeatMap`, `SeatMapAvailability`, `BookingStatusInput` |
| `bookings.constants.ts` | `HOLD_MINUTES = 5`, `MAX_SEATS_PER_HOLD = 8`, `REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'`, `REFERENCE_LENGTH = 6`, `REFERENCE_DRAWS = 5`, `HOLD_TOKEN_HEADER = 'x-hold-token'`, `HOLD_CODE_PATTERN`, `REFERENCE_PATTERN = /^MQ-[2-9A-HJKMNP-Z]{6}$/` |
| `booking-reference.ts` | pure: `drawReference()` (`crypto.randomInt`) |
| `booking-status.sql.ts` | **the one owner of §7.4**: `bookingStatusOf(input, now)` and the SQL predicates `heldLiveSql(alias)`, `failedSql`, `abandonedSql`, `confirmedSql`, `completedSql` (Knex raw with a `now` binding) that U12/U14/U17 lists reuse |
| `bookability.ts` | pure: `notBookableReason({ showtime, theaterStatus, movieStatus, hallStatus }, now)` |
| `hold-code.ts` | pure: `newHoldCode()` → `{ code, hash }`, `holdCodeMatches(code \| undefined, hash \| null)` |
| `bookings.repository.ts` | `insertWithReference(row)` (`ON CONFLICT (reference) DO NOTHING RETURNING id`, up to 5 draws), `insertSeats(rows)` (one multi-row insert), `findByReference(ref)`, `findLiveUnownedByHoldHash(hash, now)`, `findLiveHeldIdsOfCustomer(customerId, now)`, `lockForUpdate(ids)` (`ORDER BY id FOR UPDATE`), `seatsOf(bookingIds)`, `expireHolds(ids, now)`, `assignCustomer(id, customer, now)` |
| `holds.service.ts` | `HoldsService`: `create`, `claim`, `release` |
| `booking-read.service.ts` | `BookingReadService.get(ref, access)` |
| `showtime-seat-map.service.ts` | `ShowtimeSeatMapService`: `header(showtimeId)`, `seats(showtimeId)` |
| `hold-token.decorator.ts` | `@HoldToken()`: the `X-Hold-Token` header as `string \| undefined` |
| `booking-response.mapper.ts` | `toBookingResponse`, `toHoldResponse`, `toPublicShowtimeResponse`, `toSeatSnapshotResponse` |
| `public-showtimes.controller.ts` | `@Controller('showtimes')`: `GET :id`, `GET :id/seats`, `POST :id/holds` |
| `holds.controller.ts` | `@Controller('holds')`: `POST :ref/claims`, `DELETE :ref` |
| `bookings.controller.ts` | `@Controller('bookings')`: `GET :ref` |
| `dto/` | requests: `showtime-id.params.ts`, `booking-ref.params.ts`, `create-hold.request.ts`; responses: `booking-seat.response.ts`, `booking-showtime.response.ts` (`BookingShowtimeResponse`, `ShowtimeMovieResponse`, `NamedRefResponse`), `booking.response.ts`, `hold.response.ts`, `public-showtime.response.ts`, `seat-snapshot.response.ts` (`SeatSnapshotResponse`, `SeatStateResponse`) |
| `bookings.module.ts` | the module |

**Changed elsewhere**:

- `src/modules/showtimes/showtimes.module.ts`: imports `SeatingModule` and binds
  `{ provide: ShowtimeSeatClaimService, useExisting: SeatAvailabilityService }`. `NoSeatClaims`
  is deleted.
- `src/modules/showtimes/showtime-read.service.ts`: `lockForShare(id)`, through
  `ShowtimesRepository.findByIdForShare`.
- `src/common/database/transaction.repository.ts` and `types.ts`: `afterRollback(hook)`, with
  `TransactionState.rollbackHooks`.
- `src/app.setup.ts`: `app.useWebSocketAdapter(new WsAdapter(app))`.
- `src/common/config/*`: the two WebSocket limits, as `AppConfig.seatMap`. `.env.example`.

## Migrations (prefix `0110`)

Row-level security is enabled on every new table. There are no defaults: times come from the
`Clock`, and booleans are written by the service.

**`0110_01_create_bookings`**

```sql
CREATE TABLE bookings (
  id BIGSERIAL PRIMARY KEY,
  reference VARCHAR(9) NOT NULL,
  showtime_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL,
  channel VARCHAR(16) NOT NULL,
  customer_id BIGINT NULL,
  created_by_staff_id BIGINT NULL,
  hold_token_hash VARCHAR(64) NULL,
  hold_expires_at TIMESTAMPTZ NOT NULL,
  has_declined_payment BOOLEAN NOT NULL,
  seat_count SMALLINT NOT NULL,
  total_amount INT NOT NULL,
  currency VARCHAR(3) NOT NULL,
  contact_name VARCHAR(100) NULL,
  contact_email CITEXT NULL,
  contact_phone VARCHAR(16) NULL,
  confirmed_at TIMESTAMPTZ NULL,
  refunded_at TIMESTAMPTZ NULL,
  qr_version SMALLINT NULL,
  checked_in_at TIMESTAMPTZ NULL,
  checked_in_by_staff_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_bookings_reference UNIQUE (reference),
  CONSTRAINT uq_bookings_id_showtime_id UNIQUE (id, showtime_id),
  CONSTRAINT fk_bookings_showtime_id FOREIGN KEY (showtime_id) REFERENCES showtimes (id),
  CONSTRAINT fk_bookings_customer_id FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_bookings_created_by_staff_id FOREIGN KEY (created_by_staff_id) REFERENCES staff_users (id),
  CONSTRAINT fk_bookings_checked_in_by_staff_id FOREIGN KEY (checked_in_by_staff_id) REFERENCES staff_users (id),
  CONSTRAINT chk_bookings_reference CHECK (reference ~ '^MQ-[2-9A-HJKMNP-Z]{6}$'),
  CONSTRAINT chk_bookings_status CHECK (status IN ('held', 'confirmed', 'refunded')),
  CONSTRAINT chk_bookings_channel CHECK (channel IN ('online', 'counter')),
  CONSTRAINT chk_bookings_channel_staff CHECK ((channel = 'counter') = (created_by_staff_id IS NOT NULL)),
  CONSTRAINT chk_bookings_hold_token_hash CHECK (hold_token_hash IS NULL OR
    (hold_token_hash ~ '^[0-9a-f]{64}$' AND customer_id IS NULL AND channel = 'online' AND status = 'held')),
  CONSTRAINT chk_bookings_seat_count CHECK (seat_count BETWEEN 1 AND 8),
  CONSTRAINT chk_bookings_total_amount CHECK (total_amount > 0),
  CONSTRAINT chk_bookings_currency CHECK (currency IN ('EGP')),
  CONSTRAINT chk_bookings_lifecycle CHECK (
    (status = 'held' AND confirmed_at IS NULL AND refunded_at IS NULL AND qr_version IS NULL)
    OR (status = 'confirmed' AND confirmed_at IS NOT NULL AND refunded_at IS NULL AND qr_version >= 1)
    OR (status = 'refunded' AND confirmed_at IS NOT NULL AND refunded_at IS NOT NULL AND qr_version >= 1)),
  CONSTRAINT chk_bookings_check_in CHECK ((checked_in_at IS NULL) = (checked_in_by_staff_id IS NULL))
);
```

| Index | Query it serves |
|---|---|
| `uq_bookings_reference` | Every `/{ref}` route: `WHERE reference = ?` |
| `uq_bookings_id_showtime_id` | Target of `fk_seat_claims_booking_id_showtime_id` |
| `idx_bookings_showtime_id_status (showtime_id, status)` | Covers `fk_bookings_showtime_id`. A showtime's bookings by status (U11 ticket holders, U14 cancellation) |
| `idx_bookings_customer_id_status_hold_expires_at (customer_id, status, hold_expires_at)` | Covers `fk_bookings_customer_id`. "The customer's live hold": `customer_id = ? AND status = 'held' AND hold_expires_at > ?` |
| `uq_bookings_hold_token_hash (hold_token_hash) WHERE hold_token_hash IS NOT NULL` | "The hold this code presents": `hold_token_hash = ?` |
| `idx_bookings_created_by_staff_id_status_hold_expires_at (created_by_staff_id, status, hold_expires_at)` | Covers `fk_bookings_created_by_staff_id`. U13's "the staff member's live counter hold" |
| `idx_bookings_checked_in_by_staff_id (checked_in_by_staff_id) WHERE checked_in_by_staff_id IS NOT NULL` | Covers `fk_bookings_checked_in_by_staff_id` |

**`0110_02_create_booking_seats`**: `booking_id BIGINT NOT NULL`, `seat_label VARCHAR(3)`,
`row_label VARCHAR(1)`, `seat_number SMALLINT`, `zone VARCHAR(8)`, `price INT`,
`is_wheelchair BOOLEAN`, all `NOT NULL`.

- `pk_booking_seats (booking_id, seat_label)`: a booking's seats. It also covers
  `fk_booking_seats_booking_id → bookings (id)`.
- CHECKs: `row_label ~ '^[A-HJ-P]$'`, `seat_number BETWEEN 1 AND 20`,
  `seat_label = row_label || seat_number::text`, `zone IN ('front','middle','back')`,
  `price > 0`. The currency is the booking's.

**`0110_03_create_seat_claims`**

```sql
CREATE TABLE seat_claims (
  showtime_id BIGINT NOT NULL,
  seat_label VARCHAR(3) NOT NULL,
  booking_id BIGINT NOT NULL,
  claimed_until TIMESTAMPTZ NULL,   -- NULL: sold; <= now: free (expired or released)
  CONSTRAINT pk_seat_claims PRIMARY KEY (showtime_id, seat_label),
  CONSTRAINT fk_seat_claims_booking_id_showtime_id FOREIGN KEY (booking_id, showtime_id)
    REFERENCES bookings (id, showtime_id),
  CONSTRAINT chk_seat_claims_seat_label CHECK (seat_label ~ '^[A-HJ-P]([1-9]|1[0-9]|20)$')
);
```

| Index | Query it serves |
|---|---|
| `pk_seat_claims` | The upsert's conflict target. Snapshot `showtime_id = ? AND (claimed_until IS NULL OR claimed_until > ?)`. `takenCounts` / `showtimeIdsWithLive` over `showtime_id = ANY(?)` |
| `idx_seat_claims_booking_id_showtime_id (booking_id, showtime_id)` | Covers the composite FK. A booking's claims (U11 payment lock, U14 refund delete) |

**`0110_04_create_hold_refusals`**: `id BIGSERIAL`, `showtime_id BIGINT NOT NULL` (FK
`fk_hold_refusals_showtime_id`), `refused_at TIMESTAMPTZ NOT NULL`, `seat_count SMALLINT NOT NULL
CHECK (seat_count BETWEEN 1 AND 8)` (the seats requested).
`idx_hold_refusals_showtime_id_refused_at (showtime_id, refused_at)` covers the FK and serves a
showtime's refusals in a period (U17's seat-conflict rate).

**`0110_05_add_booking_foreign_keys`**: `fk_audit_events_booking_id` (`audit_events.booking_id`)
and `fk_messages_related_booking_id` (`messages.related_booking_id`) → `bookings (id)`. Both
are already covered (`idx_audit_events_booking_id`, `idx_messages_related_booking_id`). No
`ON DELETE`: bookings are never deleted.

## Behaviour

**The claim statement** (`SeatClaimsRepository.upsert`, one per showtime). `rows` is sorted by
label and holds each label once. New seats carry the new booking and `claimed_until`. Released
seats carry their own booking and `:now`.

```sql
INSERT INTO seat_claims (showtime_id, seat_label, booking_id, claimed_until)
SELECT :showtime_id, r.label, r.booking_id, r.claimed_until
FROM unnest(:labels::text[], :booking_ids::bigint[], :until::timestamptz[])
  WITH ORDINALITY AS r(label, booking_id, claimed_until, n)
ORDER BY r.n
ON CONFLICT (showtime_id, seat_label) DO UPDATE
  SET booking_id = EXCLUDED.booking_id, claimed_until = EXCLUDED.claimed_until
  WHERE seat_claims.claimed_until IS NOT NULL
    AND (seat_claims.claimed_until <= :now OR seat_claims.booking_id = ANY(:take_over_from::bigint[]))
RETURNING seat_label, booking_id;
```

`SeatClaimService.write(plan)` runs `claimStatements(plan)` in order. `claimed` is the requested
labels that came back with the new booking id, and `missing` is the rest, sorted. A confirmed
claim (`claimed_until IS NULL`) is never overwritten, not even by a release. `:now` is always
`Clock.now()`.

**Create a hold** (`POST /showtimes/{id}/holds`, request transaction, `HoldsService.create`). Each
step's lock is the one §7.1 names for that step:

1. `ShowtimeReadService.lockForShare(id)`. Null, or the theater `draft`
   (`TheaterReadService.findById`), gives `404`. Movie status comes from
   `CatalogReadService.findMoviesByIds`. A non-null `notBookableReason` gives
   `409 SHOWTIME_NOT_BOOKABLE { reason }`. The theater and movie are read without locks.
2. `HallReadService.lockForShare(hallId)`, then `findLayout()` and `layoutSeats()`, read after the
   lock. A hall that isn't active gives `hall_unavailable`. An unknown label gives
   `400 VALIDATION_FAILED` (`seats.<i>`: "Not a seat in this hall.").
3. A customer is locked with `CustomerService.findByIdForUpdate()` (`FOR NO KEY UPDATE`). Null or
   anonymised gives `401 UNAUTHENTICATED`, and `blocked` gives `403 ACCOUNT_BLOCKED` (a block that
   raced the guard).
4. Bookings to release: the customer's live online holds, plus the live unowned hold matching
   `X-Hold-Token`. `lockForUpdate(ids)` (id order) and re-check them under the lock, keeping those
   still `held` with `hold_expires_at > now`. Then `expireHolds(ids, now)` sets
   `hold_expires_at = now` and `updated_at`. Their labels come from one `seatsOf(ids)`.
5. Insert the booking: `held`, `online`, a reference, `hold_expires_at`, `has_declined_payment =
   false`, the seat count, the total, the customer's contact or none, and for a guest
   `hold_token_hash` from `newHoldCode()`. Insert its `booking_seats` in one statement. More than
   5 colliding references gives `500 INTERNAL`.
6. `SeatClaimService.write({ claim: { showtimeId, bookingId, labels, claimedUntil:
   hold_expires_at }, release: [...], now })`.
7. `missing.length > 0`: register `HoldRefusalService.recordAfterRollback(showtimeId,
   labels.length)`, then throw `409 SEAT_TAKEN { seats: missing }`. Everything rolls back,
   including the releases of step 4, so the customer keeps their previous hold.
8. Audit `booking.held` (`{ showtimeId, seatCount, channel }`) and one `booking.released`
   (`{ reason: 'replaced' }`) per released hold. After commit, publish `seat.released` per
   released hold and `seat.held { labels, heldUntil }`.
9. `201 HoldResponse`, with `holdCode` set only for a guest.

**Claim** (`POST /holds/{ref}/claims`, `HoldsService.claim`):

1. Lock the customer (as in step 3 above).
2. `findByReference`. If it is owned by the caller and `held`, answer `201`. If it is missing,
   owned by someone else, or the code doesn't match the stored hash, answer `404`.
3. Lock the target and the customer's other live holds in id order. Under the lock the target
   must still be unowned with a matching hash (else `404`), and its hold must not have ended
   (else `409 HOLD_EXPIRED`).
4. Release the others (as in create step 4, with release-only claim writes).
5. `assignCustomer`: `customer_id`, `hold_token_hash = NULL`, the contact fields and
   `updated_at`. `hold_expires_at` is unchanged.
6. Audit `booking.claimed`, plus `booking.released` for each hold released. After commit,
   `seat.released` for those. Answer `201 HoldResponse` with `holdCode: null`.

**Release** (`DELETE /holds/{ref}`, `HoldsService.release`):

1. `findByReference`. The caller must be the owner, or present a code matching an unowned hold,
   else `404`.
2. `lockForUpdate([id])`. `confirmed` / `refunded` gives `409 ALREADY_PAID`. An already-ended hold
   gives `204` with no writes.
3. `expireHolds`, then a release-only claim write. Audit `booking.released`
   (`{ reason: 'released' }`). After commit, `seat.released`. Answer `204`.

**Lock order, all paths.** Create takes §7.1 steps 2→3→4→5→6. Claim takes 4→5→6, and release
takes 5→6. Each path takes a subsequence of one global order, so two paths can wait for each
other but never form a cycle. Against the other writers:

- **U5 layout save**: theater `FOR SHARE` → U7's `beforeLock` (future showtimes `FOR UPDATE`, id
  order) → hall `FOR UPDATE` → `hall_in_use` (live claims) → write.
  - If a hold already holds its showtime `FOR SHARE`, the save waits at `beforeLock` until the
    hold commits, then sees its claims (`HALL_IN_USE`).
  - If the save got there first, the hold waits on the showtime and then reads the new layout
    under its hall lock.
  - A showtime that started between the two `Clock` reads isn't locked by `beforeLock`. The hold
    then waits on the hall, and the save does not wait on the hold.
  - The hold never waits on the theater, so no cycle forms.
- **U7 move, re-price and cancel**: theater `FOR SHARE` → showtime `FOR UPDATE`. A hold's
  `FOR SHARE` makes these wait for it, or wait for them; a hold takes no theater lock.
- **U9 block**: customer, then sessions. A hold takes the customer after the showtime and hall.
  The block takes neither of those.
- **Holds against holds**: the upsert locks rows in label order within a showtime, and across
  showtimes in id order. A release shares that statement, so rows already locked (including those
  an `ON CONFLICT` locks when its `WHERE` fails) are never followed by a smaller label.
- **Deadlock retry**: the write interceptor's one retry on `40P01` stays a safety net, not part of
  the design. The tests assert that `pg_stat_database.deadlocks` stays at zero.

**Status from the clock** (`booking-status.sql.ts`, §7.4). Given `{ status, holdExpiresAt,
hasDeclinedPayment, showtimeEndsAt }` and `now`:

- `held` with `holdExpiresAt > now` → `held`; ended and declined → `failed`; ended otherwise →
  `abandoned`;
- `confirmed` with `showtimeEndsAt > now` → `confirmed`, else `completed`;
- `refunded` → `refunded`.

The SQL predicates are the same conditions with `:now` bound.

**Reads**:

- `ShowtimeSeatMapService.header(id)` and `.seats(id)` share the visibility rule. Header: the
  showtime, its movie (one `findMoviesByIds`), theater (`findById`), hall layout (`findLayout`),
  `bookable` and `notBookableReason`.
- Seats: `SeatAvailabilityService.snapshot(id)`, plus `availableCount = seatCapacity − taken`
  (floored at 0) and `soldOut = availableCount === 0`. Both reads cost a fixed number of queries.
- `BookingReadService.get(ref, access)`: by reference, access as decided above, then the booking,
  its seats, its showtime header and the status. The access check comes first, so a `404` costs
  one query.

**Seat map gateway** (`/ws`, `@nestjs/platform-ws`):

- **Connection.** Check the origin, then the per-IP count (`SeatMapConnections.admit(ip)`). A
  refusal sends `error` and closes with the code above.
- **`subscribe { showtimeId }`.** Parse the id (a positive safe integer, else `VALIDATION_FAILED`).
  An existing subscription just gets a new snapshot. Over the limit gives `RATE_LIMITED`.
  Otherwise register the subscription as pending, read `snapshot()`, send `snapshot`, then flush
  the buffer and mark it live.
- **`unsubscribe { showtimeId }`.** Remove the subscription. Unknown ids are ignored.
- **Bus listener.** For each event, every client subscribed to `event.showtimeId` gets it (live)
  or buffers it (pending). Only `OPEN` sockets are written to.
- **Liveness.** `sweepConnections()` runs every 30 s: a client that didn't answer the previous
  ping is terminated, the others are marked and pinged. `pong` marks a client alive. A disconnect
  frees its IP slot and subscriptions.
- **Timers.** The ping is liveness only. No seat state depends on it.

| Direction | Event | Data |
|---|---|---|
| Client → server | `subscribe` | `{ showtimeId: number }` |
| Client → server | `unsubscribe` | `{ showtimeId: number }` |
| Server → client | `snapshot` | `{ showtimeId, serverTime, seats: [{ label, state: 'held' \| 'booked', heldUntil? }] }` (labels sorted; `heldUntil` only when held) |
| Server → client | `seat.held` | `{ showtimeId, labels, heldUntil }` |
| Server → client | `seat.released` | `{ showtimeId, labels }` |
| Server → client | `seat.booked` | `{ showtimeId, labels }` (published by U11) |
| Server → client | `error` | `{ code: 'VALIDATION_FAILED' \| 'RATE_LIMITED' \| 'FORBIDDEN' }` |

Times are `formatCairoIso`. Messages use Nest's `{ "event", "data" }` shape. An inbound message
over 4 KB closes the socket (`1009`, from `ws`).

**Rollback hook** (`TransactionRepository.afterRollback(hook)`): it is pushed onto the innermost
state, and savepoints hand theirs to the parent on release and on rollback. `run()` runs them
after the outermost transaction rolls back, outside any transaction context, logging a failing
hook without masking the original error. Outside a transaction it throws `INTERNAL`.

## Endpoints

All are under `/api/v1`, with `@ApiTags('Seats and holds')`, a summary, a description, and
`@ApiErrorResponses(...)`. U1 adds the access, idempotency and `429` docs.

| Route | Access | Idem. | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET /showtimes/{id}` | `@Public()` | — | `ShowtimeIdParams` | `200 PublicShowtimeResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `GET /showtimes/{id}/seats` | `@Public()` | — | `ShowtimeIdParams` | `200 SeatSnapshotResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /showtimes/{id}/holds` | `@Guest()`, `@RateLimit('holdIp','holdCustomer')` | **S** | `ShowtimeIdParams`, `CreateHoldRequest`, optional `X-Hold-Token` | `201 HoldResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `SHOWTIME_NOT_BOOKABLE`, `SEAT_TAKEN`, `UNAUTHENTICATED`, `ACCOUNT_BLOCKED` |
| `POST /holds/{ref}/claims` | `@Customer()` | **S** | `BookingRefParams`, `X-Hold-Token` (required) | `201 HoldResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `HOLD_EXPIRED`, `UNAUTHENTICATED`, `ACCOUNT_BLOCKED` |
| `DELETE /holds/{ref}` | `@Guest()` | key optional | `BookingRefParams`, optional `X-Hold-Token` | `204` | `VALIDATION_FAILED`, `NOT_FOUND`, `ALREADY_PAID` |
| `GET /bookings/{ref}` | `@Guest()` | — | `BookingRefParams`, optional `X-Hold-Token` | `200 BookingResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |

`X-Hold-Token` is documented with `@ApiHeader` on the four routes that read it. Both `GET`s on a
showtime send `Cache-Control: no-store`.

**Request DTOs**

- `ShowtimeIdParams`: `id`, a positive integer.
- `BookingRefParams`: `ref` matching `REFERENCE_PATTERN` (upper case).
- `CreateHoldRequest`: `seats`, a `string[]` of 1–8 unique labels, each matching
  `SEAT_LABEL_PATTERN`.

**Response DTOs** (times in `formatCairoIso`, money as `MoneyResponse`)

- `BookingSeatResponse`: `label`, `rowLabel`, `seatNumber`, `zone`, `price`, `isWheelchair`.
- `BookingShowtimeResponse` (schema `BookingShowtime`): `id`, `startsAt`, `endsAt`, `cinemaDate`,
  `movie` (`{ id, title, ageRating, runtimeMinutes, poster: ImageResponse | null }`), `theater`
  (`{ id, name }`), `hall` (`{ id, name }`).
- `BookingResponse` (schema `Booking`, extended by U11/U12): `reference`, `status`
  (`BOOKING_DISPLAY_STATUSES`), `channel`, `owner` (`guest` \| `customer`), `showtime`, `seats`
  (in label order), `seatCount`, `total`, `holdExpiresAt`, `serverTime`, `createdAt`.
- `HoldResponse` (schema `Hold`): `BookingResponse` plus `holdCode` (`string | null`, "Shown
  once. Keep it for this browser session and send it as `X-Hold-Token`").
- `PublicShowtimeResponse` (schema `PublicShowtime`): the fields of `BookingShowtimeResponse`,
  plus `prices` (U7's `ShowtimePrices`), `fromPrice`, `seatCapacity`, `layout` (U5's `HallLayout`
  via `toHallLayoutResponse`), `bookable`, `notBookableReason` (enum or `null`), `maxSeatsPerHold`
  (8) and `holdMinutes` (5).
- `SeatSnapshotResponse` (schema `SeatSnapshot`): `showtimeId`, `serverTime`, `seats`
  (`SeatStateResponse[]` = `{ label, state, heldUntil: string | null }`), `availableCount` and
  `soldOut`. The description points to `/ws` for live updates.

**Error shapes** (no new codes): `SEAT_TAKEN { seats: string[] }` (sorted),
`SHOWTIME_NOT_BOOKABLE { reason }`, `HOLD_EXPIRED` and `ALREADY_PAID` with `details: null`. The
catalogue descriptions of `SHOWTIME_NOT_BOOKABLE` and `SEAT_TAKEN` gain these shapes.

## Services

**Exported by `SeatingModule`**:

```ts
class SeatClaimService {
  write(plan: ClaimPlan): Promise<ClaimOutcome>;   // in the open transaction; one statement per showtime, id order
}
// ClaimPlan = { now: Date;
//   claim?: { showtimeId: number; bookingId: number; labels: readonly string[]; claimedUntil: Date | null };
//   release: readonly ReleasedClaims[] }          // ReleasedClaims = { showtimeId; bookingId; labels }
// ClaimOutcome = { claimed: readonly string[]; missing: readonly string[] }   // both sorted

class SeatAvailabilityService {                    // also bound to U7's ShowtimeSeatClaimService
  snapshot(showtimeId: number): Promise<SeatSnapshot>;
  takenCounts(showtimeIds: readonly number[]): Promise<ReadonlyMap<number, number>>;   // U8b sold out, U14
  showtimeIdsWithLiveClaims(showtimeIds: readonly number[]): Promise<ReadonlySet<number>>; // U7 hall_in_use
}
// SeatSnapshot = { showtimeId: number; serverTime: Date;
//   seats: readonly { label: string; state: 'held' | 'booked'; heldUntil: Date | null }[] }

class HoldRefusalService {
  recordAfterRollback(showtimeId: number, seatCount: number): Promise<void>;  // needs an open transaction
}

class SeatEventPublisher {
  publishAfterCommit(event: SeatEvent): Promise<void>;
}
// SeatEvent = { type: 'seat.held'; showtimeId; labels: readonly string[]; heldUntil: Date }
//   | { type: 'seat.released'; showtimeId; labels } | { type: 'seat.booked'; showtimeId; labels }
```

**Exported by `BookingsModule`** (for U11–U14, which extend the module itself):

```ts
class HoldsService {
  create(input: CreateHoldInput): Promise<CreatedHold>;
  claim(customer: CustomerPrincipal, reference: string, holdCode: string): Promise<Booking>;
  release(access: HoldAccess, reference: string): Promise<void>;
}
// CreateHoldInput = { showtimeId: number; labels: readonly string[]; holder: HoldHolder }
// HoldHolder = { kind: 'guest'; holdCode?: string } | { kind: 'customer'; customerId: number; holdCode?: string }
// HoldAccess = { customerId?: number; holdCode?: string }

class BookingReadService {
  get(reference: string, access: HoldAccess): Promise<Booking>;   // NOT_FOUND for anyone else
}
```

Also exported by path: `bookingStatusOf()` and the SQL predicates (`booking-status.sql.ts`),
`BookingResponse`, `toBookingResponse()`, `BOOKING_DISPLAY_STATUSES` and `REFERENCE_PATTERN`.

**Added to shared modules**:

- `TransactionRepository.afterRollback(hook: PostCommitHook): Promise<void>`.
- `ShowtimeReadService.lockForShare(id): Promise<ShowtimeView | null>`. It needs an open
  transaction, else `INTERNAL`, like U5's.

**Consumed** (exact names):

- U7: `ShowtimesModule`, `ShowtimeReadService.findById()`, `ShowtimeView`,
  `ShowtimeSeatClaimService`, `ShowtimePricesResponse`, `toShowtimePricesResponse()`, and
  `scheduleShowtime()` from `test/support/showtimes.ts`.
- U5: `HallsModule`, `HallReadService.lockForShare()`, `.findLayout()`, `layoutSeats()`,
  `HallSeat`, `HallLayout`, `toHallLayoutResponse()`, `HallLayoutResponse`; tests use
  `addActiveHall()` and `HALLS`.
- U6: `CatalogModule`, `CatalogReadService.findMoviesByIds()`, `MovieRef`; tests use
  `createPublishedMovie()`.
- U4b: `TheatersModule`, `TheaterReadService.findById()`, `TheaterDetails`; tests use
  `createTheater()`, `prepareTheater()`, `setTheaterStatus()`.
- U4a: `MediaService.toImageResponse()`, `ImageResponse`.
- U9: `CustomersModule`, `CustomerService.findByIdForUpdate()`, `Customer`; tests use
  `registerCustomer()`, `signInCustomer()`, `blockCustomer()`.
- U1: `TransactionRepository.run()`, `.afterCommit()`, `TransactionContext.executor()`, `Strict()`,
  `Public()`, `Guest()`, `Customer()`, `CurrentPrincipal()`, `CustomerPrincipal`, `RateLimit()`,
  `AuditService.record()`, `Clock`, `addToInstant()`, `formatCairoIso()`, `money()`,
  `sumMoney()`, `MoneyResponse`, `sha256Hex()`, `randomToken()`, `safeEqual()`, `AppError`,
  `ApiErrorResponses()`, `AppConfig.corsOrigins`.
- U2a (tests only): `staffSession()`, `listHttpRoutes()`, `samplePath()`.

## Tests

**Unit** (`test/unit/modules/seating/`, `test/unit/modules/bookings/`, `test/unit/common/database/`;
collaborators mocked, fixed `Clock`):

- `claim-plan.test.ts`: rows sorted and deduplicated; a new seat wins over a released one on the
  same label; same-showtime releases fold into the claim statement with `takeOverFrom`; other
  showtimes become release-only statements, all in showtime id order (lower and higher than the
  claim's).
- `booking-status.sql.test.ts`: every row of §7.4 at `now − 1 ms`, `now` and `now + 1 ms`.
- `bookability.test.ts`: each reason, and their precedence.
- `booking-reference.test.ts`: the pattern, alphabet only, 10,000 draws all matching.
- `hold-code.test.ts`: 43 characters, hash of the code, malformed, missing and wrong codes don't
  match.
- `seat-map.messages.test.ts`: `parseShowtimeId` (0, −1, 1.5, `"7"`, `2^53`, missing → invalid);
  snapshot and event shapes; times in `+03:00` and `+02:00`.
- `client-address.test.ts`: rightmost `X-Forwarded-For` entry, socket fallback.
- `seat-map.connections.test.ts`: the 21st connection from one IP refused, a slot freed on
  disconnect, the 4th subscription refused, the pending buffer flushed in order.
- `holds.service.test.ts`: the order of calls (showtime lock → hall lock → customer lock →
  bookings lock → insert → claim write → audit → publish); `SEAT_TAKEN` registers the rollback
  hook and publishes nothing; hold expiry capped at `starts_at`; a 6th reference collision gives
  `INTERNAL`; datastore down gives `503`.
- `transaction.repository.test.ts` (extended): rollback hooks run after a rollback and never
  after a commit; a failing hook is logged and the original error is rethrown.

**Integration** (`test/integration/modules/bookings/`, `test/integration/modules/seating/`; real
app, real Postgres and `TestClock`; nothing of ours mocked). Showtimes come from `bookableShowtime()`
in the new `test/support/holds.ts`: an active theater with prices and hours, an active 4 × 8
hall, a Now showing movie, and a showtime tomorrow via U7's `scheduleShowtime()`. The same file
has `holdSeats()` and `seatMapClient()` (a `ws` client on `app.listen(0)` with
`Origin: TEST_CORS_ORIGIN`, which waits for messages by event, never by sleep).

- **Claim statement** (`seat-claims.repository.test.ts`, direct calls in
  `TransactionRepository.run`): a free seat is inserted; a live one is refused; an expired one
  (`claimed_until = now`) is taken over; a sold one (`NULL`) is never touched, not even by a
  release or by `takeOverFrom`; `takeOverFrom` takes over only its own booking's live rows.
- **Concurrent holds** (`hold-concurrency.test.ts`):
  - 24 parallel guest holds (distinct keys) on overlapping windows of 3 seats in one row. Each
    seat has exactly one live claim. The winners' seat sets are disjoint, and their claims match
    `booking_seats`. Each loser is `409 SEAT_TAKEN` whose `details.seats` lists only seats a
    winner holds. `hold_refusals` has one row per loser with `seat_count = 3`, and the losers left
    no `bookings` row.
  - Two guests cross-re-picking each other's showtimes and seats in parallel, 20 rounds:
    `pg_stat_database.deadlocks` is unchanged.
- **Hold and layout** (`hall-in-use.test.ts`):
  - A live hold makes `PUT /admin/halls/{id}/layout` answer `409 HALL_IN_USE` naming the
    showtime.
  - After `TestClock` passes the expiry, or after `DELETE /holds/{ref}`, the save is `200`.
  - 10 parallel holds plus one layout save: every hold is `201`, `409 SEAT_TAKEN` or `400` (a
    seat gone from the new layout), and the save is `200` or `409 HALL_IN_USE`. There is no
    `500`, `pg_stat_database.deadlocks` is unchanged, and every `201` hold's seats exist in the
    layout that won.
- **Expiry by the clock** (`holds.controller.test.ts`):
  - A holds F1 at `t`. At `t + 5 min − 1 s`, B's hold on F1 is `409`. At `t + 5 min`, B's hold is
    `201` and A's `GET /bookings/{ref}` as owner reads `abandoned`. No job runs.
  - A showtime starting in 3 minutes gives `holdExpiresAt = startsAt`.
  - Once the showtime starts: `409 SHOWTIME_NOT_BOOKABLE started`.
- **Hold rules**:
  - 0 and 9 seats, duplicates, `I1`, `A21`, and a seat on a `no_seat` gap → `400`.
  - Cancelled showtime → `cancelled`. Paused theater → `sales_paused`. Draft theater → `404`.
  - A blocked customer → `403 ACCOUNT_BLOCKED`.
  - Prices: zone prices are snapshotted, and a price change afterwards leaves the hold's total
    as it was.
  - Re-pick: a customer's second hold releases the first, and its seats are free in the
    snapshot. A re-pick that overlaps keeps the shared seat. A refused re-pick (`SEAT_TAKEN`)
    leaves the first hold live.
  - Guest re-pick with the old code releases the old hold.
  - A replay with the same key gives `Idempotent-Replayed` with the same `holdCode`. Another code
    → `422`. No key → `400 IDEMPOTENCY_KEY_REQUIRED`.
  - Audit rows `booking.held` and `booking.released` carry `booking_id`.
- **Access** (`bookings.controller.test.ts`, `holds.controller.test.ts`):
  - A guest hold: `GET /bookings/{ref}` and `DELETE` work with the code. Without it, with a wrong
    code, as another customer, or after expiry, the answer is `404`.
  - A customer hold: other customers, guests and a guessed code get `404`.
  - A box-office staff token on these `@Guest()` routes → `401`.
  - An unknown well-formed reference → `404`; a malformed one → `400`.
- **Claim at sign-in** (`hold-claims.test.ts`, the U9 follow-up):
  - A guest holds, then registers through `POST /auth/registrations` (and in a second case signs
    in through `POST /auth/sessions`), then claims with the code → `201`, `owner: customer`, the
    same `holdExpiresAt`, the customer's contact stored.
  - The code then fails for a guest `GET` (`404`). A second claim by the same customer → `201`.
  - Another customer with the old code → `404`. Without the header → `400`. After expiry → `409
    HOLD_EXPIRED`.
  - The customer's own earlier live hold is released, and `seat.released` is received.
- **Snapshot** (`public-showtimes.controller.test.ts`):
  - `/seats` lists live holds with `heldUntil`, omits expired and released ones, and counts
    `availableCount`. A sold claim, inserted by direct SQL as U11 will, reads `booked`.
  - With every seat taken, `soldOut: true`.
  - `GET /showtimes/{id}` returns the layout, prices, `fromPrice` and `bookable` / reason, with
    `Cache-Control: no-store`. It reads the same for a started showtime, which gives
    `bookable: false`.
- **WebSocket** (`seat-map.gateway.test.ts`):
  - Subscribe → snapshot equal to `/seats`. A hold → `seat.held` with the labels and
    `heldUntil`. A release → `seat.released`. A client subscribed to another showtime receives
    nothing.
  - **After commit only**: an interceptor-level probe (`test/support/seat-map-probe.module.ts`,
    a `@Guest() @Strict()` test route that publishes through `SeatEventPublisher`, then throws
    `CONFLICT`), followed by a successful hold. The next message the client receives is the
    hold's `seat.held`, so the rolled-back event never went out. A `SEAT_TAKEN` hold that
    released an earlier hold is checked the same way: no `seat.released` arrives.
  - Bad origin, or no origin → `FORBIDDEN` and close `1008`. The 21st connection from one IP →
    close `1013`. The 4th subscription → `RATE_LIMITED`. `{ showtimeId: "x" }` →
    `VALIDATION_FAILED`. A 5 KB message → close `1009`.
  - `sweepConnections()` twice without a pong terminates the client.
- **Access declarations**: `listHttpRoutes()` shows the 6 routes with the access above, and the
  app boots with the gateway present.
- **Contract**: `npm run contract` regenerates `contracts/openapi.yaml` with the 6 operations and
  the schemas `PublicShowtime`, `SeatSnapshot`, `Booking`, `Hold` and `BookingShowtime`. The
  `X-Hold-Token` header appears on 4 operations.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (nonzero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass and prove issue #11 against real Postgres with no mocks:
  - many concurrent holds on overlapping seats leave each seat exactly one live claim, and every
    loser gets `SEAT_TAKEN` listing the taken seats, recorded in `hold_refusals`;
  - an expired claim is taken over by moving the `Clock`, with no timer;
  - concurrent holds and a layout change never deadlock (`pg_stat_database.deadlocks`
    unchanged), and a layout save with live claims is `HALL_IN_USE`;
  - a guest needs the hold code, and everyone else gets `404`;
  - a customer claims a guest hold with its code after registering or signing in;
  - the seat snapshot reflects live claims only;
  - a WebSocket client receives seat updates after commit and nothing after a rollback.
- `docs/system-design.md` is updated:
  - §5: seating depends on nothing; showtimes binds seating's live claims; bookings uses
    showtimes, halls, catalog, theaters, customers and seating.
  - §6.2: the bookings columns and CHECKs, `claimed_until <= now` meaning free.
  - §7.2: the release rows and `takeOverFrom`, and one statement per showtime in id order.
  - §7.3: release expires claims; the bookability reasons; visibility; contact copy; claim edge
    answers.
  - §12: admission and close codes, unknown ids, the snapshot buffer.
  - §14.1: `afterRollback`.
- README "Live seat map" documents the messages above. `docs/gh-11-holds/spec.md` is this draft.
- Follow-ups are recorded:
  - U11: settle first, `PAYMENT_IN_PROGRESS` on release, `seat.booked`, hold extension, bind
    `ShowtimeTicketHolderService`.
  - U8b: sold out from `takenCounts()`.
  - U13: the staff `HoldHolder`.
  - U14: refunds and edits delete claims, and showtime cancellation releases holds through
    `SeatClaimService`.
