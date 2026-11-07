---
title: U13 — Box office manual QA
owner: Mohamed Tarek
status: Passed
last_verified: 2026-10-29
tags: [qa, box-office, counter-sales, scanning, tickets, curl]
---

# U13 — Box office: manual QA

Run on 2026-10-29 from 21:09 to 21:11 Cairo time (EEST), on the real clock, against
`maqady_u13_dev` seeded with `npm run seed` (demo dataset), the app started from the build with
`node dist/main.js` on port 3121 (`EMAIL_DRIVER=simulated`, `STORAGE_DRIVER=local`). The seeded
showtime 19 (Maqady Zamalek, Hall 1) starts at 21:45, so its scan window (from 20:45) was open
while its seats could still be sold.

Setup. The seed admin signs in through `POST /admin/auth/sessions`. Two box office members
(`counter-one`, staff id 2, and `counter-two`, id 3) were created by a QA-only script that calls
the real `StaffService.createActiveMember()` (the invite email's link is not readable with the
simulated driver); they signed in through the real route. A customer registered through
`POST /auth/registrations` (id 1). `$API` is `http://localhost:3121/api/v1`; correlation ids are
trimmed to `…`.

## Counter holds

```bash
curl -s -X POST $API/admin/counter-holds -H "Authorization: Bearer $C1" -H "Idempotency-Key: $K1" \
  -H 'Content-Type: application/json' -d '{"showtimeId":19,"seats":["C6","C5"]}'
```

```json
{"reference":"MQ-E4XSMA","status":"held","channel":"counter","owner":"staff","seats":["C5","C6"],
 "total":{"amount":30000,"currency":"EGP"},"holdExpiresAt":"2026-10-29T21:14:23+03:00",
 "serverTime":"2026-10-29T21:09:23+03:00","paymentStatus":"unpaid","payment":null,"ticket":null}
```

- The same request and key again: `HTTP/1.1 201 Created`, `Idempotent-Replayed: true`.
- The customer then tries to hold `C5` and `C7` online: `409 {"code":"SEAT_TAKEN","details":{"seats":["C5"]}}`.
- One live counter hold per member: `counter-one` held `F1` (`MQ-FNPZRH`), then `F2`
  (`MQ-4YDB92`); the database shows `MQ-FNPZRH|f` (ended) and `MQ-4YDB92|t` (live), and the audit
  rows below record `booking.released { reason: replaced }`.
- `DELETE /admin/counter-holds/MQ-4YDB92` by `counter-two`:
  `403 {"code":"FORBIDDEN","details":{"reason":"not_your_counter_hold"}}`; by `counter-one`:
  `204`, and again `204`; on the paid `MQ-E4XSMA`: `409 ALREADY_PAID`. The seat map then lists
  only the sold seats (`C5`, `C6`, `D4`, `E1`–`E3`, all `heldUntil: null`): `F1` and `F2` are free.

## Counter payments

```bash
curl -s -X POST $API/admin/bookings/MQ-E4XSMA/counter-payments -H "Authorization: Bearer $C2" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"method":"cash","customer":{"kind":"walk_in"}}'
# 403 {"code":"FORBIDDEN","details":{"reason":"not_your_counter_hold"}}

curl -s ... -d '{"method":"cash","receiptReference":"TRX-1","customer":{"kind":"walk_in","fullName":"X"}}'
# 400 VALIDATION_FAILED: receiptReference "is sent only with method card_terminal",
#     customer.fullName "is sent only with kind contact"
curl -s ... -d '{"method":"card_terminal","customer":{"kind":"walk_in"}}'
# 400 VALIDATION_FAILED on receiptReference

curl -s -X POST $API/admin/bookings/MQ-E4XSMA/counter-payments -H "Authorization: Bearer $C1" \
  -H "Idempotency-Key: $K5" -H 'Content-Type: application/json' \
  -d '{"method":"card_terminal","receiptReference":" TRX-0042817 ","customer":{"kind":"walk_in"}}'
```

