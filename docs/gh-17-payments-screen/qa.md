---
title: U16 — Payments screen manual QA
owner: Mohamed Tarek
status: Passed
last_verified: 2026-10-29
tags: [qa, admin, payments, transactions, kpis, reconciliation, cinema-day, curl]
---

# U16 — Payments screen: manual QA

Run on 2026-10-30 at 00:22 Cairo time, on the real clock, minutes after Egypt's summer time ended
(Thursday 29 October 24:00 EEST became 23:00 EET, so Cairo is `+02:00` again; cinema day
`2026-10-29` until 06:00). Against `maqady_u16_dev` seeded with `npm run seed` (demo dataset), the
app started from the build with `node dist/main.js` on port 3124 (`EMAIL_DRIVER=simulated`,
`STORAGE_DRIVER=local`). `$API` is `http://localhost:3124/api/v1`.

Setup. The seed admin (`Seed Admin`, staff id 1) signs in through `POST /admin/auth/sessions`. A box
office member (`Hany Adel`, id 2) was created by a QA-only script that calls the real
`StaffService.createActiveMember()` (the invite link is not readable with the simulated driver),
then signed in through the real route. Customers registered through `POST /auth/registrations`.
Seeded showtimes 62 (Maqady Heliopolis, Hall 1, 30 October 19:00) and 37 (Maqady Downtown, Hall 1,
the same evening) are used; rows A–C are front (150 EGP), D–H middle (190), J–M back (230).

Bookings and money made through the real routes for the run:

| Booking | Theater | How | Answer |
|---|---|---|---|
| `MQ-VVB5NK` | Heliopolis | Nadia holds E5, E6 and pays `sim_card_visa` | `{"status":"succeeded","booking":"confirmed"}` |
| `MQ-2DSFV4` | Downtown | Karim holds F1 and pays `sim_wallet_google_pay` | `{"status":"succeeded","booking":"confirmed"}` |
| `MQ-MVBWAR` | Heliopolis | Salma holds F2 and pays `sim_card_declined` | `{"status":"declined","booking":"held"}` |
| `MQ-PYUW57` | Downtown | Youssef holds F3 and pays `sim_wallet_cancelled` | `{"status":"cancelled","booking":"held"}` |
| `MQ-MR78K5` | Heliopolis | Mariam holds F4 and pays `sim_card_slow` | `{"status":"processing","booking":"held"}` |
| `MQ-UDWDSK` | Downtown | the box office sells J1 for cash to a walk-in | `{"status":"confirmed","method":"cash"}` |
| `MQ-YKMGSN` | Heliopolis | the box office sells A3 by card terminal, receipt `TRX-77` | `{"status":"confirmed","method":"card_terminal"}` |

## Transactions with every status

Straight after the payments, while the slow card is still within its 10 seconds:

```bash
curl -s "$API/admin/payments?limit=20" -H "Authorization: Bearer $ADMIN"
```

```json
{ "total": 7, "nextCursor": null, "items": [
  {"id":7,"ref":"MQ-YKMGSN","kind":"charge","method":"card_terminal","channel":"counter","status":"succeeded","failureReason":null,"ledgerStatus":"succeeded","amount":15000,"theater":"Maqady Heliopolis","occurredAt":"2026-10-30T00:22:07+02:00","cinemaDate":"2026-10-29"},
  {"id":6,"ref":"MQ-UDWDSK","kind":"charge","method":"cash","channel":"counter","status":"succeeded","ledgerStatus":"succeeded","amount":23000,"theater":"Maqady Downtown", "…": "…"},
  {"id":5,"ref":"MQ-MR78K5","kind":"charge","method":"card","channel":"online","status":"pending","failureReason":null,"ledgerStatus":"processing","amount":19000, "…": "…"},
  {"id":4,"ref":"MQ-PYUW57","kind":"charge","method":"wallet","status":"failed","failureReason":"cancelled","ledgerStatus":"cancelled","amount":19000, "…": "…"},
  {"id":3,"ref":"MQ-MVBWAR","kind":"charge","method":"card","status":"failed","failureReason":"declined","ledgerStatus":"declined","amount":19000, "…": "…"},
  {"id":2,"ref":"MQ-2DSFV4","kind":"charge","method":"wallet","status":"succeeded", "…": "…"},
  {"id":1,"ref":"MQ-VVB5NK","kind":"charge","method":"card","status":"succeeded","amount":38000,"occurredAt":"2026-10-30T00:22:05+02:00","cinemaDate":"2026-10-29"}
]}
```

(Trimmed with `jq` to the fields shown; `occurredAt` is after midnight, `cinemaDate` the 29th.)

