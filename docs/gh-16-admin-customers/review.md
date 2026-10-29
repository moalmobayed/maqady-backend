---
title: U15 — Review of the admin customers unit
owner: Mohamed Tarek
status: Passed — 2026-10-29, no open blocker or major findings
last_verified: 2026-10-29
tags: [review, admin-customers, anonymisation, block, password-reset, one-time-tokens, idempotency, lock-order]
---

# U15 — Review of the admin customers unit

Issue #16, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`8ec7042..e99e8cd` on `unit/gh-16-admin-customers`, and the files it touches. Reviewed against
design §5, §7.1, §7.4, §10, §11 (the admin customer routes), §13.1, §14.1 and §21 (the
anonymisation definition), PRD v2 A7, "Accounts" 5 and 6, "Email and SMS" and "Dashboard
numbers", the spec, and the `CLAUDE.md` stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. Every behaviour fix has a test that failed first.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **A customer "Forgot password" racing an admin email change or a "Delete account" left a live link behind.** `requestPasswordReset()` (U9) read the customer without a lock, then issued the link and queued its email. The admin edit and the anonymisation lock the customer, then delete the customer's links and messages. Their `DELETE` cannot see a link that is inserted but not yet committed, and inserting it does not conflict with their row lock. So a forgot-password committing just after them kept its link. After an email change, that is a working 1-hour reset link sent to the replaced address: the old mailbox could take the account back, which is the very thing the edit's link deletion is for. After an anonymisation, a token and a message carrying the old email stayed on the account. The window is narrow, and the route allows 3 a hour per email, but the guarantee did not hold. | Two race tests hold the forgot-password open, uncommitted, once its link is issued. One runs `PATCH /admin/customers/{id}` with a new email beside it (`admin-customers.controller.test.ts`), the other `DELETE` (`customer-anonymisation.test.ts`). Against the old code, the edit left an unused `customer_password_reset` row, and the deletion left 1 token and 1 message. | Fixed in `9e2969b`. The forgot-password now locks the customer row (`FOR NO KEY UPDATE`) and re-checks that it is live, active and still has that email before issuing. A change that comes first is waited for, then nothing is sent. A change that comes later waits for the link, then deletes it. Unit tests cover the changed email and the anonymised row. Design §10.5 records it. |
| R2 | minor | **Using a customer link deadlocked with U15's account changes.** `verifyEmail()` and `resetPassword()` (U9) consumed the link first, which locks its row, and then locked the customer. The admin email edit, the admin reset email and the anonymisation lock the customer first, then delete or replace the links. A link used while one of them ran formed a lock cycle. Postgres aborted one side with `40P01`, and only the write interceptor's single retry hid it. | A two-connection script on the dev database, in the two orders, got `40P01 deadlock detected`. A new race test in `customer-anonymisation.test.ts` holds the customer row and uses both kinds of link in their own transactions; against the old code it failed with `deadlock detected`. | Fixed in `e36e65a`. Both now read the live link without a lock (`findLive()`), lock the customer, then consume the link, as the staff password setup does (design §10.1). In the test, both uses now wait and then get `INVALID_TOKEN`. Unit tests cover the order and an unknown link, or one of another purpose. Design §10.5 records it. |
| R3 | minor | **The admin edit's stored answer replayed the details "Delete account" removed.** `PATCH /admin/customers/{id}` answers with the customer's name, email and phone. Sent with an `Idempotency-Key`, that answer is stored for 24 hours under the admin's scope (`staff:<id>`). Anonymisation deletes only scope `customer:<id>` (design §21), so the same request after the deletion replayed the old details. | A test edits with a key, anonymises, then sends the edit again. Against the old code it answered `200` with `Idempotent-Replayed: true` and the deleted email. | Fixed in `0b7d006`. The route is `@NoIdempotencyStorage()`. It sets values, so sending the same edit again changes nothing; the retry now answers `NOT_FOUND`. The contract was regenerated: the PATCH loses the optional `Idempotency-Key` header, `Idempotent-Replayed` and `422`. The Swagger text, design §11 and the spec's Decisions record it. |
| R4 | minor | **The spec's response names disagreed with the contract.** The spec called the list item `AdminCustomerListItem` and the page `AdminCustomerListItemPage`. It said `PATCH` answers the detail with `recentBookings`, and it listed an `enums.ts` that the module does not have. The contract has `AdminCustomer` (both the list item and `PATCH`'s answer, without `recentBookings`), `AdminCustomerDetail` and `AdminCustomerResponsePage`. | Compared the spec with `contracts/openapi.yaml` and the module's files. | Fixed in `88d1760`. The contract wins (`CLAUDE.md`, contract drift), so the spec now uses its names and fields. |
| R5 | minor | **One other stored answer still carries text that "Delete account" removes, for up to 24 hours.** R3's mechanism was checked for every keyed write. Its one other case is `POST /admin/bookings/{ref}/notes` (U14): the answer is the note, whose free-text body may name the customer, and it is stored under the staff member's scope. The anonymisation deletes the note itself, but not that stored copy. | Scanned the success schema of every keyed write in `contracts/openapi.yaml`. The booking answers (`Booking`, `PaymentResult`, `BookingEditResult`, `BookingRefundResult`) carry no contact. `StaffTicketDelivery` carries only channels. `BookingNote` carries the body. It is the same mechanism R3 reproduced. | **Open, by design scope.** A note is not idempotent, so its answer must stay stored, or a retry would add it twice. The copy is encrypted at rest. Only its author can replay it, with the same key and body, and only within 24 hours. Design §21 defines "their idempotency rows" as scope `customer:<id>`. Removing these copies would need a link from each key to a customer; this is a question for the design owner. |

