---
title: U14 — Admin bookings manual QA
owner: Mohamed Tarek
status: Passed
last_verified: 2026-10-29
tags: [qa, admin, bookings, search, summary, notes, refunds, payouts, edits, showtime-cancellation, curl]
---

# U14 — Admin bookings: manual QA

Run on 2026-10-29 at 23:49 Cairo time (EEST, `+03:00`), on the real clock, against
`maqady_u14_dev` seeded with `npm run seed` (demo dataset), the app started from the build with
`node dist/main.js` on port 3122 (`EMAIL_DRIVER=simulated`, `STORAGE_DRIVER=local`). The run is
one script (every request below, in order); its bookings were cleared from the development
database before the final run, so the figures are only its own.

Setup. The seed admin (`Seed Admin`, staff id 1) signs in through `POST /admin/auth/sessions`. A box
office member (`Hany Adel`, id 2) was created by a QA-only script that calls the real
`StaffService.createActiveMember()` (the invite link is not readable with the simulated driver),
then signed in through the real route. Two customers registered through `POST /auth/registrations`
(`Nadia Farouk`, who set her phone `01012345678` with `PATCH /me`, and `Karim Mostafa`). Seeded
showtime 63 (The Last Lighthouse, Maqady Heliopolis, Hall 3, rows A–C front 150, D–H middle 190,
J–M back 230 EGP) and 65 (the same movie and hall, three days later) are used; showtime 50 is
another movie. `$API` is `http://localhost:3122/api/v1`.

Bookings made through the real routes for the run, all on showtime 63:

| Booking | How | Answer |
|---|---|---|
| `MQ-4H5YHZ` | Nadia holds E5, E6 and pays `sim_card_visa` | `{"status":"confirmed","payment":"succeeded"}` |
| `MQ-QWVZDD` | Karim holds F1 and pays `sim_card_declined` | `{"status":"held","payment":"declined"}` |
| `MQ-V9AJPQ` | the box office sells J1 for cash to typed contact Omar Khaled, `omar.k@example.com` | `{"status":"confirmed","method":"cash"}` |
| `MQ-Y47VFU` | the box office sells A3 for cash to a walk-in | `{"status":"confirmed","method":"cash"}` |

## The list, its search and filters

```bash
curl -s "$API/admin/bookings?limit=5" -H "Authorization: Bearer $BOX"
```

```json
{"total":4,"nextCursor":null,"items":[
 {"reference":"MQ-Y47VFU","status":"confirmed","paymentStatus":"paid","channel":"counter","owner":"staff",
  "contact":{"name":null,"email":null,"phone":null},"seatLabels":["A3"],"total":15000,
  "payment":{"method":"cash","status":"succeeded"},"createdAt":"2026-10-29T23:49:36+03:00"},
 {"reference":"MQ-V9AJPQ","channel":"counter","contact":{"name":"Omar Khaled","email":"omar.k@example.com","phone":null},"seatLabels":["J1"],"total":23000,…},
 {"reference":"MQ-QWVZDD","status":"held","paymentStatus":"declined","channel":"online","owner":"customer","payment":{"method":"card","status":"declined"},…},
 {"reference":"MQ-4H5YHZ","status":"confirmed","paymentStatus":"paid","contact":{"name":"Nadia Farouk","email":"nadia.…@example.com","phone":"+201012345678"},
  "seatLabels":["E5","E6"],"total":38000,"payment":{"method":"card","status":"succeeded"},…}]}
```

Newest first, box office token accepted. Each search or filter, as admin (references of the run):

| Query | Answer |
|---|---|
| `q=nadia` | `{"total":1,"refs":["MQ-4H5YHZ"]}` |
| `q=mq-4h5yhz` (a reference in lower case) | `{"total":1,"refs":["MQ-4H5YHZ"]}` |
| `q=01012345678` (a local mobile; stored `+201012345678`) | `{"total":1,"refs":["MQ-4H5YHZ"]}` |
| `q=omar.k%40` | `{"total":1,"refs":["MQ-V9AJPQ"]}` |
| `status=confirmed` | `{"total":3,"refs":["MQ-Y47VFU","MQ-V9AJPQ","MQ-4H5YHZ"]}` |
| `status=held` | `{"total":1,"refs":["MQ-QWVZDD"]}` |
| `channel=counter` | `{"total":2,"refs":["MQ-Y47VFU","MQ-V9AJPQ"]}` |
| `method=cash` | `{"total":2,"refs":["MQ-Y47VFU","MQ-V9AJPQ"]}` |
| `method=card` (a declined attempt counts) | `{"total":2,"refs":["MQ-QWVZDD","MQ-4H5YHZ"]}` |
| `theaterId=3`, `movieId=1` | all four |
| `dateFrom=2026-10-29&dateTo=2026-10-29` | all four |
| `dateFrom=2026-12-01` | `{"total":0,"refs":[]}` |
| `q=a&status=cancelled` | `400 {"code":"VALIDATION_FAILED","fields":["q","status"]}` |

