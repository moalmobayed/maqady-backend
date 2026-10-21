---
title: U11 — Checkout manual QA
owner: Mohamed Tarek
status: Recorded
last_verified: 2026-10-20
tags: [checkout, payments, settlement, tickets, qr, pdf, ics, qa, curl]
---

# U11 — Checkout: manual QA

Issue #12. The app ran locally from `npm run build` and `node dist/main.js` on port 3115 against
`maqady_u11_dev`, which `npm run migrate` brought to `0120_01` and `npm run seed` filled (the
seed admin, 6 theaters, 12 movies, 144 showtimes). Every endpoint this unit added was called
with `curl`, through three scripts kept outside the repository; responses are trimmed with `jq`
to the fields that matter. The clock is the real one, so the slow payments below really wait
10 seconds; the hold timer to the millisecond is proven by the integration suites, which move a
`TestClock` (`booking-payments.controller.test.ts`, `settlement.service.test.ts`). Showtime 2 is
Zamalek's `Hall 1` on Thursday 22 October at 13:30 (`ST=2`).

```bash
B=http://localhost:3115/api/v1
key() { cat /proc/sys/kernel/random/uuid; }
reg() { curl -s -X POST $B/auth/registrations -H 'Content-Type: application/json' \
  -d "{\"fullName\":\"$1\",\"email\":\"$2\",\"password\":\"Passw0rd-qa-u11\"}" | jq -r .accessToken; }
hold() { curl -s -X POST $B/showtimes/2/holds -H "Authorization: Bearer $1" -H "Idempotency-Key: $(key)" \
  -H 'Content-Type: application/json' -d "{\"seats\":$2}"; }
pay() { curl -s -i -X POST $B/bookings/$2/payments -H "Authorization: Bearer $1" \
  -H "Idempotency-Key: ${4:-$(key)}" -H 'Content-Type: application/json' -d "$3"; }
```

## 1. A customer pays by Visa

```bash
MONA=$(reg 'Mona Adel' mona-…@qa.maqady.local)
curl -s -X PATCH $B/me -H "Authorization: Bearer $MONA" -H 'Content-Type: application/json' -d '{"phone":"01012345678"}'
hold $MONA '["E7","E8"]'
```

```
{"fullName":"Mona Adel","phone":"+201012345678"}
{"reference":"MQ-SZHABB","status":"held","paymentStatus":"unpaid","payment":null,"ticket":null,"total":{"amount":38000,"currency":"EGP"},"holdExpiresAt":"2026-10-21T06:29:35+03:00"}
```

```bash
K=$(key); pay $MONA MQ-SZHABB '{"method":"card","token":"sim_card_visa"}' $K
```

```
HTTP/1.1 201 Created
{"payment":{"status":"succeeded","method":"card","amount":{"amount":38000,"currency":"EGP"},"card":{"brand":"visa","last4":"4242"},"walletType":null,"createdAt":"2026-10-21T06:24:35+03:00","completedAt":"2026-10-21T06:24:35+03:00","settlesAt":null},
 "booking":{"reference":"MQ-SZHABB","status":"confirmed","paymentStatus":"paid","confirmedAt":"2026-10-21T06:24:35+03:00","ticket":{"qrCode":"MQ1.MQ-SZHABB.1.6b-qUbtka1hBIR1kWGKlGA","admits":2}}}
```

Pressing Pay again: the same key replays, a new key is refused.

```
HTTP/1.1 201 Created
Idempotent-Replayed: true
"succeeded"
{"code":"ALREADY_PAID","message":"This booking is already paid.","details":null,"correlationId":"683beafe-…"}
```

`GET /bookings/MQ-SZHABB` and the seat snapshot:

```
{"status":"confirmed","paymentStatus":"paid","payment":{"status":"succeeded","card":{"brand":"visa","last4":"4242"},"completedAt":"2026-10-21T06:24:35+03:00"},"ticket":{"qrCode":"MQ1.MQ-SZHABB.1.6b-qUbtka1hBIR1kWGKlGA","admits":2},"confirmedAt":"2026-10-21T06:24:35+03:00"}
[{"label":"E7","state":"booked","heldUntil":null},{"label":"E8","state":"booked","heldUntil":null}]
```

In the database the claims are sold (`claimed_until` NULL) and the charge carries our key:

```
E7|
E8|
MQ-SZHABB|charge|card|succeeded|38000|MQ-SZHABB-c1|visa|4242||f|t
```

## 2. The PDF ticket and the calendar file