No blocker was found. R1 (major) and R2–R4 (minor) are fixed. R5 (minor) stays open; it is
outside design §21's definition, and is recorded above for the design owner.

## Checked, with nothing to report

- **Lock order.** The anonymisation takes the customer row `FOR NO KEY UPDATE` (§7.1 step 4), then
  the customer's bookings `FOR UPDATE` in id order (step 5), then the session heads, links,
  idempotency rows and messages. These paths take the customer before any booking, so none forms
  a cycle with it:
  - holds, claims, checkout, and a counter sale to an existing customer;
  - settlement, refunds, edits, scans, staff resends and showtime cancellation, which never lock
    the customer.

  Messages about a booking are queued under that booking's lock, so the anonymisation's later
  `DELETE` sees them. A sign-in waits on the row and then fails its `password_hash` match. A
  profile edit, a password change and a verification resend lock the row and refuse an
  anonymised one. The CHECK `chk_customers_live_or_anonymised` makes a stray write fail rather
  than bring a value back. After R1 and R2, the forgot-password route and link use follow the
  same order.
- **Block and unblock.** U9's `setStatus()` locks the customer and revokes every session in the
  same transaction; equal values change nothing. The guard checks the account on every request,
  and refresh checks it before the session. The tests cover sign-in, refresh, the old access
  token and unblocking.
- **Edits.** A free email is checked against live accounts. A concurrent taker meets
  `uq_customers_email_live`, which is mapped to `EMAIL_TAKEN` and rolls the edit back. A change of
  letter case keeps the verification; a new address clears it and deletes the unused links.
- **Roles and access.** `@Staff()` on the two reads and `@Admin()` on the three writes. Box office
  gets `FORBIDDEN` on each write and customers get the guard's refusal; both are tested. Unknown
  and anonymised customers answer `NOT_FOUND`.
- **Personal data.** The new code logs nothing. The audit events carry field names and counts,
  never values. The reset email's stored copy hides the link. The DELETE and reset answers carry
  no personal data.
- **Numbers.** Bookings, Spent, No-shows and Last booking come from one grouped query per page
  (`whereIn`, no N+1). Completed comes from the shared `bookingStatusPredicate()`, so a show that
  has not ended is never a no-show, and a refunded booking drops out. Money is `INT` minor units
  with `EGP`.
- **Time.** No cinema-date arithmetic is added. Times are formatted in Cairo ISO with their
  offset, and the no-show rule compares the stored `ends_at` with the injected clock.
- **Pagination and search.** Keyset on (`created_at`, `id`), with an `instant` cursor that is
  validated (a bad one is `VALIDATION_FAILED`) and a `total`. `created_at` is written by the
  application clock at millisecond precision, so the ISO cursor is exact. `%`, `_` and `\` are
  escaped, and every value is bound.
- **Conventions.** The migration `0160_01` is indexes only, with each index commented and listed
  in `migration-list.ts`. The diff has no `SELECT *`, no plain `Error` or `HttpException` from a
  service, and no inline types outside `types.ts`. DTOs carry Swagger decorators, and the
  contract is regenerated and committed.
- **Environment note.** One full run hit the 5 s hook timeout in `migration.repository.test.ts`
  (`DROP DATABASE … WITH (FORCE)` on the shared Postgres), as the builder saw. It is unrelated to
  this unit and passes on its own and on the gate run below.