Ten seconds later the next read settles the slow card first: nothing is pending any more, and it
moved up the list to the moment it completed.

```bash
curl -s "$API/admin/payments?status=pending" -H "Authorization: Bearer $ADMIN"     # {"total":0,"refs":[]}
curl -s "$API/admin/payments?method=card&kind=charge" -H "Authorization: Bearer $ADMIN"
```

```json
[{"ref":"MQ-MR78K5","status":"succeeded","ledgerStatus":"succeeded","completedAt":"2026-10-30T00:22:24+02:00"},
 {"ref":"MQ-MVBWAR","status":"failed","ledgerStatus":"declined","completedAt":"2026-10-30T00:22:06+02:00"},
 {"ref":"MQ-VVB5NK","status":"succeeded","ledgerStatus":"succeeded","completedAt":"2026-10-30T00:22:05+02:00"}]
```

Then the admin cancels and refunds the Visa booking (online refund) and the cash sale (a pending
counter refund), and edits Karim's booking from F1 (190) to A5 (150), which refunds the difference
to his wallet:

```bash
curl -s -X POST $API/admin/bookings/MQ-VVB5NK/refunds -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $(uuidgen)"
# {"status":"refunded","refunds":[{"id":8,"method":"card","status":"succeeded","amount":38000}]}
curl -s -X POST $API/admin/bookings/MQ-UDWDSK/refunds -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $(uuidgen)"
# {"status":"refunded","refunds":[{"id":9,"method":"cash","status":"pending","amount":23000}]}
curl -s -X POST $API/admin/bookings/MQ-2DSFV4/edits -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' -d '{"seats":["A5"],"reason":"customer_request"}'
# {"difference":{"direction":"refund","amount":{"amount":4000,"currency":"EGP"}},"refunds":[{"id":10,"kind":"refund","method":"wallet","status":"succeeded","amount":4000}]}
curl -s "$API/admin/payments?limit=20" -H "Authorization: Bearer $ADMIN"
```

```json
10
{"id":10,"ref":"MQ-2DSFV4","kind":"refund","purpose":"edit_difference","method":"wallet","status":"succeeded","amount":-4000,"refundOf":2,"markPaidOut":false}
{"id":9,"ref":"MQ-UDWDSK","kind":"refund","purpose":"cancellation","method":"cash","status":"pending","ledgerStatus":"pending","amount":-23000,"refundOf":6,"markPaidOut":true}
{"id":8,"ref":"MQ-VVB5NK","kind":"refund","purpose":"cancellation","method":"card","status":"succeeded","amount":-38000,"refundOf":1,"markPaidOut":false}
{"id":5,"ref":"MQ-MR78K5","kind":"charge","method":"card","status":"succeeded","amount":19000,"refunded":0,"pendingRefund":0}
{"id":7,"ref":"MQ-YKMGSN","kind":"charge","method":"card_terminal","status":"succeeded","amount":15000,"receipt":"TRX-77","collectedBy":"Hany Adel"}
{"id":6,"ref":"MQ-UDWDSK","kind":"charge","method":"cash","status":"succeeded","amount":23000,"refunded":0,"pendingRefund":23000,"collectedBy":"Hany Adel"}
{"id":4,"ref":"MQ-PYUW57","kind":"charge","method":"wallet","status":"failed","ledgerStatus":"cancelled"}
{"id":3,"ref":"MQ-MVBWAR","kind":"charge","method":"card","status":"failed","ledgerStatus":"declined"}
{"id":2,"ref":"MQ-2DSFV4","kind":"charge","method":"wallet","status":"succeeded","amount":19000,"refunded":4000}
{"id":1,"ref":"MQ-VVB5NK","kind":"charge","method":"card","status":"refunded","ledgerStatus":"succeeded","amount":38000,"refunded":38000}
```

Every state of design §13.3 appears: a processing charge `pending`, succeeded charges, a charge
refunded in full `refunded`, a partly refunded charge still `succeeded`, a declined card and a
closed wallet `failed` with their reasons, a pending counter refund `pending` with
`markPaidOut: true` (its cash charge stays `succeeded` with `pendingRefund` until the payout), and
succeeded refunds with negative amounts.

## KPIs, before and after a payout

```bash
curl -s "$API/admin/payments/summary" -H "Authorization: Bearer $ADMIN"
```

