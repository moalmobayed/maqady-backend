---
title: U15 — Admin customers - list, detail, edit, block and unblock, anonymisation, reset email, no-shows
owner: Mohamed Tarek
status: Built
last_verified: 2026-10-29
tags: [admin, customers, search, block, anonymisation, password-reset, no-shows, sessions, messaging, audit]
---

# U15 — Admin customers: list, detail, edit, block and unblock, anonymisation, reset email, no-shows

Issue: #16. Docs folder: `docs/gh-16-admin-customers/`. Migration prefix `0160`. Depends on U14
(`AdminBookingsService.list()`, `AdminBookingResponseMapper`, `BookingNotesService.deleteForCustomer()`)
and, through it, U13 (check-ins, `checked_in_at`), U11 (`SettlementService.settleAllDue()`), U10
(`booking-status.sql.ts`), U9 (`CustomerService.setStatus()`, `issuePasswordReset()`, the customer
reset template), U3 (`MessagingService`), U2a (`SessionService`, `OneTimeTokenService`) and U1.
Design: `docs/system-design.md` §5, §6, §7.1, §7.4, §10, §11 (admin customer routes), §13.1, §14,
§21 (the anonymisation definition); PRD v2 A7, "Accounts" 5 and 6, "Email and SMS" ("admin sends
a reset"), "Dashboard numbers" (No-shows), call 13.

## Goal

Staff find any customer by name, email or phone, filter by status, and open a customer to see
their details, their Bookings, Spent and No-shows numbers and their most recent bookings. Admins
edit a customer's name, email and phone, block them (signed out everywhere at once, refused at
sign-in) and unblock them, send them a password reset email, and delete the account: the customer
is anonymised in one transaction, exactly as design §21 defines, and their bookings and payments
stay for accounting. Box office sees the same data read-only.

## Scope

- Migration `0160_01_add_admin_customer_indexes` (indexes only).
- A new feature module `admin-customers` (`src/modules/admin-customers/`) with
  `GET /admin/customers`, `GET /admin/customers/{id}` (Staff), `PATCH /admin/customers/{id}`,
  `DELETE /admin/customers/{id}` and `POST /admin/customers/{id}/password-reset-requests`
  (Admin; the last strict).
