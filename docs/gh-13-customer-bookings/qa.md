---
title: U12 — Customer bookings manual QA
owner: Mohamed Tarek
status: Recorded
last_verified: 2026-10-29
tags: [bookings, my-bookings, history, email-again, rate-limit, qa, curl]
---

# U12 — Customer bookings: manual QA

Issue #13. The app ran locally from `npm run build` and `node dist/main.js` on port 3120 against
`maqady_u12_dev`, which `npm run seed` migrated to `0130_01` and filled with the demo dataset (the
seed admin, 6 theaters, 12 movies, 129 showtimes). Every endpoint this unit added was called with
`curl` through three scripts kept outside the repository; responses are trimmed with `jq` to the
fields that matter. The clock is the real one (29 October 2026, the evening Cairo leaves summer
time, so times after midnight carry `+02:00`): the instant a booking moves from Upcoming to Past,
and the 00:45 cinema-day split, are proven by the integration suites, which move a `TestClock`
(`my-bookings.controller.test.ts`). Showtime 51 is Maqady Downtown's `Hall 1` at 00:15 on cinema
date 29 October (calendar 30 October); 53 and 78 are 13:30 shows on 30 October.

```bash
B=http://localhost:3120/api/v1
key() { cat /proc/sys/kernel/random/uuid; }
reg() { curl -s -X POST $B/auth/registrations -H 'Content-Type: application/json' \
  -d "{\"fullName\":\"$1\",\"email\":\"$2\",\"password\":\"Passw0rd-qa-u12\"}" | jq -r .accessToken; }
hold() { curl -s -X POST $B/showtimes/$2/holds -H "Authorization: Bearer $1" -H "Idempotency-Key: $(key)" \
  -H 'Content-Type: application/json' -d "{\"seats\":$3}" | jq -r .reference; }
pay() { curl -s -X POST $B/bookings/$2/payments -H "Authorization: Bearer $1" -H "Idempotency-Key: $(key)" \
  -H 'Content-Type: application/json' -d "{\"method\":\"card\",\"token\":\"$3\"}" | jq -c '{payment: .payment.status, status: .booking.status}'; }
send() { curl -s -i -X POST "$B/bookings/$1/ticket-deliveries" -H "Authorization: Bearer $2" ${3:+-H "Idempotency-Key: $3"}; }
```

## 1. One customer's bookings in every status

Mona (with a phone on file) pays for E7 and E8 on showtime 51 (A), is declined on 78 (F), pays
slowly for 53 (R), which the admin then cancels, and after the settlement holds F11 on 78 (L),
which replaces F.

```bash
A=$(hold $MONA 51 '["E7","E8"]'); pay $MONA $A sim_card_visa
F=$(hold $MONA 78 '["F10"]');     pay $MONA $F sim_card_declined
R=$(hold $MONA 53 '["F2"]');      pay $MONA $R sim_card_slow
curl -s -X PATCH $B/admin/showtimes/53 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $(key)" \
  -H 'Content-Type: application/json' -d '{"status":"cancelled","cancelReason":"technical_issue"}'
hold $MONA 78 '["F11"]'     # while R's payment processes
sleep 11; curl -s -i "$B/me/bookings" -H "Authorization: Bearer $MONA"   # settles R first
L=$(hold $MONA 78 '["F11"]')
```

```
A=MQ-CJXBRT  {"payment":"succeeded","status":"confirmed"}
F=MQ-6MJ2GM  {"payment":"declined","status":"held"}
R=MQ-2YF69J  {"payment":"processing","status":"held"}
{"id":53,"status":"cancelled"}
{"code":"PAYMENT_IN_PROGRESS",…}
HTTP/1.1 200 OK
Cache-Control: private, no-store
L=MQ-8ZGUCM
```

## 2. `GET /me/bookings`

Upcoming holds only A. The 00:15 show carries cinema date 29 October although it starts on the
30th, and the card shows "Visa •••• 4242".

```bash
curl -s "$B/me/bookings" -H "Authorization: Bearer $MONA"
```

```
{"total":1,"tabCounts":{"upcoming":1,"past":2},"nextCursor":null,"items":[{"reference":"MQ-CJXBRT","status":"confirmed","paymentStatus":"paid","seatLabels":["E7","E8"],"total":{"amount":38000,"currency":"EGP"},"payment":{"status":"succeeded","card":{"brand":"visa","last4":"4242"}},"refund":null,"showtime":{"id":51,"startsAt":"2026-10-30T00:15:00+02:00","endsAt":"2026-10-30T01:56:00+02:00","cinemaDate":"2026-10-29","theater":"Maqady Downtown","hall":"Hall 1"}}]}
```

Past holds the refunded and the failed booking; the live hold L and no abandoned hold appear in
either tab. Same start, so the higher id first.

```bash
curl -s "$B/me/bookings?tab=past" -H "Authorization: Bearer $MONA"
```

```
{"total":2,"tabCounts":{"upcoming":1,"past":2},"items":[
 {"reference":"MQ-2YF69J","status":"refunded","paymentStatus":"refunded","confirmedAt":"2026-10-29T20:58:09+03:00","refund":{"amount":{"amount":19000,"currency":"EGP"},"refundedAt":"2026-10-29T20:58:09+03:00"},"showtime":{"id":53,"startsAt":"2026-10-30T13:30:00+02:00"}},
 {"reference":"MQ-6MJ2GM","status":"failed","paymentStatus":"declined","confirmedAt":null,"refund":null,"showtime":{"id":78,"startsAt":"2026-10-30T13:30:00+02:00"}}]}
```