```json
{"period":{"dateFrom":"2026-10-23","dateTo":"2026-10-29","from":"2026-10-23T06:00:00+03:00","to":"2026-10-30T06:00:00+02:00"},
 "cinemaDate":"2026-10-29",
 "kpis":{"collectedOnline":{"amount":34000,"currency":"EGP"},"collectedAtCounters":{"amount":38000,"currency":"EGP"},"refunds":{"amount":42000,"currency":"EGP"},"refundRate":0.3684,"failedToday":2},
 "totals":{"gross":114000,"refunds":42000,"net":72000}}
```

The default period is the last 7 cinema days, and its instants straddle the clock change
(`+03:00` to `+02:00`). The pending cash refund is not counted yet. Then the payout:

```bash
curl -s -X POST $API/admin/refunds/9/payouts -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $(uuidgen)"
# {"id":9,"status":"succeeded","paidOutAt":"2026-10-30T00:22:33+02:00","paidOutBy":{"id":1,"fullName":"Seed Admin"}}
curl -s "$API/admin/payments/summary" -H "Authorization: Bearer $ADMIN"
```

```json
{"kpis":{"collectedOnline":{"amount":34000,"currency":"EGP"},"collectedAtCounters":{"amount":15000,"currency":"EGP"},"refunds":{"amount":65000,"currency":"EGP"},"refundRate":0.5702,"failedToday":2},
 "totals":{"gross":{"amount":114000,"currency":"EGP"},"chargeCount":5,"refunds":{"amount":65000,"currency":"EGP"},"refundCount":3,"net":{"amount":49000,"currency":"EGP"}},
 "failed":{"count":2,"declinedCount":1,"cancelledCount":1},
 "byChannel":[{"channel":"online","gross":76000,"refunds":42000,"net":34000},{"channel":"counter","gross":38000,"refunds":23000,"net":15000}],
 "byMethod":[{"method":"card","gross":57000,"chargeCount":2,"refunds":38000,"refundCount":1,"net":19000},
             {"method":"wallet","gross":19000,"chargeCount":1,"refunds":4000,"refundCount":1,"net":15000},
             {"method":"cash","gross":23000,"chargeCount":1,"refunds":23000,"refundCount":1,"net":0},
             {"method":"card_terminal","gross":15000,"chargeCount":1,"refunds":0,"refundCount":0,"net":15000}],
 "reconciliation":{
   "byTheater":[{"theater":"Maqady Downtown","online":19000,"cash":23000,"cardTerminal":0,"refunds":27000,"net":15000},
                {"theater":"Maqady Heliopolis","online":57000,"cash":0,"cardTerminal":15000,"refunds":38000,"net":34000}],
   "totals":{"online":76000,"cash":23000,"cardTerminal":15000,"refunds":65000,"net":49000},
   "provider":{"checkedCount":5,"ledgerSucceeded":{"amount":76000,"currency":"EGP"},"providerSucceeded":{"amount":76000,"currency":"EGP"},"matched":true},
   "mismatches":[],"truncated":false,"consistent":true}}
```

By hand, in piastres: charges 38000 (Visa) + 19000 (slow Visa) + 19000 (Google Pay) + 23000 (cash)
+ 15000 (terminal) = 114000; refunds 38000 + 4000 + 23000 = 65000; net 49000; refund rate
65000 ÷ 114000 = 0.5702. Downtown: 19000 + 23000 − (4000 + 23000) = 15000; Heliopolis: 57000 +
15000 − 38000 = 34000. The provider checked the five final online charges (two Visa, Google Pay,
the decline and the closed wallet).

## Filters, paging and the cinema date

```bash
curl -s "$API/admin/payments?<query>" -H "Authorization: Bearer $ADMIN"
```

| Query | Answer |
|---|---|
| `kind=refund` | `{"total":3,"rows":["9 MQ-UDWDSK refund cash succeeded","10 MQ-2DSFV4 refund wallet succeeded","8 MQ-VVB5NK refund card succeeded"]}` |
| `method=cash` | `{"total":2,"rows":["9 MQ-UDWDSK refund cash succeeded","6 MQ-UDWDSK charge cash refunded"]}` |
| `channel=counter` | `{"total":3,"rows":["9 … refund cash succeeded","7 MQ-YKMGSN charge card_terminal succeeded","6 … charge cash refunded"]}` |
| `status=refunded` | `{"total":2,"rows":["6 MQ-UDWDSK charge cash refunded","1 MQ-VVB5NK charge card refunded"]}` |
| `status=failed` | `{"total":2,"rows":["4 MQ-PYUW57 charge wallet failed","3 MQ-MVBWAR charge card failed"]}` |
| `status=pending` | `{"total":0,"rows":[]}` |
| `theaterId=2&kind=charge` (Downtown) | `{"total":3,"rows":["6 MQ-UDWDSK charge cash refunded","4 MQ-PYUW57 charge wallet failed","2 MQ-2DSFV4 charge wallet succeeded"]}` |
| `dateFrom=2026-10-29&dateTo=2026-10-29&limit=1` | `{"total":10,"rows":["9 MQ-UDWDSK refund cash succeeded"]}` (all of it happened after midnight, on cinema day the 29th) |
| `dateFrom=2026-10-30` | `{"total":0,"rows":[]}` |
| `limit=4`, then `limit=4&cursor=<nextCursor>` | `{"total":10,"ids":[9,10,8,5],"nextCursor":"WyIyMDI2…"}` then `{"total":10,"ids":[7,6,4,3],"nextCursor":true}` |

