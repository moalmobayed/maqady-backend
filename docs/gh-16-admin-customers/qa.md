---
title: U15 — Admin customers manual QA
owner: Mohamed Tarek
status: Passed
last_verified: 2026-10-29
tags: [qa, admin, customers, search, no-shows, block, password-reset, anonymisation, curl]
---

# U15 — Admin customers: manual QA

Run on 2026-10-29 just after midnight Cairo time (the responses read `2026-10-30T00:2x+02:00`:
summer time ended that night), on the real clock, against `maqady_u15_dev` seeded with
`npm run seed` (demo dataset), the app started from the build with `node dist/main.js` on port
3123 (`EMAIL_DRIVER=simulated`, `STORAGE_DRIVER=local`). `$API` is `http://localhost:3123/api/v1`.
The run is four scripts, every request below in order.

Setup. The seed admin (`seed-admin@maqady.local`, staff id 1) signs in through
`POST /admin/auth/sessions`. A box office member (`Hany Adel`, id 2) was created by a QA-only
command (the real `PasswordService.hash()` and an insert into `staff_users`: the invite link is not
readable with the simulated driver), then signed in through the real route. Three customers
registered through `POST /auth/registrations`: Layla Hassan (id 1, who set `01012345678` with
`PATCH /me`, stored `+201012345678`), Omar Khaled (id 2, `omar.k@mail.example.org`) and Nadia
Farouk (id 3, `nadia_f@example.com`). Layla held and paid by card three times on seeded showtime 92
(Nile After Midnight, theater 4; row E–F middle, EGP 190 a seat):

| Booking | Seats | Answer |
|---|---|---|
| `MQ-XZ3YCV` | E5, E6 | `{"status":"confirmed","payment":"succeeded","total":38000}` |
| `MQ-DVN65S` | F1 | `{"status":"confirmed","payment":"succeeded","total":19000}` |
| `MQ-7XSKVH` | F2 | `{"status":"confirmed","payment":"succeeded","total":19000}`, then `POST /admin/bookings/MQ-7XSKVH/refunds` → `{"status":"refunded"}` |

## The list, paging, search and filters

```bash
curl -s "$API/admin/customers?limit=2" -H "Authorization: Bearer $BOX"
```

`200 {"ids":[3,2],"total":3,"nextCursor":true}`; the first item:

```json
{ "id": 3, "fullName": "Nadia Farouk", "email": "nadia_f@example.com", "phone": null,
  "status": "active", "emailVerified": false, "emailVerifiedAt": null,
  "joinedAt": "2026-10-30T00:25:39+02:00", "lastSignInAt": "2026-10-30T00:25:39+02:00",
  "updatedAt": "2026-10-30T00:25:39+02:00",
  "stats": { "bookings": 0, "spent": { "amount": 0, "currency": "EGP" }, "noShows": 0, "lastBookingAt": null } }
```

The next page (`cursor=<nextCursor>`): `{"ids":[1],"total":3,"nextCursor":null}`.

`GET /admin/customers?q=…` as admin:

| `q` | Answer |
|---|---|
| `layla` | `{"ids":[1],"total":1}` |
| `KHALED` | `{"ids":[2],"total":1}` |
| `mail.example.org` | `{"ids":[2],"total":1}` |
| `01012345678` (local mobile) | `{"ids":[1],"total":1}` |
| `%2B2010123` (`+2010123`) | `{"ids":[1],"total":1}` |
| `a_f` (`_` literal) | `{"ids":[3],"total":1}` |
| `%25%25` (`%%`, literal) | `{"ids":[],"total":0}` |
| `nobody` | `{"ids":[],"total":0}` |

Refusals: `q=a`, `status=deleted`, `cursor=bad`, `limit=101` each answer `400 VALIDATION_FAILED`
naming `q`, `status`, `cursor` and `limit`; `GET /admin/customers/999999` is `404 NOT_FOUND`.

## The drawer, the numbers and no-shows

```bash
curl -s $API/admin/customers/1 -H "Authorization: Bearer $ADMIN"
```