Pages of one, then the cursor:

```
{"refs":["MQ-2YF69J"],"nextCursor":"WyIyMDI2LTEwLTMwVDExOjMwOjAwLjAwMFoiLDNd"}
{"refs":["MQ-6MJ2GM"],"nextCursor":null}
```

Refusals: an unknown tab, a tampered cursor, no token, a staff token.

```
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"tab","messages":["tab must be one of the following values: upcoming, past"]}]}}
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"cursor","messages":["cursor is not valid; pass nextCursor from the previous page"]}]}}
401 "UNAUTHENTICATED"
401
```

## 3. `GET /bookings/{ref}`: seat lines, refund, Directions

```bash
curl -s "$B/bookings/$A" -H "Authorization: Bearer $MONA" | jq -c '{status, seatLines, refund, theater: .showtime.theater}'
curl -s "$B/bookings/$R" -H "Authorization: Bearer $MONA" | jq -c '{status, paymentStatus, total, refund, seatLines: [.seatLines[] | {zone, labels, count}]}'
```

```
{"status":"confirmed","seatLines":[{"zone":"middle","labels":["E7","E8"],"count":2,"unitPrice":{"amount":19000,"currency":"EGP"},"amount":{"amount":38000,"currency":"EGP"}}],"refund":null,"theater":{"id":2,"name":"Maqady Downtown","address":"12 Talaat Harb Street, Downtown","district":"Downtown","city":"Cairo","latitude":30.0478,"longitude":31.2384}}
{"status":"refunded","paymentStatus":"refunded","total":{"amount":19000,"currency":"EGP"},"refund":{"amount":{"amount":19000,"currency":"EGP"},"refundedAt":"2026-10-29T20:58:09+03:00"},"seatLines":[{"zone":"middle","labels":["F2"],"count":1}]}
```

## 4. `POST /bookings/{ref}/ticket-deliveries` ("Email again")

A new key queues the email; the same key replays it.

```bash
K=$(key); send $A $MONA $K; send $A $MONA $K
```

```
HTTP/1.1 201 Created
{"channel":"email","queuedAt":"2026-10-29T20:58:36+03:00"}
HTTP/1.1 201 Created
Idempotent-Replayed: true
{"channel":"email","queuedAt":"2026-10-29T20:58:36+03:00"}
```

The messages of A: the confirmation's email and SMS, then one email only (no SMS although Mona
has a phone), to her account email, sent, its ticket link redacted in the stored copy.

```bash
psql -d maqady_u12_dev -Atc "select id, channel, template, recipient, status,
  position('[one-time link hidden]' in body_text) > 0, related_booking_id is not null
  from maqady.messages where related_booking_id = (select id from maqady.bookings where reference='MQ-CJXBRT') order by id"
```

```
2|email|booking.tickets|mona-1793296670@qa.maqady.local|sent|t|t
3|sms|booking.tickets_sms|+201012345678|sent|t|t
4|email|booking.tickets|mona-1793296670@qa.maqady.local|sent|t|t
```

The limit is 3 an hour per booking and caller, and the replay counted: the third request is a
`201`, the fourth a `429`.

```
HTTP/1.1 201 Created
HTTP/1.1 429 Too Many Requests
Retry-After: 3600
{"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again shortly.","details":null,…}}
```

Refusals: the failed, the live and the refunded booking; no key; another customer; a malformed
reference.

```
{"code":"TICKET_NOT_AVAILABLE","details":{"status":"failed"}}
{"code":"TICKET_NOT_AVAILABLE","details":{"status":"held"}}
{"code":"TICKET_NOT_AVAILABLE","details":{"status":"refunded"}}
"IDEMPOTENCY_KEY_REQUIRED"
"NOT_FOUND"
"VALIDATION_FAILED"
```

## 5. `GET /bookings/{ref}/history`

After the two sends, the admin moves showtime 51 to 00:10 (`PATCH /admin/showtimes/51
{"startTime":"00:10"}`; 00:20 was refused `OUTSIDE_OPENING_HOURS`). A's History, oldest first:
the hold and the payment (same second), the two real sends (the replay wrote nothing), the move.
The claim of a hold, a decline and `booking.confirmed` never show.

```
HTTP/1.1 200 OK
Cache-Control: private, no-store
[["seats_held","2026-10-29T20:57:51+03:00"],["payment_received","2026-10-29T20:57:51+03:00"],["tickets_resent","2026-10-29T20:58:36+03:00"],["tickets_resent","2026-10-29T20:58:36+03:00"],["changed_by_cinema","2026-10-29T20:58:50+03:00"]]
```

Pages of two (before the move), the refunded and the failed booking:

```
{"kinds":["seats_held","payment_received"],"total":4,"nextCursor":"WyIyMDI2LTEwLTI5VDE3OjU3OjUxLjExNFoiLDMzNl0"}
{"kinds":["tickets_resent","tickets_resent"],"nextCursor":null}
["Seats held","Payment received","Refunded"]
["Seats held"]
```

Refusals: another customer, an unknown reference, no token.

```
"NOT_FOUND"
"NOT_FOUND"
"UNAUTHENTICATED"
```

## 6. Logs

The app's log for the whole session (233 lines, 12 of them naming `ticket-deliveries`) holds no
email address, name, phone number, ticket link or QR payload:

```bash
grep -cE "mona-|Mona Adel|1012345678|ticket\?token|MQ1\." app.log
```

```
0
```