Paging: `limit=2` answers `["MQ-Y47VFU","MQ-V9AJPQ"]` with `total: 4` and a `nextCursor`; the
cursor gives `["MQ-QWVZDD","MQ-4H5YHZ"]`.

## The summary cards

```bash
curl -s $API/admin/bookings/summary -H "Authorization: Bearer $BOX"
```

```json
{"cinemaDate":"2026-10-29","serverTime":"2026-10-29T23:49:37+03:00","todayBookings":3,
 "collectedToday":{"amount":76000,"currency":"EGP"},"failedPaymentsToday":1,
 "refundedLast7Days":{"bookingCount":0,"amount":{"amount":0,"currency":"EGP"}}}
```

Three paid bookings, 380 + 230 + 150 = 760 EGP collected, one decline. After the refunds and the
payout below: `collectedToday` 38000 (760 + the 230 edit difference, minus the 80 edit refund,
the 300 card refund and the 230 cash payout; the second cash refund is still pending) and
`refundedLast7Days` `{"bookingCount":2,"amount":{"amount":76000,…}}` (300 + 460).

## The detail

```bash
curl -s $API/admin/bookings/MQ-4H5YHZ -H "Authorization: Bearer $BOX"
```

```json
{"reference":"MQ-4H5YHZ","status":"confirmed",
 "contact":{"name":"Nadia Farouk","email":"nadia.…@example.com","phone":"+201012345678"},
 "customer":{"id":3,"fullName":"Nadia Farouk","email":"nadia.…@example.com","phone":"+201012345678","status":"active","anonymised":false},
 "soldBy":null,"refundable":{"amount":38000,"currency":"EGP"},
 "actions":{"refund":true,"edit":true,"resendTickets":true},
 "payments":[{"id":12,"kind":"charge","method":"card","status":"succeeded","amount":38000,"refundable":38000}],
 "activity":[{"action":"booking.held","actorKind":"customer","staff":null},
             {"action":"booking.confirmed","actorKind":"customer","staff":null},
             {"action":"payment.succeeded","actorKind":"customer","staff":null}]}
```

The counter sale names its seller and collector: `{"reference":"MQ-V9AJPQ","customer":null,
"soldBy":{"id":2,"fullName":"Hany Adel"},"payments":[{"method":"cash","collectedBy":"Hany Adel"}]}`.
`MQ-ZZZZZZ`: `404 NOT_FOUND`.

## Internal notes

```bash
curl -s -X POST $API/admin/bookings/MQ-4H5YHZ/notes -H "Authorization: Bearer $BOX" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"body":"  Will arrive 10 minutes late. "}'
```

```json
{"id":3,"body":"Will arrive 10 minutes late.","author":{"id":2,"fullName":"Hany Adel"},"createdAt":"2026-10-29T23:49:37+03:00"}
```

- The admin adds "Called back: keep the seats."; `GET /admin/bookings/MQ-4H5YHZ/notes` answers
  `{"total":2,"items":[{"body":"Called back: keep the seats.","author":"Seed Admin"},{"body":"Will arrive 10 minutes late.","author":"Hany Adel"}]}` (newest first).
- A blank note: `400 VALIDATION_FAILED`; no key: `400 IDEMPOTENCY_KEY_REQUIRED`.
- Never shown to the customer: `GET /bookings/MQ-4H5YHZ` and its `/history` with Nadia's token
  contain "minutes late" 0 times; her token on the notes route is `401 UNAUTHENTICATED`.

## Staff resend

```bash
curl -s -X POST $API/admin/bookings/MQ-4H5YHZ/ticket-deliveries -H "Authorization: Bearer $BOX" \
  -H "Idempotency-Key: $(uuidgen)"
```