- Additive, in the owning modules:
  - `customers`: `CustomerService.list()`, `updateDetails()`, `anonymise()`; the list query and
    the search in `customers.repository.ts` and `customer-search.ts`.
  - `bookings`: `CustomerBookingsService` (`statsOf()`, `clearContactsOf()`), its repository, and
    a `customerId` filter on `GET /admin/bookings` (the drawer's "Recent bookings" and its "View
    all" link); `AdminBookingResponseMapper` exported.
  - `auth`: `SessionService.deleteAllFor()`, `OneTimeTokenService.deleteAllFor()`.
  - `messaging`: `MessagingService.deleteForCustomer()`.
  - `common/idempotency`: `IdempotencyService.deleteForScope()`.
- Error code `CUSTOMER_BLOCKED`; `EMAIL_TAKEN`'s description also covers the admin edit.
- Audit actions `customer.updated`, `customer.status_changed` (U9's), `customer.password_reset_sent`,
  `customer.anonymised`: field names and counts only, never values.
- Swagger tag `Admin: customers`; contract regenerated.

## Out of scope

- The customers CSV export (U19): it can reuse `customerListConditions()` and `CustomerService.list()`.
- Customer search in the admin top bar (U18) and the public search.
- The Profile's `bookingCount` on `GET /me` (a U9/U12 follow-up): it belongs to the customer
  site, not this screen; recorded as a follow-up.
- Saved cards: none are stored (PRD: no card data), so "saved cards are removed" needs nothing.
- Hard-deleting a customer: customers are anonymised, never deleted (design §6.2).

## Decisions

| Decision | Why |
|---|---|
| A new module `admin-customers` holds the admin routes and the anonymisation; it imports `customers`, `bookings`, `auth` (credentials) and `idempotency` | The screen needs each customer's booking numbers, and anonymisation touches bookings, notes, sessions, tokens, idempotency keys and messages. `bookings` already imports `customers`, so the routes cannot live in `customers`; one module on top keeps every dependency one-way, and each table is still written only by the module that owns it (design §5, recorded there) |
| The list is newest account first (`created_at DESC, id DESC`), cursor-paged with `total`; anonymised accounts never appear in it, and their detail, edit, block, reset and delete answer `NOT_FOUND` | An anonymised row has no name, email or phone to show or act on; the booking detail's customer card already says `anonymised: true`, so the frontend hides "Open customer" |
| `q` (2–100 characters, trimmed) is a case-insensitive substring of the name, email or phone; an Egyptian local mobile (`01012345678`) also matches its stored `+201012345678`; `%`, `_` and `\` are literal | The same rule as the admin bookings search (U14), on trigram indexes |
| **Bookings** counts the customer's paid bookings still held (stored `confirmed`: Confirmed and Completed); **Spent** is their totals; **No-shows** the Completed ones never checked in; **Last booking** the newest of their creation times | PRD "Dashboard numbers": No-shows are "paid bookings that were never scanned". A refunded booking is no longer paid, so it counts in none; an edit's new total is the money kept. Completed is decided by `bookingStatusPredicate('completed')`, the one owner of the clock statuses (design §7.4), so a show that has not ended yet is never a no-show |
| The numbers of a whole page come from one grouped query (`WHERE customer_id IN (…)`); due slow payments are settled first (`settleAllDue()`) | No N+1; a booking whose payment just settled is counted the same way as on the bookings screen |
| The detail's `recentBookings` are the customer's 4 newest bookings in any status, as the admin bookings list shows them; `GET /admin/bookings?customerId=` pages all of them | The drawer's "Recent bookings (last 4)"; reusing U14's list keeps one shape and one set of rules |
| `PATCH` takes `fullName`, `email`, `phone` (`null` clears it) and `status`, in any combination, at least one; values equal to the stored ones change nothing and audit nothing | One drawer, one route (design §11) |
| `PATCH`'s answer is never stored for replay (`@NoIdempotencyStorage()`; an `Idempotency-Key` is ignored) | It carries the name, email and phone, and a stored copy would replay them for 24 hours after "Delete account" removed them (U15 review). Sending the same edit again changes nothing |
| A new email must be free among live accounts (`EMAIL_TAKEN`, also when a concurrent edit takes it first: the unique violation is mapped). It is unverified from then on, and the customer's unused one-time links are deleted | A verification link sent to the old address would otherwise verify the new one, and a reset link would let the old mailbox take the account back |
| Editing the account does not rewrite the contact copied onto existing bookings | Bookings keep the contact they were made with (U10); booking contacts are edited on the booking (U14) |
| `status: blocked` calls U9's `CustomerService.setStatus()`: every session revoked in the same transaction, sign-in and refresh answer `ACCOUNT_BLOCKED`, paid tickets stay valid. `active` unblocks; the customer signs in again | PRD Accounts 5, design §10.2 |
| The admin reset email (`202 { channel: 'email', queuedAt }`, strict) refuses a blocked customer with `409 CUSTOMER_BLOCKED` | The link would answer `ACCOUNT_BLOCKED` when used (U9), so it would only spend one of Resend's 100 daily emails; unblock first |
| `DELETE` anonymises and answers `200` with what was kept and removed (counts, no personal data); it is not strict, so a retry after success answers `NOT_FOUND` | Design §11 (no **S**); the counts are the toast ("{n} past bookings are kept") and QA evidence |
| Anonymisation runs in the request transaction, locks the customer (`FOR NO KEY UPDATE`, §7.1 step 4), then their bookings `FOR UPDATE` in id order (step 5), then deletes and clears | A sign-in, refresh, hold or payment racing it waits for the customer row and is then refused, as for a block; the lock order matches every booking write |
| Sessions are deleted after locking the customer's live heads (as a revocation does) | A refresh in flight finishes first, and the row it inserted is deleted too |
| "Their messages" are the rows with `related_customer_id` = the customer: every email and SMS about their account and their bookings carries it | `idx_messages_related_customer_id`; a walk-in's or typed contact's booking has no customer and is untouched |
| "Their idempotency rows" are the rows of scope `customer:<id>` | Design §14.1: a customer's requests are keyed by that scope (`uq_idempotency_keys_scope_key`) |
| Kept: the `customers` row (id, status, `email_verified_at`, `last_sign_in_at`, timestamps), the bookings (status, seats, totals, check-in), the payments (including card brand and last 4) and the audit events | Design §21 names exactly what goes; everything else is accounting or carries no personal data |

## Modules and files

`src/modules/admin-customers/`:

| File | Holds |
|---|---|
| `admin-customers.module.ts` | Imports `CustomersModule`, `BookingsModule`, `CredentialsModule`, `IdempotencyModule`; exports `AdminCustomersService`, `CustomerAnonymisationService` |
| `admin-customers.controller.ts` | The five routes |
| `admin-customers.service.ts` | List with numbers, detail, edit and block, reset email |
| `customer-anonymisation.service.ts` | Anonymisation in one transaction |
| `admin-customer-response.mapper.ts` | Response DTOs from the service results |
| `types.ts`, `admin-customers.constants.ts` | Types; the audit actions, the anonymised field names and the recent-bookings limit |
| `dto/` | `admin-customers.query.ts`, `customer-id.params.ts`, `update-customer.request.ts`, `admin-customer.response.ts` (list item, page, detail, numbers), `customer-anonymisation.response.ts`, `customer-password-reset.response.ts` |

Additions elsewhere: `customers/customer-search.ts` (the search pattern and list conditions),
`customers.repository.ts` (`pageForAdmin`, `countForAdmin`, `updateDetails`, `anonymise`),
`customer.service.ts`, `customers/types.ts`; `bookings/customer-bookings.repository.ts`,
`bookings/customer-bookings.service.ts`, `bookings/admin-bookings.sql.ts` and
`dto/admin-bookings.query.ts` (`customerId`), `bookings.module.ts` (providers, exports);
`auth/session.service.ts`, `auth/sessions.repository.ts`, `auth/one-time-token.service.ts`,
`auth/one-time-tokens.repository.ts`; `messaging/messaging.service.ts`,
`messaging/messages.repository.ts`; `common/idempotency/idempotency.service.ts`,
`idempotency.repository.ts`; `common/errors/error-catalogue.ts`; `common/swagger/swagger.constants.ts`;
`app.module.ts`.

## Migration `0160_01_add_admin_customer_indexes`

Indexes only, so the previous release runs beside them (design §6.1). Each has a `COMMENT` naming
its query.

| Index | Definition | Serves |
|---|---|---|
| `idx_customers_created_at` | `(created_at, id) WHERE deleted_at IS NULL` | The list, newest first, keyset `(created_at, id) < (?, ?)` |
| `idx_customers_full_name_trgm` | `gin (full_name gin_trgm_ops)` | `full_name ILIKE ?` (list search; U18) |
| `idx_customers_email_trgm` | `gin ((email::text) gin_trgm_ops)` | `email::text ILIKE ?` (CITEXT is not a `gin_trgm_ops` type) |
| `idx_customers_phone_trgm` | `gin (phone gin_trgm_ops)` | `phone ILIKE ?` |

The other statements use existing indexes: the numbers and the bookings lock
`idx_bookings_customer_id_status_hold_expires_at`; sessions `idx_sessions_customer_id`; tokens
`idx_one_time_tokens_customer_id_purpose`; messages `idx_messages_related_customer_id`;
idempotency rows `uq_idempotency_keys_scope_key`; notes `idx_booking_notes_booking_id_created_at`.

## Endpoints

All under `/api/v1`. Times are Cairo ISO with offset; money `{ amount, currency }`.

| Route | Access | S | Success | Errors |
|---|---|---|---|---|
| `GET /admin/customers?q&status&cursor&limit` | `@Staff()` | | `200 AdminCustomerResponsePage` | `400 VALIDATION_FAILED` (`q`, `status`, `cursor`, `limit`) |
| `GET /admin/customers/{id}` | `@Staff()` | | `200 AdminCustomerDetail` | `400`; `404 NOT_FOUND` (unknown or anonymised) |
| `PATCH /admin/customers/{id}` | `@Admin()` | | `200 AdminCustomer` | `400`; `403 FORBIDDEN` (box office); `404`; `409 EMAIL_TAKEN` |
| `DELETE /admin/customers/{id}` | `@Admin()` | | `200 CustomerAnonymisation` | `400`; `403`; `404` |
| `POST /admin/customers/{id}/password-reset-requests` | `@Admin()` | S | `202 CustomerPasswordReset` | `400`, `IDEMPOTENCY_KEY_REQUIRED`; `403`; `404`; `409 CUSTOMER_BLOCKED`; `422 IDEMPOTENCY_KEY_REUSED` |

Every route also has the guards' `401`/`403` codes and `429 RATE_LIMITED` (cross-cutting docs).

**Request DTOs**

- `AdminCustomersQuery` (extends `PageQuery`): `q?` (2–100, trimmed, no NUL), `status?`
  (`active`, `blocked`).
- `CustomerIdParams`: `id` (integer ≥ 1).
- `UpdateCustomerRequest`: `fullName?` (trimmed, 1–100, no NUL), `email?` (trimmed, an email the
  `customers` CHECK accepts, ≤ 320), `phone?` (E.164 or Egyptian local mobile, normalised; `null`
  clears), `status?` (`active`, `blocked`); an empty body is `VALIDATION_FAILED` ("send fullName,
  email, phone or status").

**Response DTOs**

Names as the contract (`contracts/openapi.yaml`) gives them; the contract wins.

- `AdminCustomer` (a list item, and `PATCH`'s answer): `id`, `fullName`, `email`, `phone`
  (nullable), `status`, `emailVerified`, `emailVerifiedAt` (nullable), `joinedAt`, `lastSignInAt`
  (nullable), `updatedAt`, `stats: CustomerStats`. `PATCH` answers without `recentBookings`: an
  edit does not change bookings, and settlement cannot run inside the request transaction.
- `AdminCustomerResponsePage`: `items: AdminCustomer[]`, `nextCursor`, `total`.
- `CustomerStats`: `bookings`, `spent` (Money), `noShows`, `lastBookingAt` (nullable).
- `AdminCustomerDetail` (`GET /admin/customers/{id}`): the `AdminCustomer` fields plus
  `recentBookings: AdminBookingListItem[]` (U14's list item, at most 4).
- `CustomerAnonymisation`: `customerId`, `anonymisedAt`, `bookingsKept`,
  `removed: CustomerAnonymisationRemovals { sessions, oneTimeTokens, idempotencyKeys, messages,
  bookingNotes, bookingContacts }`.
- `CustomerPasswordReset`: `channel` (`email`), `queuedAt`.

`GET /admin/bookings` gains `customerId?` (integer ≥ 1): only that customer's bookings.

## Anonymisation (design §21), in order, in the request transaction

1. Lock the customer (`CustomerService.findByIdForUpdate`); unknown or already anonymised →
   `NOT_FOUND`.
2. Lock their bookings `FOR UPDATE` in id order and null `contact_name`, `contact_email`,
   `contact_phone` on them (`CustomerBookingsService.clearContactsOf`).
3. Delete the internal notes on their bookings (`BookingNotesService.deleteForCustomer`).
4. Delete their sessions (`SessionService.deleteAllFor`), every one-time token, used or not
   (`OneTimeTokenService.deleteAllFor`), their idempotency rows (`IdempotencyService.deleteForScope('customer:<id>')`)
   and their messages (`MessagingService.deleteForCustomer`).
5. Null `email`, `full_name`, `phone`, `password_hash` and set `deleted_at` (and `updated_at`)
   on the customer row (`CustomerService.anonymise`); the CHECK `chk_customers_live_or_anonymised`
   holds it to exactly that.
6. Audit `customer.anonymised` (entity `customer`, the counts as metadata).

## Exported services (for U16–U19)

- `AdminCustomersService.list(filter, page)`, `detail(id)` and `customerListConditions()` in
  `customers/customer-search.ts` (U19's customers CSV reuses the filters).
- `CustomerAnonymisationService.anonymise(actor, id)`.
- `CustomerService.list(filter, page)`, `updateDetails(actor, id, changes)`, `anonymise(id)`.
- `CustomerBookingsService.statsOf(customerIds, now)`, `clearContactsOf(customerId)`.
- `SessionService.deleteAllFor(owner)`, `OneTimeTokenService.deleteAllFor(owner)`,
  `MessagingService.deleteForCustomer(customerId)`, `IdempotencyService.deleteForScope(scope)`.
- `test/support/admin-customers.ts`: `listAdminCustomers()`, `getAdminCustomer()`,
  `updateAdminCustomer()`, `anonymiseCustomer()`, `requestCustomerReset()`,
  `paidBookingOf()`.

## Tests

- Unit (`test/unit/modules/…`, collaborators mocked):
  - `customers/customer-search.test.ts`: substrings, the local mobile, wildcard escaping, the
    status filter, every value bound.
  - `customers/customer.service.test.ts` (extended): `updateDetails` (unchanged values write
    nothing, a new email clears verification and deletes links, `EMAIL_TAKEN` before and on the
    unique violation, anonymised `NOT_FOUND`, the audit names fields only), `anonymise`.
  - `admin-customers/admin-customers.service.test.ts`: settlement first, one stats call per page,
    numbers default to zero, detail and its recent bookings, edit then block in one transaction,
    reset refusals (`NOT_FOUND`, `CUSTOMER_BLOCKED`) and its audit.
  - `admin-customers/customer-anonymisation.service.test.ts`: the order of the steps, the
    refusals before any write, the audit counts with no personal data.
  - `admin-customers/dto/update-customer.request.test.ts`: the body rules.
- Integration (`test/integration/…`, real app and Postgres; only Resend replaced):
  - `migrations/0160_admin_customers.test.ts`: the indexes and their comments.
  - `admin-customers/admin-customers.controller.test.ts`: list order, paging, `total`, search by
    name, email, phone and local mobile, wildcards, the status filter, anonymised accounts left
    out; the numbers (bookings, spent, a refunded booking not counted, no-shows after the show
    ends, a checked-in booking not a no-show) and recent bookings; edits and `EMAIL_TAKEN`, a new
    email unverified with its links gone; block revokes every session and refuses sign-in and
    refresh with `ACCOUNT_BLOCKED`, unblock restores sign-in; the reset email queued with the link
    redacted in the stored copy and working from the real email; `CUSTOMER_BLOCKED`; box office
    reads but every admin route answers `FORBIDDEN`; audit rows carry no personal data.
  - `admin-customers/customer-anonymisation.test.ts`: exactly the listed fields nulled and rows
    deleted (another customer's rows untouched), bookings, payments, seats and audit events kept,
    the account's email free to register again, the anonymised customer's token and sign-in
    refused, a second delete `NOT_FOUND`.
  - The `customerId` filter of `GET /admin/bookings` is proven in the drawer test of
    `admin-customers.controller.test.ts` and in `bookings/admin-bookings.sql.test.ts` (unit);
    `bookings/customer-bookings.service.test.ts` covers the numbers and the contact clearing.

## Acceptance

- Gates pass (typecheck, lint, test with a nonzero pass count, build, contract committed).
- Tests prove: search and filters; block revokes sessions and refuses sign-in, unblock restores;
  anonymisation nulls exactly the listed fields, deletes exactly the listed rows and keeps
  bookings and payments; the reset email queues a message with a redacted link; no-show counts;
  box-office tokens refused where Admin only.
- `docs/system-design.md` updated: §5 (the `admin-customers` module), §11 (the admin customer
  routes as built), §21 (the anonymisation as built); `docs/INDEX.md` rows; README.

## Follow-ups

- **U9/U12**: `bookingCount` on `GET /me` can call `CustomerBookingsService.statsOf([id])`.
- **U18**: customer search can reuse `customerSearchOf()` and the trigram indexes added here.
- **U19**: the customers CSV with the list's filters (`customerListConditions()`), audited.
- **Product owner**: anonymising a customer with an upcoming paid booking keeps the ticket valid
  but leaves the booking with no contact, so a later showtime cancellation can tell no one.
  Refuse, or warn in the confirmation dialog?