The summary of cinema day 30 October (from 06:00 that morning) is empty, while today's failed
charges still show in `failedToday`:

```json
{"period":{"dateFrom":"2026-10-30","dateTo":"2026-10-30","from":"2026-10-30T06:00:00+02:00","to":"2026-10-31T06:00:00+02:00"},
 "kpis":{"collectedOnline":{"amount":0,"currency":"EGP"},"collectedAtCounters":{"amount":0,"currency":"EGP"},"refunds":{"amount":0,"currency":"EGP"},"refundRate":null,"failedToday":2},
 "byTheater":[],"consistent":true}
```

## A deliberately inconsistent record

Two records broken on purpose in the development database, then restored:

```bash
psql -d maqady_u16_dev -c "SET search_path=maqady;
  UPDATE payments SET amount = 14000 WHERE id = 7;   -- the terminal charge, 10 EGP short of its booking
  UPDATE payments SET provider_reference = replace(provider_reference, 'sim_card_slow.', 'sim_card_slow_declined.') WHERE id = 5;"
curl -s "$API/admin/payments/summary" -H "Authorization: Bearer $ADMIN" | jq .reconciliation
```

```json
{"provider":{"checkedCount":5,"ledgerSucceeded":{"amount":76000,"currency":"EGP"},"providerSucceeded":{"amount":57000,"currency":"EGP"},"matched":false},
 "mismatches":[
  {"check":"booking_balance","bookingReference":"MQ-YKMGSN","paymentId":null,"expectedAmount":{"amount":15000,"currency":"EGP"},"actualAmount":{"amount":14000,"currency":"EGP"},"ledgerStatus":null,"providerStatus":null,
   "message":"Booking MQ-YKMGSN is confirmed and should hold EGP 150, but its succeeded charges minus refunds come to EGP 140."},
  {"check":"provider_status","bookingReference":"MQ-MR78K5","paymentId":5,"expectedAmount":null,"actualAmount":null,"ledgerStatus":"succeeded","providerStatus":"declined",
   "message":"Payment 5 of MQ-MR78K5 is succeeded in the ledger but declined at the provider."}],
 "truncated":false,"consistent":false}
```

After restoring both rows: `{"matched":true,"mismatches":[],"consistent":true}`.

## Access and validation

| Request | Answer |
|---|---|
| `GET /admin/payments`, box office token | `403 {"error":{"code":"FORBIDDEN","message":"You do not have access to this.","details":null,"correlationId":"…"}}` |
| `GET /admin/payments/summary`, box office token | `403 FORBIDDEN` (same body) |
| either route, customer token | `401 {"error":{"code":"UNAUTHENTICATED","message":"Sign in to continue.",…}}` |
| either route, no token | `401 UNAUTHENTICATED` |
| `GET /admin/payments?status=processing` | `400 VALIDATION_FAILED` on `status` (the shown statuses only) |
| `GET /admin/payments?dateFrom=2026-10-30&dateTo=2026-10-29` | `400 VALIDATION_FAILED` on `dateTo` |
| `GET /admin/payments?cursor=bad%20cursor` | `400 VALIDATION_FAILED` on `cursor` |
| `GET /admin/payments/summary?dateFrom=2025-10-28&dateTo=2026-10-29` (367 days) | `400 VALIDATION_FAILED` on `dateFrom` |
| `GET /admin/payments/summary?dateTo=yesterday` | `400 VALIDATION_FAILED` on `dateTo` |

## Log hygiene

The 33 request lines of the run carry the route template, status, timing, the principal's kind and
id and the correlation id, never a query string: for example

```json
{"level":"warn","correlationId":"9b051097-…","method":"GET","route":"/api/v1/admin/payments/summary","statusCode":400,"responseTime":2,"principalKind":"staff","principalId":1,"msg":"request completed"}
```

`grep -cE 'Nadia|nadia\.qa16|Karim|Bearer ey' app.log` → `0`: no customer name, email or token
was logged.

The app was stopped by its PID after the run.