```json
{"channels":["email","sms"],"queuedAt":"2026-10-29T23:49:37+03:00"}
```

The walk-in `MQ-Y47VFU`: `409 NO_CONTACT_DETAILS`; the declined hold `MQ-QWVZDD`:
`409 {"code":"TICKET_NOT_AVAILABLE","details":{"status":"held"}}`.

## Admin only

With the box office token, each answers `403 FORBIDDEN`: `POST /admin/bookings/MQ-4H5YHZ/refunds`,
`/edits`, `/edit-previews`, `POST /admin/refunds/1/payouts`,
`GET /admin/showtimes/63/cancellation-preview`. A customer token on `GET /admin/bookings`:
`401 UNAUTHENTICATED`.

## Edits

Preview, then the same body applied: E5, E6 (middle, 2 × 190) to B5, B6 (front, 2 × 150).

```bash
curl -s -X POST $API/admin/bookings/MQ-4H5YHZ/edit-previews -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"seats":["B5","B6"],"reason":"customer_request","notify":true}'
```

```json
{"current":38000,"proposed":30000,
 "seats":[{"label":"B5","price":15000,"kept":false},{"label":"B6","price":15000,"kept":false}],
 "difference":{"direction":"refund","amount":{"amount":8000,"currency":"EGP"}},
 "refunds":[{"method":"card","amount":8000}],"changedFields":["seats"],"unavailableSeats":[]}
```

`POST /admin/bookings/MQ-4H5YHZ/edits` with that body and a key:

```json
{"total":30000,"seats":["B5","B6"],"qr":"2",
 "difference":{"direction":"refund","amount":{"amount":8000,"currency":"EGP"}},"changedFields":["seats"],
 "payments":[{"kind":"refund","purpose":"edit_difference","method":"card","status":"succeeded","amount":8000}]}
```

The preview's total, difference and refund split are what the edit applied, and the QR version is
now 2. The detail then shows the partial refund: `{"refundable":30000,"payments":[{"kind":"charge",
"purpose":"sale","amount":38000,"refundable":30000},{"kind":"refund","purpose":"edit_difference",
"status":"succeeded","amount":8000,"refundable":null}]}`.

- A higher total, J1 to J1 + J2 (+230): without `payment`,
  `400 {"code":"VALIDATION_FAILED","fields":["payment"]}`; with `{"payment":{"method":"cash"}}`,
  `{"total":46000,"difference":{"direction":"collect","amount":{"amount":23000,…}},"payments":[{"kind":"charge","purpose":"edit_difference","method":"cash","status":"succeeded","amount":23000}]}`.
- A seat someone holds: a guest holds C9; the walk-in's preview to C9 shows
  `{"unavailableSeats":["C9"]}` and the edit answers `409 {"code":"SEAT_TAKEN","details":{"seats":["C9"]}}`.
- The walk-in moved to showtime 65: `{"showtime":65,"seats":["A3"],"difference":{"direction":"none",…},"changedFields":["showtime"]}`.
- Showtime 50 (another movie): `400 VALIDATION_FAILED` on `showtimeId`, "Pick a showtime of the same movie.".
- The declined hold: `409 {"code":"BOOKING_NOT_EDITABLE","details":{"reason":"not_confirmed","status":"held"}}`.

## Cancel and refund, and payouts

```bash
curl -s -X POST $API/admin/bookings/MQ-4H5YHZ/refunds -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $K"
```

```json
{"refunds":[{"method":"card","status":"succeeded","amount":30000}],
 "booking":{"status":"refunded","refund":{"amount":{"amount":30000,"currency":"EGP"},"refundedAt":"2026-10-29T23:49:37+03:00"}}}
```

What was left of the card charge after the edit refund (380 − 80). The same key again:
`Idempotent-Replayed: true`; a new key: `409 {"code":"BOOKING_NOT_REFUNDABLE","details":{"status":"refunded"}}`.

The counter sale `MQ-V9AJPQ` (cash sale 230, cash edit difference 230):

```json
{"refunds":[{"id":19,"method":"cash","status":"pending","amount":23000},{"id":20,"method":"cash","status":"pending","amount":23000}]}
```

```bash
curl -s -X POST $API/admin/refunds/19/payouts -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $(uuidgen)"
```