```bash
curl -s -D - -o ticket.pdf $B/bookings/MQ-SZHABB/ticket.pdf -H "Authorization: Bearer $MONA"
```

```
HTTP/1.1 200 OK
Cache-Control: private, no-store
Content-Type: application/pdf
Content-Disposition: attachment; filename="maqady-ticket-MQ-SZHABB.pdf"
Content-Length: 21784
%PDF-1.3
```

Its text runs (decoded from the uncompressed content streams) and its QR code, drawn as 427 dark
modules:

```
MAQADY E-TICKET | The Last Lighthouse | Rated 12+ | Maqady Zamalek | 26 July Street, Zamalek, Zamalek, Cairo | Hall 1 | Thu 22 Oct 2026, 13:30 | Cinema day 2026-10-22 | Seats E7 (Middle), E8 (Middle) | Admits 2 · Total EGP 380 | Booking MQ-SZHABB | Show this QR code at the entrance. It admits 2. | This booking can't be cancelled or refunded. If you can't make it, contact the cinema before the  | showtime.
rectangles 427
```

The first run printed `Hall Hall 1` (the hall's name already says "Hall"); fixed in `2760e37`,
which prints the name as it is on the ticket, the calendar file and the messages.

```bash
curl -s -D - $B/bookings/MQ-SZHABB/calendar.ics -H "Authorization: Bearer $MONA"
```

```
HTTP/1.1 200 OK
Cache-Control: private, no-store
Content-Type: text/calendar; charset=utf-8
Content-Disposition: attachment; filename="maqady-MQ-SZHABB.ics"
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Maqady//Tickets//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:MQ-SZHABB@maqady
DTSTAMP:20261021T032436Z
DTSTART:20261022T103000Z
DTEND:20261022T123800Z
SUMMARY:The Last Lighthouse · Maqady Zamalek
LOCATION:Maqady Zamalek\, 26 July Street\, Zamalek\, Zamalek\, Cairo
DESCRIPTION:Booking MQ-SZHABB. Hall 1. Seats E7\, E8. Admits 2. Show the ti
 cket QR code at the entrance.
END:VEVENT
END:VCALENDAR
```

13:30 Cairo is 10:30 UTC; the long `DESCRIPTION` is folded at 75 octets (CRLF and a space).

## 3. Nobody else gets anything

Another customer on the payment, PDF, calendar and booking routes, then no token at all:

```
"NOT_FOUND"
404
"NOT_FOUND"
"NOT_FOUND"
"UNAUTHENTICATED"
"UNAUTHENTICATED"
```

A held booking has no ticket file:

```
{"code":"TICKET_NOT_AVAILABLE","message":"This booking has no ticket.","details":{"status":"held"},"correlationId":"1cda81c8-…"}
```

## 4. Declines, wallets and validation

A declined card, then Meeza with a new key on the same hold:

```
{"payment":{"status":"declined","card":{"brand":"visa","last4":"0002"}},"booking":{"status":"held","paymentStatus":"declined","holdExpiresAt":"2026-10-21T06:30:00+03:00"}}
{"payment":{"status":"succeeded","card":{"brand":"meeza","last4":"0011"}},"booking":{"status":"confirmed","paymentStatus":"paid"}}
```

Google Pay, then a closed Apple Pay sheet (`cancelled`, not a decline):

```
{"payment":{"status":"succeeded","method":"wallet","card":null,"walletType":"google_pay"},"booking":"confirmed"}
{"payment":{"status":"cancelled","walletType":"apple_pay"},"booking":{"status":"held","paymentStatus":"unpaid"}}
```

A card token with `method: wallet`, a card number for a token, no `Idempotency-Key`, a lower-case
reference:

```
{"fields":[{"field":"token","messages":["token must be a test token of the chosen method"]}]}
{"fields":[{"field":"token","messages":["token must be one of the simulated test tokens"]}]}
"IDEMPOTENCY_KEY_REQUIRED"
"VALIDATION_FAILED"
```

A released hold cannot be paid:

```
DELETE 204
{"code":"HOLD_EXPIRED","message":"Your seat hold has expired.","details":null,"correlationId":"4f1f2737-…"}
```

## 5. A slow payment, settled on the next read

```bash
pay $SARA MQ-FT62JB '{"method":"card","token":"sim_card_slow"}'
```

```
{"payment":{"status":"processing","card":{"brand":"visa","last4":"3184"},"settlesAt":"2026-10-21T06:25:10+03:00","completedAt":null},"booking":{"status":"held","paymentStatus":"processing","holdExpiresAt":"2026-10-21T06:30:00+03:00"}}
```

While it processes, its customer can neither release it, replace it with a new hold, nor pay it
again; a read shows it still processing:

```
"PAYMENT_IN_PROGRESS"
"PAYMENT_IN_PROGRESS"
"PAYMENT_IN_PROGRESS"
{"status":"held","paymentStatus":"processing","payment":"processing"}
```

After `sleep 11`, the next `GET /bookings/MQ-FT62JB` settles it first (no timer ran):

```
{"status":"confirmed","paymentStatus":"paid","confirmedAt":"2026-10-21T06:25:12+03:00","payment":{"status":"succeeded","completedAt":"2026-10-21T06:25:12+03:00","settlesAt":null},"ticket":1}
```

Its history, the confirmation and the charge's result recorded by the system:

```
booking.held|customer|booking|{"holder": "customer", "channel": "online", "seatCount": 1, "showtimeId": 2}
payment.processing|customer|payment|{"method": "card", "purpose": "sale"}
booking.confirmed|system|booking|{"channel": "online", "seatCount": 1, "showtimeId": 2}
payment.succeeded|system|payment|{"method": "card", "purpose": "sale"}
```

`sim_card_slow_declined`, settled 11 s later by a write-free read of the showtime's seats
(`GET /showtimes/2/seats`), then paid with Mastercard while the hold lasts:

```
"processing"
{"status":"held","paymentStatus":"declined","payment":{"status":"declined","card":{"brand":"visa","last4":"0341"}}}
{"status":"confirmed","paymentStatus":"paid"}
```

## 6. The tickets email and SMS, and the Message log

Mona's confirmation queued both, sent once the transaction committed (simulated drivers):

```
6|email|booking.tickets|sent|Your Maqady tickets · MQ-SZHABB
7|sms|booking.tickets_sms|sent|
```

`GET /admin/messages/6` (`bodyText`) and `/7`, as the Message log shows them:

```
Hello Mona Adel,

Your booking MQ-SZHABB is confirmed. Here are your tickets.

The Last Lighthouse (12+)
Thu 22 Oct 2026, 13:30
Maqady Zamalek, 26 July Street, Zamalek, Zamalek, Cairo
Hall 1 · Seats E7, E8
Admits 2 · Total paid EGP 380

Your ticket QR code: [one-time link hidden]

Show the ticket QR code at the entrance. It admits 2.

Your booking, the PDF ticket and "Add to calendar": http://localhost:5173/my-bookings/MQ-SZHABB

This booking can't be cancelled or refunded. If you can't make it, contact the cinema before the showtime.
{"channel":"sms","template":"booking.tickets_sms","status":"sent","recipient":"+201012345678","bodyText":"Maqady MQ-SZHABB: The Last Lighthouse, Thu 22 Oct 2026, 13:30, Maqady Zamalek, Hall 1, seats E7, E8. Ticket: [one-time link hidden]"}
```

The QR signature appears nowhere: `0` in the Message log answer, `0` rows of `messages` with it in
`subject`, `body_text` or `body_html`. (The delivered copy, with the real
`/ticket?token=<payload>` link, is asserted by `booking-tickets.controller.test.ts` through the
recording email sender.)

## 7. The payment limit

Ten declined attempts on one booking, then the eleventh within 5 minutes:

```
     10 declined
HTTP/1.1 429 Too Many Requests
Retry-After-payment: 300
Retry-After: 300
{"error":{"code":"RATE_LIMITED"
```

Every attempt is its own charge with its own provider key (`MQ-EYUBZ3-c1` … `-c10`).

## 8. Log hygiene

`grep -c` over the app's log after all of the above: no customer email, phone, QR payload or
signature, test token or bearer token, and the request line names the route template and the
principal only:

```
@qa.maqady.local: 0
+20101234: 0
6b-qUbtka1hBIR1kWGKlGA: 0
MQ1.: 0
sim_card: 0
Bearer: 0
{"method":"POST","route":"/api/v1/bookings/:ref/payments","statusCode":429,"principalKind":"customer","principalId":7}
```

## Not shown here

- Hold expiry to the millisecond, the extension of a hold about to end, read-equals-write,
  concurrent payments, payments racing a release or a rival hold, the automatic refund of a
  success that lost its seats or showtime, the rollback probe and U7's move notifications: they
  need a moved clock, SQL surgery or parallel requests, and are proven by the integration suites
  in `test/integration/modules/bookings/`.