```json
HTTP 201
{"payment":{"status":"succeeded","method":"card_terminal","amount":{"amount":30000,"currency":"EGP"},
  "receiptReference":"TRX-0042817","card":null,"walletType":null,
  "createdAt":"2026-10-29T21:09:47+03:00","completedAt":"2026-10-29T21:09:47+03:00","settlesAt":null},
 "booking":{"reference":"MQ-E4XSMA","status":"confirmed","channel":"counter","owner":"staff",
  "paymentStatus":"paid","ticket":{"admits":2,"qrCode":"MQ1.MQ-E4XSMA.1.cCdMxF…"}}}
```

- The same key again: `201`, `Idempotent-Replayed: true`. A new key: `409 {"error":{"code":"ALREADY_PAID","message":"This booking is already paid.","details":null,"correlationId":"…"}}`.
- **Existing customer** (`D4`, `MQ-B74ZHA`, `{"kind":"existing","customerId":1}`, cash):
  `{"payment":{"method":"cash","receiptReference":null,"status":"succeeded"},"booking":{"owner":"customer","status":"confirmed"}}`.
  The customer's own `GET /bookings/MQ-B74ZHA` answers `{"status":"confirmed","channel":"counter","owner":"customer","payment":{"method":"cash"}}`, and their `GET /bookings/MQ-B74ZHA/ticket.pdf` is `200`.
- **Unknown account** (`customerId: 999999`) on `counter-two`'s hold `MQ-FUFWGH`:
  `400 VALIDATION_FAILED` on `customer.customerId`, "No active customer account has this id.".
- **Typed contact** (`"  Karim Mostafa "`, `Karim.QA@Example.com`, `01012345678`) on `MQ-FUFWGH`:
  `{"status":"confirmed","owner":"staff","admits":3}`.

What the database holds afterwards:

```text
 reference | customer_id | contact_name  |    contact_email     | contact_phone
 MQ-E4XSMA |             |               |                      |
 MQ-B74ZHA |           1 | Layla Hassan  | layla.qa@example.com |
 MQ-FUFWGH |             | Karim Mostafa | karim.qa@example.com | +201012345678

      template       | channel |      recipient       | status | reference
 booking.tickets     | email   | layla.qa@example.com | sent   | MQ-B74ZHA
 booking.tickets     | email   | karim.qa@example.com | sent   | MQ-FUFWGH
 booking.tickets_sms | sms     | +201012345678        | sent   | MQ-FUFWGH

 reference |    method     |  status   | amount | provider_reference | provider_idempotency_key | collected_by_staff_id
 MQ-E4XSMA | card_terminal | succeeded |  30000 | TRX-0042817        |                          |                     2
 MQ-B74ZHA | cash          | succeeded |  19000 |                    |                          |                     2
 MQ-FUFWGH | cash          | succeeded |  57000 |                    |                          |                     3
```

The walk-in sale sent nothing; the others' tickets went to the email and phone given.

## Staff ticket download

```bash
curl -s -D - -o ticket.pdf $API/admin/bookings/MQ-E4XSMA/ticket.pdf -H "Authorization: Bearer $C2"
```

```text
HTTP/1.1 200 OK
Cache-Control: private, no-store
Content-Type: application/pdf
Content-Disposition: attachment; filename="maqady-ticket-MQ-E4XSMA.pdf"
Content-Length: 21408
%PDF-1.3
```

- The admin downloads the customer's counter booking `MQ-B74ZHA`: `200`.
- The released hold `MQ-4YDB92`: `409 {"code":"TICKET_NOT_AVAILABLE","details":{"status":"abandoned"}}`;
  `MQ-222222`: `404 NOT_FOUND`.

## Scanning

```bash
curl -s -X POST $API/admin/scans -H "Authorization: Bearer $C2" -H 'Content-Type: application/json' \
  -d "{\"theaterId\":1,\"code\":\"$QR\"}"
```

```json
HTTP 200
{"result":"VALID","reason":null,"admits":2,"checkedInAt":"2026-10-29T21:10:25+03:00",
 "scannedAt":"2026-10-29T21:10:25+03:00","booking":{"reference":"MQ-E4XSMA","status":"confirmed",
 "seats":["C5","C6"],"seatCount":2,"contactName":null,
 "showtime":{"id":19,"theater":"Maqady Zamalek","startsAt":"2026-10-29T21:45:00+03:00"}}}
```

