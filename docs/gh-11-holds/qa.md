---
title: U10 — Holds and live seat map manual QA
owner: Mohamed Tarek
status: Recorded
last_verified: 2026-10-20
tags: [holds, seat-map, websocket, qa, curl]
---

# U10 — Holds and live seat map: manual QA

Issue #11. The app ran locally from `npm run build` and `node dist/main.js` on port 3114
against `maqady_u10_dev`, which `npm run migrate` brought to `0110_05` and `npm run seed` filled
(the seed admin, 6 theaters, Zamalek's `Hall 1` of 12 × 16 seats, 12 movies). Every endpoint
this unit added was called with `curl`; the seat map with a small `ws` client (Node, the
worktree's own `ws`). Responses are trimmed with `jq` to the fields that matter. The clock is the
real one, so expiry by time is not shown here: the integration suites move a `TestClock` for
that (`holds.controller.test.ts`, `hall-in-use.test.ts`, `seat-claims.repository.test.ts`).

```bash
B=http://localhost:3114/api/v1
ADMIN=$(curl -s -X POST $B/admin/auth/sessions -H 'Content-Type: application/json' \
  -d '{"email":"seed-admin@maqady.local","password":"Maqady-seed-2026"}' | jq -r .accessToken)
```

## 1. Two showtimes to hold

```bash
curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"movieId":1,"hallId":1,"dates":["2026-10-22"],"startTime":"19:30","skipUnavailable":false}'
# and again with "startTime":"22:30"
```

```
{"createdCount":1,"showtime":{"id":1,"startsAt":"2026-10-22T19:30:00+03:00","status":"scheduled","seatCapacity":192}}
{"createdCount":1,"showtime":{"id":2,"startsAt":"2026-10-22T22:30:00+03:00","status":"scheduled","seatCapacity":192}}
```

## 2. The seat page: `GET /showtimes/{id}` and `/seats`

```bash
curl -s -D - $B/showtimes/1
curl -s $B/showtimes/1/seats
```

```
HTTP/1.1 200 OK
Cache-Control: no-store
{"id":1,"startsAt":"2026-10-22T19:30:00+03:00","endsAt":"2026-10-22T21:38:00+03:00","cinemaDate":"2026-10-22",
 "movie":{"id":1,"title":"The Last Lighthouse","ageRating":"12+","runtimeMinutes":128,"poster":<3 variants>},
 "theater":{"id":1,"name":"Maqady Zamalek"},"hall":{"id":1,"name":"Hall 1"},
 "prices":{"front":{"amount":15000,"currency":"EGP"},"middle":{"amount":19000,"currency":"EGP"},"back":{"amount":23000,"currency":"EGP"}},
 "fromPrice":{"amount":15000,"currency":"EGP"},"seatCapacity":192,
 "layout":{"rowCount":12,"seatsPerRow":16,"aisleAfter":[4,12],"seatCount":192,"rows":<12>},
 "bookable":true,"notBookableReason":null,"maxSeatsPerHold":8,"holdMinutes":5}

{"showtimeId":1,"serverTime":"2026-10-21T04:31:26+03:00","seats":[],"availableCount":192,"soldOut":false}
```

## 3. A guest hold, its replay and a refused rival

```bash
K1=$(uuidgen)
curl -s -X POST $B/showtimes/1/holds -H 'Content-Type: application/json' -H "Idempotency-Key: $K1" -d '{"seats":["F8","F7"]}'
curl -s -D - -X POST $B/showtimes/1/holds -H 'Content-Type: application/json' -H "Idempotency-Key: $K1" -d '{"seats":["F8","F7"]}'
curl -s -X POST $B/showtimes/1/holds -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" -d '{"seats":["F9","F8"]}'
psql … -c 'SELECT showtime_id, seat_count FROM maqady.hold_refusals'
```

```
{"reference":"MQ-JFNGPD","status":"held","owner":"guest",
 "seats":[{"label":"F7","zone":"middle","price":19000},{"label":"F8","zone":"middle","price":19000}],
 "total":{"amount":38000,"currency":"EGP"},"holdExpiresAt":"2026-10-21T04:36:26+03:00",
 "serverTime":"2026-10-21T04:31:26+03:00","holdCode":<43 characters>}

HTTP/1.1 201 Created
Idempotent-Replayed: true          (same body, hold code included)

{"code":"SEAT_TAKEN","details":{"seats":["F8"]}}
1|2                                (hold_refusals: showtime 1, 2 seats asked for)
```

## 4. Reading the hold: only with its code

```bash
curl -s $B/showtimes/1/seats
curl -s -o /dev/null -w '%{http_code}\n' $B/bookings/MQ-JFNGPD
curl -s -o /dev/null -w '%{http_code}\n' $B/bookings/MQ-JFNGPD -H 'X-Hold-Token: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
curl -s $B/bookings/MQ-JFNGPD -H "X-Hold-Token: $CODE"
```

```
{"seats":[{"label":"F7","state":"held","heldUntil":"2026-10-21T04:36:26+03:00"},
          {"label":"F8","state":"held","heldUntil":"2026-10-21T04:36:26+03:00"}],"availableCount":190,"soldOut":false}
404   (no code)
404   (wrong code)
{"reference":"MQ-JFNGPD","status":"held","owner":"guest","seatCount":2,"total":{"amount":38000,"currency":"EGP"}}
```

Stored: the code's SHA-256 only, no contact; the audit row has the booking and no personal data.

```
MQ-JFNGPD|held|customer_id null: t|hash length 64|hash = sha256(code): t|contact_email null: t
booking.held|system|booking_id set: t|{"holder": "guest", "channel": "online", "seatCount": 2, "showtimeId": 1}
```

## 5. Claiming at sign-up (`POST /auth/registrations`, then `POST /holds/{ref}/claims`)

```bash
CUST=$(curl -s -X POST $B/auth/registrations -H 'Content-Type: application/json' \
  -d '{"fullName":"Nour Samir","email":"qa-…@example.com","password":"Passw0rd-qa"}' | jq -r .accessToken)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/holds/MQ-JFNGPD/claims -H "Authorization: Bearer $CUST" -H "Idempotency-Key: $(uuidgen)"
curl -s -X POST $B/holds/MQ-JFNGPD/claims -H "Authorization: Bearer $CUST" -H "Idempotency-Key: $(uuidgen)" -H "X-Hold-Token: $CODE"
curl -s -o /dev/null -w '%{http_code}\n' $B/bookings/MQ-JFNGPD -H "X-Hold-Token: $CODE"
curl -s $B/bookings/MQ-JFNGPD -H "Authorization: Bearer $CUST"
```

```
400   (no X-Hold-Token: VALIDATION_FAILED)
{"reference":"MQ-JFNGPD","status":"held","owner":"customer","holdExpiresAt":"2026-10-21T04:36:26+03:00","holdCode":null}
404   (the code is useless after the claim)
{"reference":"MQ-JFNGPD","status":"held","owner":"customer"}
customer_id set: t|hold_token_hash null: t|Nour Samir|contact_email = the account's: t
```

The expiry did not move (`04:36:26`, as when the guest held).

## 6. One live hold per customer: a hold on another showtime replaces it

```bash
curl -s -X POST $B/showtimes/2/holds -H "Authorization: Bearer $CUST" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d '{"seats":["G5"]}'
curl -s $B/showtimes/1/seats
curl -s $B/bookings/MQ-JFNGPD -H "Authorization: Bearer $CUST"
```

```
{"reference":"MQ-3UQ7FU","owner":"customer","seats":["G5"],"holdCode":null}
{"seats":[],"availableCount":192}
{"reference":"MQ-JFNGPD","status":"abandoned","holdExpiresAt":"2026-10-21T04:31:26+03:00"}
```

## 7. Refusals

```bash
… -d '{"seats":["I1","A21"]}'                                     # holds
… -d '{"seats":["A1","A2","A3","A4","A5","A6","A7","A8","A9"]}'
… -d '{"seats":["N1"]}'                                           # a row the hall does not have
curl -s -X POST $B/showtimes/1/holds -H 'Content-Type: application/json' -d '{"seats":["A1"]}'   # no key
… $B/showtimes/999999/holds …
curl -s $B/bookings/MQ-222222 ; curl -s $B/bookings/MQ-0OIL11
curl -s $B/bookings/MQ-3UQ7FU -H "Authorization: Bearer $ADMIN"   # a staff token on a guest route
```

```
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"seats","messages":["each seat must be a label such as F7 (row A to P without I, seat 1 to 20)"]}]}}
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"seats","messages":["seats must contain no more than 8 elements"]}]}}
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"seats.0","messages":["Not a seat in this hall."]}]}}
"IDEMPOTENCY_KEY_REQUIRED"
"NOT_FOUND"
"NOT_FOUND"          (MQ-222222, well formed, unknown)
"VALIDATION_FAILED"  (MQ-0OIL11 uses 0, O, I, L)
"UNAUTHENTICATED"
```

## 8. The hall lock with a live claim (`HALL_IN_USE`)

```bash
curl -s -X PUT $B/admin/halls/1/layout -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"rowCount":12,"seatsPerRow":16,"rowZones":[…12 zones…],"seatMarks":[]}'
```

```
{"code":"HALL_IN_USE","details":{"showtimes":[{"id":2,"startsAt":"2026-10-22T22:30:00+03:00","movieTitle":"The Last Lighthouse"}]}}
```

## 9. Release (`DELETE /holds/{ref}`)

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $B/holds/MQ-3UQ7FU -H "Authorization: Bearer $CUST"   # twice
curl -s $B/bookings/MQ-3UQ7FU -H "Authorization: Bearer $CUST"
curl -s $B/showtimes/2/seats
```

```
204
204   (already ended: no change)
{"status":"abandoned","holdExpiresAt":"2026-10-21T04:31:26+03:00","serverTime":"2026-10-21T04:31:27+03:00"}
{"seats":[],"availableCount":192}
booking.released|customer|replaced     (the re-pick in step 6)
booking.released|customer|released
```

## 10. Sales paused

```bash
curl -s -X PATCH $B/admin/theaters/1 -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"status":"sales_paused"}'
curl -s $B/showtimes/1 ; curl -s -X POST $B/showtimes/1/holds … -d '{"seats":["A1"]}'
# then back to "active"
```

```
{"bookable":false,"notBookableReason":"sales_paused"}
{"code":"SHOWTIME_NOT_BOOKABLE","details":{"reason":"sales_paused"}}
{"bookable":true,"notBookableReason":null}     (after resuming)
```

## 11. The live seat map (`/ws`)

A `ws` client with `Origin: http://localhost:5173`, holds and releases made with `curl` meanwhile:

```
subscribe 1 -> {"event":"snapshot","data":{"showtimeId":1,"serverTime":"2026-10-21T04:31:46+03:00","seats":[]}}
POST hold H3,H4 -> MQ-ND6BH6
pushed -> {"event":"seat.held","data":{"showtimeId":1,"labels":["H3","H4"],"heldUntil":"2026-10-21T04:36:46+03:00"}}
DELETE hold -> {"event":"seat.released","data":{"showtimeId":1,"labels":["H3","H4"]}}
subscribe 2 -> {"event":"snapshot","data":{"showtimeId":2,…,"seats":[]}}
subscribe 3 -> {"event":"snapshot","data":{"showtimeId":3,…,"seats":[]}}
subscribe 4 (a 4th) -> {"event":"error","data":{"code":"RATE_LIMITED"}}
subscribe "x" -> {"event":"error","data":{"code":"VALIDATION_FAILED"}}
Origin https://evil.example -> {"event":"error","data":{"code":"FORBIDDEN"}} close 1008
no Origin -> {"event":"error","data":{"code":"FORBIDDEN"}} close 1008
5 KB message -> close 1009
```

## 12. Logs

The run wrote 199 lines. None holds the hold code, the customer's name or email. Every request
line has its route template, status and principal kind; there is no `5xx`. The one `error` line
is Nest's `WsAdapter` logging the 5 KB message's `RangeError: Max payload size exceeded` (a
client fault, follow-up below).

## Findings

- **Follow-up (minor):** `@nestjs/platform-ws` logs a client's oversized message at `error`
  level with a stack, so any client can write error lines. The socket is closed correctly
  (`1009`). Lowering it needs a `WsAdapter` subclass; recorded in the spec's follow-ups.
- Everything else behaved as the spec says.