```json
{"id":19,"status":"succeeded","completedAt":"2026-10-29T23:49:38+03:00","paidOutAt":"2026-10-29T23:49:38+03:00","paidOutBy":"Seed Admin"}
```

Again: `409 {"code":"REFUND_NOT_PENDING","details":{"status":"succeeded"}}`; refund 999999:
`404 NOT_FOUND`.

## Showtime cancellation

On showtime 65: the moved walk-in (A3, cash), Nadia's new wallet booking `MQ-K2CRXP` (D1, D2,
`sim_wallet_google_pay`) and a guest's live hold `MQ-H57XG5` (K4).

```bash
curl -s $API/admin/showtimes/65/cancellation-preview -H "Authorization: Bearer $ADMIN"
```

```json
{"showtimeId":65,"cancellable":true,"bookingCount":2,"seatCount":3,
 "refundedOnline":{"amount":38000,"currency":"EGP"},"owedAtCounter":{"amount":15000,"currency":"EGP"},
 "liveHoldCount":1,"emailCount":1,"smsCount":1}
```

```bash
curl -s -X PATCH $API/admin/showtimes/65 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' -d '{"status":"cancelled","cancelReason":"technical_issue"}'
```

```json
{"id":65,"status":"cancelled","cancelReason":"technical_issue"}
```

Then, from the admin detail of each booking:

```json
{"reference":"MQ-K2CRXP","status":"refunded","payments":[{"kind":"charge","method":"wallet","status":"succeeded","amount":38000},{"kind":"refund","method":"wallet","status":"succeeded","amount":38000}]}
{"reference":"MQ-Y47VFU","status":"refunded","payments":[{"kind":"charge","method":"cash","status":"succeeded","amount":15000},{"kind":"refund","method":"cash","status":"pending","amount":15000}]}
{"reference":"MQ-H57XG5","status":"abandoned","payments":[]}
```

Messages written by the cancellation (`messages` after it): `showtime.cancelled|email|sent|13`
and `showtime.cancelled_sms|sms|sent|13`: one email and one SMS for the one booking with an
email and a phone; the walk-in has neither. The preview now answers
`{"cancellable":false,"bookingCount":0,"liveHoldCount":0}`, and the audit row reads
`showtime.cancelled|{"reason":"technical_issue","notifiedCount":1,"releasedHoldCount":1,"refundedBookingCount":2}`.

## Audit rows

Field names and non-personal facts only, actor `staff` throughout:

```
booking.note_added|staff|{}|{"noteId": 3}
booking.note_added|staff|{}|{"noteId": 4}
booking.tickets_resent|staff|{}|{"by": "staff", "channels": "email,sms"}
booking.edited|staff|{seats}|{"notify": true, "reason": "customer_request", "seatCount": 2, "difference": -8000, "toShowtimeId": 63, "fromShowtimeId": 63}
booking.edited|staff|{seats}|{"notify": false, "reason": "customer_request", "seatCount": 2, "difference": 23000, "toShowtimeId": 63, "fromShowtimeId": 63}
booking.edited|staff|{showtime}|{"notify": false, "reason": "showtime_changed", "seatCount": 1, "difference": 0, "toShowtimeId": 65, "fromShowtimeId": 63}
booking.refunded|staff|{}|{"amount": 30000, "reason": "admin_cancel", "seatCount": 2, "showtimeId": 63}
booking.refunded|staff|{}|{"amount": 46000, "reason": "admin_cancel", "seatCount": 2, "showtimeId": 63}
payment.paid_out|staff|{}|{"amount": 23000, "method": "cash", "purpose": "cancellation"}
booking.refunded|staff|{}|{"amount": 15000, "reason": "showtime_cancelled", "seatCount": 1, "showtimeId": 65}
booking.refunded|staff|{}|{"amount": 38000, "reason": "showtime_cancelled", "seatCount": 2, "showtimeId": 65}
```

## Log hygiene

The app log of the run (406 lines, every request of both passes) contains none of `Nadia`,
`Karim`, `Omar`, `example.com`, `+20101`, `01012345678`, `minutes late` or `Called back` (0 lines
each), and no error line. Request lines name the route templates
(`/api/v1/admin/bookings/:ref/edits`, …), never a reference.

## Result

Every route of the unit answered as the spec says, with both roles and a customer token. Passed.