- Two seconds later, by `counter-one`: `{"result":"ALREADY_USED","reason":null,"admits":2,"checkedInAt":"2026-10-29T21:10:25+03:00","scannedAt":"2026-10-29T21:10:27+03:00"}`.
- Forged and other codes, each `200 {"result":"NOT_FOUND","booking":null}`: the signature's last
  character changed, the version changed to 2, the reference changed to `MQ-222222`, the bare
  reference `MQ-E4XSMA` sent as a code, and `https://example.com/menu`.
- The same ticket at Maqady New Cairo's entrance (`theaterId: 4`): `{"result":"WRONG_SHOWTIME","reason":"other_theater","admits":null,"booking":{"reference":"MQ-E4XSMA","theater":"Maqady Zamalek"}}`.
- Tomorrow's 13:30 ticket (`MQ-RNBRRD`, sold for the test) scanned tonight: `{"result":"WRONG_SHOWTIME","reason":"not_open_yet",…"startsAt":"2026-10-30T13:30:00+02:00"}`.
- **Typed reference** `" mq-fufwgh "`: `{"result":"CONFIRM_REQUIRED","admits":3,"checkedInAt":null,"booking":{"reference":"MQ-FUFWGH","seats":["E1","E2","E3"],"contactName":"Karim Mostafa"}}`; the row's `checked_in_at` is still empty. With `"confirm":true`: `{"result":"VALID","admits":3,"checkedInAt":"2026-10-29T21:10:27+03:00"}`. `MQ-222222` with `confirm: true`: `{"result":"NOT_FOUND","booking":null}`.
- Errors: `theaterId: 999`: `404 NOT_FOUND`; `code` and `reference` together: `400` on `code`, "send code or reference, not both"; `confirm` with a code: `400` on `confirm`.

## Access

A customer token on `POST /admin/counter-holds`, `POST /admin/bookings/{ref}/counter-payments`,
`DELETE /admin/counter-holds/{ref}`, `GET /admin/bookings/{ref}/ticket.pdf` and `POST /admin/scans`:
`401 UNAUTHENTICATED` on each; no token: `401`.

## Audit rows

```text
          action           | actor | staff | reference | metadata
 booking.held              | staff |     2 | MQ-E4XSMA | {"holder":"staff","channel":"counter","seatCount":2,"showtimeId":19}
 booking.confirmed         | staff |     2 | MQ-E4XSMA | {"channel":"counter","seatCount":2,"showtimeId":19}
 payment.succeeded         | staff |     2 | MQ-E4XSMA | {"method":"card_terminal","channel":"counter","purpose":"sale","customerKind":"walk_in"}
 payment.succeeded         | staff |     2 | MQ-B74ZHA | {"method":"cash",…,"customerKind":"existing"}
 payment.succeeded         | staff |     3 | MQ-FUFWGH | {"method":"cash",…,"customerKind":"contact"}
 booking.released          | staff |     2 | MQ-FNPZRH | {"holder":"staff","reason":"replaced","showtimeId":19}
 booking.released          | staff |     2 | MQ-4YDB92 | {"holder":"staff","reason":"released","showtimeId":19}
 booking.ticket_downloaded | staff |     3 | MQ-E4XSMA | {"format":"pdf"}
 booking.ticket_downloaded | staff |     1 | MQ-B74ZHA | {"format":"pdf"}
 booking.checked_in        | staff |     3 | MQ-E4XSMA | {"via":"qr","theaterId":1}
 booking.checked_in        | staff |     2 | MQ-FUFWGH | {"via":"reference","theaterId":1}
```

(20 rows in all; the `booking.held` / `booking.confirmed` rows of every sale are elided.) No row
carries a name, email, phone or receipt reference.

## Log hygiene

The app's 236 log lines contain none of `layla.qa`, `Karim`, `01012345678`, `+201012345678`,
`TRX-0042817`, `MQ1.` (a QR payload), `Passw0rd` or `Bearer`. A scan's request line:

```json
{"level":"info","correlationId":"ffab4ced-…","method":"POST","route":"/api/v1/admin/scans",
 "statusCode":200,"responseTime":19,"principalKind":"staff","principalId":2,"msg":"request completed"}
```

Not exercised by hand: a scan after the showtime ends, a cancelled showtime, refunded and replaced
(edited) tickets, and the concurrent races. The integration suites cover each against real
Postgres with a controlled clock (`scans.controller.test.ts`, `box-office-concurrency.test.ts`).