```json
{ "id": 1, "fullName": "Layla Hassan", "email": "layla.hassan@example.com", "phone": "+201012345678",
  "status": "active", "emailVerified": false, "joinedAt": "2026-10-30T00:25:38+02:00",
  "stats": { "bookings": 2, "spent": { "amount": 57000, "currency": "EGP" }, "noShows": 0,
             "lastBookingAt": "2026-10-30T00:25:39+02:00" },
  "recentBookings": [
    { "reference": "MQ-7XSKVH", "status": "refunded", "paymentStatus": "refunded", "seatLabels": ["F2"], "total": 19000 },
    { "reference": "MQ-DVN65S", "status": "confirmed", "paymentStatus": "paid", "seatLabels": ["F1"], "total": 19000 },
    { "reference": "MQ-XZ3YCV", "status": "confirmed", "paymentStatus": "paid", "seatLabels": ["E5","E6"], "total": 38000 } ] }
```

(trimmed to those fields). The refunded booking is listed but not counted. All of Layla's bookings:
`GET /admin/bookings?customerId=1` (box office) → `{"refs":["MQ-7XSKVH","MQ-DVN65S","MQ-XZ3YCV"],"total":3}`.

No-shows need a show that has ended, which the real clock cannot give a booking made now. A
**QA-only SQL step** on the development database moved showtime 92 to have started 20 minutes
earlier (scan window open), then to have ended 10 minutes earlier:

| Step | Answer |
|---|---|
| `POST /admin/scans {"theaterId":4,"reference":"MQ-DVN65S","confirm":true}` (box office) | `{"result":"VALID","admits":1}` |
| drawer stats during the show | `{"bookings":2,"spent":{"amount":57000,…},"noShows":0,…}` |
| drawer stats after the show ended | `{"bookings":2,"spent":{"amount":57000,…},"noShows":1,…}` |
| list row (`q=layla`) after the show | `{"bookings":2,…,"noShows":1,…}` |

`MQ-XZ3YCV` (never scanned) is the no-show; the scanned `MQ-DVN65S` and the refunded `MQ-7XSKVH`
are not.

## Edits

Before: Layla has one unused `verify_email` link. Then:

```bash
curl -s -X PATCH $API/admin/customers/1 -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"fullName":"  Layla H. Mansour ","email":"layla.mansour@example.com","phone":"01198765432"}'
```

`200 {"id":1,"fullName":"Layla H. Mansour","email":"layla.mansour@example.com","phone":"+201198765432","emailVerified":false,"stats":{"bookings":2,…,"noShows":1,…}}`.
Her one-time links left: `0`. Sign-in with `LAYLA.MANSOUR@example.com`: `201`.

| Request | Answer |
|---|---|
| `{"email":"OMAR.K@mail.example.org"}` | `409 EMAIL_TAKEN` |
| `{}` | `400 VALIDATION_FAILED`, `[{"field":"fullName","messages":["send fullName, email, phone or status"]}]` |
| `{"phone":"12345","status":"deleted"}` | `400 VALIDATION_FAILED` on `phone` and `status` |

## Block and unblock

Omar signs in (`GET /me` → `200`), then:

| Step | Answer |
|---|---|
| `PATCH /admin/customers/2 {"status":"blocked"}` | `{"id":2,"status":"blocked"}` |
| his sessions | `account_blocked|2` (both revoked) |
| `GET /me` with his token | `403 ACCOUNT_BLOCKED` |
| `POST /auth/sessions` | `ACCOUNT_BLOCKED` |
| `POST /auth/tokens` with his refresh token | `ACCOUNT_BLOCKED` |
| `GET /admin/customers?status=blocked` (box office) | `{"ids":[2],"total":1}` |
| `POST /admin/customers/2/password-reset-requests` | `409 CUSTOMER_BLOCKED` |
| `PATCH /admin/customers/2 {"status":"active"}` | `{"id":2,"status":"active"}` |
| `POST /auth/sessions` | `201` |
| `GET /me` with the old token | `SESSION_REVOKED` (the block's revocation stays) |

## The reset email

```bash
curl -s -X POST $API/admin/customers/2/password-reset-requests -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $KEY"
```

`202 {"channel":"email","queuedAt":"2026-10-30T00:26:12+02:00"}`; the same key again: `202`, the
same body, `Idempotent-Replayed: true` (shown again for Nadia: `202 … Idempotent-Replayed: true`).
Without a key: `IDEMPOTENCY_KEY_REQUIRED`. One `customer.password_reset` message for Omar; the
Message log (`GET /admin/messages/{id}`):

```json
{"template":"customer.password_reset","recipient":"omar.k@mail.example.org","status":"sent",
 "subject":"Reset your Maqady password","link":"[one-time link hidden]","hasToken":false}
```

## Roles

| Request | Answer |
|---|---|
| `GET /admin/customers`, `GET /admin/customers/{id}` with the box office token | `200` (above) |
| `PATCH /admin/customers/2` (box office) | `FORBIDDEN` |
| `DELETE /admin/customers/2` (box office) | `FORBIDDEN` |
| `POST /admin/customers/2/password-reset-requests` (box office) | `FORBIDDEN` |
| `GET /admin/customers` with a customer token | `UNAUTHENTICATED` |
| `GET /admin/customers` with no token | `UNAUTHENTICATED` |

## Anonymisation

The box office first adds a note on `MQ-XZ3YCV`. Layla's footprint
(sessions | tokens | idempotency keys | messages | notes | bookings | payments | seats):

```
before: 2|0|6|8|1|3|4|4
1|layla.mansour@example.com|Layla H. Mansour|+201198765432|t|active|
MQ-XZ3YCV|confirmed|38000|Layla Hassan|layla.hassan@example.com|+201012345678|f
MQ-DVN65S|confirmed|19000|Layla Hassan|layla.hassan@example.com|+201012345678|t
MQ-7XSKVH|refunded|19000|Layla Hassan|layla.hassan@example.com|+201012345678|f
```

```bash
curl -s -X DELETE $API/admin/customers/1 -H "Authorization: Bearer $ADMIN"
```

`200 {"customerId":1,"anonymisedAt":"2026-10-30T00:26:41+02:00","bookingsKept":3,"removed":{"sessions":2,"oneTimeTokens":0,"idempotencyKeys":6,"messages":8,"bookingNotes":1,"bookingContacts":3}}`

```
after:  0|0|0|0|0|3|4|4
1||||f|active|t
MQ-XZ3YCV|confirmed|38000||||f
MQ-DVN65S|confirmed|19000||||t
MQ-7XSKVH|refunded|19000||||f
```

Bookings, payments, seats, totals and the check-in stay; Omar and Nadia are untouched
(`2:Omar Khaled, 3:Nadia Farouk`). Afterwards:

| Request | Answer |
|---|---|
| `DELETE /admin/customers/1` again | `NOT_FOUND` |
| `GET /admin/customers/1` | `NOT_FOUND` |
| `GET /admin/customers` | `{"ids":[3,2],"total":2}` |
| `GET /me` with Layla's old token | `UNAUTHENTICATED` |
| `POST /auth/sessions` as `layla.mansour@example.com` | `INVALID_CREDENTIALS` |
| `GET /admin/bookings/MQ-XZ3YCV` | `{"status":"completed","contact":{"name":null,"email":null,"phone":null},"customer":{"id":1,"fullName":null,"email":null,"phone":null,"status":"active","anonymised":true}}` |
| `POST /auth/registrations` with `layla.mansour@example.com` | `201` (the email is free again) |

## Audit rows and log hygiene

```
customer.updated|1|1|{email,fullName,phone}|{}
customer.status_changed|1|2|{status}|{"status": "blocked"}
customer.status_changed|1|2|{status}|{"status": "active"}
customer.password_reset_sent|1|2|{}|{}
customer.password_reset_sent|1|3|{}|{}
customer.anonymised|1|1|{email,fullName,passwordHash,phone}|{"bookingsKept": 3, "linksDeleted": 0, "notesDeleted": 1, "contactsCleared": 3, "messagesDeleted": 8, "sessionsDeleted": 2, "idempotencyKeysDeleted": 6}
```

`audit_events` rows whose metadata matches `layla|omar|example|+20`: `0`. The app log of the run
(296 lines) holds none of the customers' names, emails or phones (`grep -ci` for each: `0`).

The app was stopped by its PID afterwards. Showtime 92 of the development database keeps the
QA-only times.
