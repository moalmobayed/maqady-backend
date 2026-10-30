---
title: U17 — Overview and bell manual QA
owner: Mohamed Tarek
status: Passed
last_verified: 2026-10-29
tags: [qa, admin, overview, kpis, heatmap, alerts, bell, cinema-day, curl]
---

# U17 — Overview and bell: manual QA

Run on 2026-10-30 at 02:24–02:27 Cairo time, on the real clock, the night Egypt's summer time
ended, so Cairo is `+02:00` and it is still cinema day **2026-10-29** (Thursday) until 06:00.
Against `maqady_u17_dev` seeded with `npm run seed` (demo dataset: five active theaters, one
active hall each, showtimes on the cinema days 2026-10-30 to 2026-11-04, nothing on 10-29), the app
started from the build with `node dist/main.js` on port 3125 (`EMAIL_DRIVER=simulated`,
`STORAGE_DRIVER=local`). `$API` is `http://localhost:3125/api/v1`. Every request below ran in
this order; responses are trimmed to the fields that matter.

## Setup

- The seed admin (`seed-admin@maqady.local`, staff id 1) signed in with `POST /admin/auth/sessions`
  → `201`. A box office member (Hany Adel, staff id 2) was created by a QA-only command (the real
  `PasswordService.hash()` and an insert into `staff_users`: the invite link is not readable with
  the simulated driver), then signed in through the same route → `201`.
- Four customers registered with `POST /auth/registrations` → `201` (Layla id 1, Omar 2, Nadia 3,
  Karim 4).
- A QA theater through the admin routes: `POST /admin/theaters` "QA Night Cinema" → `201 id 7`;
  `PUT …/hours` (every day 06:00–05:30) and `PUT …/prices` (150/190/230) → `200`;
  `POST /admin/theaters/7/halls` "Hall Q" → `201 id 6`; `PUT /admin/halls/6/layout` (4 × 8, a
  wheelchair space and a gap) → `200 seatCount 31`; hall and theater `PATCH … {"status":"active"}`
  → `200`; `POST /admin/theaters/7/special-dates {"cinemaDate":"2026-11-02","closed":true}` →
  `201`; `POST /admin/showtimes` for movie 6 (88 minutes) in hall 6 on cinema date 2026-10-29 at
  `03:30` → `201 id 123, startsAt 2026-10-30T03:30:00+02:00`, and on 2026-10-30 at 19:30 →
  `201 id 124`.

## The bell before any sale

`GET /admin/alerts?limit=100` (admin) → `200 total=10 unread=10`:

```
low-sales:123
hall-gap:2:2026-10-29  hall-gap:3:2026-10-29  hall-gap:4:2026-10-29  hall-gap:5:2026-10-29
hall-gap:1:2026-10-29
hall-gap:6:2026-10-31  hall-gap:6:2026-11-01  hall-gap:6:2026-11-03  hall-gap:6:2026-11-04
```

The seeded halls have nothing on today's cinema day (gaps ordered by theater name: Downtown,
Heliopolis, New Cairo, Sheikh Zayed, Zamalek). Hall Q has a show today and on 10-30, so its gaps
are 10-31, 11-01, 11-03 and 11-04: **11-02 is closed by its special date, so it is no gap.** No
failed-payments alert: nothing failed yet.

## Sales

| Booking | Showtime (cinema date) | How | Answer |
|---|---|---|---|
| `MQ-CADQEZ` | 1, Zamalek (10-30) | Layla holds B2 B3, pays `sim_card_visa` | `201`, confirmed, 30000 |
| `MQ-5222XJ` | 25, Downtown (10-30) | Omar holds C1, pays `sim_wallet_apple_pay` | `201`, confirmed, 15000 |
| `MQ-CJDRWU` | 1, Zamalek (10-30) | box office counter hold D1, `counter-payments` cash walk-in | `201`, confirmed, 19000 |
| `MQ-VN7FAH` | 123, QA (10-29, 03:30) | Nadia holds B1 B2, pays `sim_card_visa` | `201`, confirmed, 38000 |
| `MQ-WEVRPB` | 1 | Karim holds C2, pays `sim_card_declined` | `201 payment.status declined`; `DELETE /holds/MQ-WEVRPB` → `204` |

`GET /admin/alerts?limit=2` (admin) → `200 total=11 unread=11`, first two
`('failed-payments:2026-10-29:1', '1 online payment failed today')`,
`('low-sales:123', 'Little Falafel Detectives 03:30 in Hall Q, QA Night Cinema, is 6% sold')`,
`nextCursor` set.

Then Karim holds C2 and pays `sim_wallet_cancelled` → `201 payment.status cancelled` (released);
holds C2 C3 and pays by Visa → `succeeded`, and the admin refunds it
(`POST /admin/bookings/MQ-QK8GZ2/refunds`) → `201`, stored `refunded`, 30000.

## Overview

`GET /admin/overview?period=today` (admin) → `200`:

```json
{"period":{"preset":"today","dateFrom":"2026-10-29","dateTo":"2026-10-29","days":1,
  "from":"2026-10-29T06:00:00+03:00","to":"2026-10-30T06:00:00+02:00"},
 "comparison":{"basis":"same_weekday_last_week","dateFrom":"2026-10-22","dateTo":"2026-10-22",...},
 "cinemaDate":"2026-10-29","serverTime":"2026-10-30T02:25:29+02:00",
 "kpis":{"revenue":{"value":{"amount":38000},"previous":{"amount":0},"change":null},
  "ticketsSold":{"value":2,"previous":0,"change":null},
  "occupancy":{"value":0.0645,"previous":null,"change":null},
  "averageTicket":{"value":{"amount":19000},"previous":null,"change":null},
  "counterShare":{"value":0,"previous":null,"change":null}},
 "byTheater":[{"theater":{"id":7,"name":"QA Night Cinema"},"revenue":{"amount":38000},"ticketsSold":2,
  "seatsOnSale":31,"occupancy":0.0645,"showtimeCount":1,"averageTicket":{"amount":19000},
  "online":{"amount":38000},"counter":{"amount":0},"previousRevenue":{"amount":0},"change":null}],
 "paymentMethods":[["card",38000,1],["wallet",0,0],["cash",0,0],["card_terminal",0,0]],
 "heatmap (non-empty)":[{"weekday":4,"slot":"after_midnight","showtimeCount":1,"ticketsSold":2,
  "seatsOnSale":31,"occupancy":0.0645}],
 "tonight":{"cinemaDate":"2026-10-29","total":1,"items":[{"showtimeId":123,
  "startsAt":"2026-10-30T03:30:00+02:00","endsAt":"2026-10-30T04:58:00+02:00","cinemaDate":"2026-10-29",
  "hasStarted":false,"hall":{"id":6,"name":"Hall Q"},"ticketsSold":2,"seatCapacity":31,
  "soldShare":0.0645,"revenue":{"amount":38000}}]},
 "revenueTrend":{"dateFrom":"2026-09-30","dateTo":"2026-10-29","totals (30 points, non-zero)":[["2026-10-29",38000]]}}
```

The 03:30 show starts on 30 October by the calendar and counts on cinema day 10-29 (Thursday,
weekday 4, slot `after_midnight`); the period ends at 06:00 `+02:00`, after the clock change.
Nothing of 10-30 is in it.

`GET /admin/overview?dateFrom=2026-10-30&dateTo=2026-10-30` → `200`, `preset null`, comparison
`same_weekday_last_week` (10-23):

| Figure | Answer | By hand |
|---|---|---|
| Revenue | 64000 | 30000 + 15000 + 19000; Karim's refunded 30000 and his two failed holds drop out |
| Tickets sold | 4 | 2 + 1 + 1 |
| Occupancy | 0.0009 | 4 ÷ 4255; `SELECT sum(seat_capacity) … WHERE cinema_date='2026-10-30' AND status='scheduled'` → `23 \| 4255` |
| Avg. ticket | 16000 | 64000 ÷ 4 |
| Counter share | 0.2969 | 19000 cash ÷ 64000 |

`byTheater`: Zamalek 49000, 3 tickets, 768 seats, 0.0039, online 30000 / counter 19000; Downtown
15000, 1, 960, 0.001, online 15000; then Heliopolis, New Cairo, Sheikh Zayed and QA Night Cinema
at 0 (each had showtimes). `paymentMethods`: card 30000 (0.4688), wallet 15000 (0.2344), cash
19000 (0.2969), card terminal 0. `topMovies`: The Last Lighthouse 49000 (3 tickets, 4 showtimes),
Khan el-Khalili Blues 15000, then three at 0.

`GET /admin/overview?dateFrom=2026-10-30&dateTo=2026-10-30&theaterId=1` → `200`, `theater {"id":1,
"name":"Maqady Zamalek"}`, revenue 49000, `byHall [{"hall":{"id":1,"name":"Hall 1"},"revenue":
{"amount":49000},"ticketsSold":3,"seatsOnSale":768,"occupancy":0.0039,"showtimeCount":4}]`,
`byTheater` only theater 1, the trend's lines only theater 1, `tonight.total 0` (Zamalek has
nothing today).

`GET /admin/overview?period=7d` → `200`, period 2026-10-23 to 2026-10-29, comparison
`previous_period` 2026-10-16 to 2026-10-22, revenue 38000 against 0, change null.
`GET /admin/overview?period=30d` → `200`, from 2026-09-30, 30 days, comparison 2026-08-31 to
2026-09-29.

After the counter sales further down (9 seats on showtime 123 in cash), `period=today` reads
revenue 209000 (38000 + 8 × 19000 + 19000), 11 tickets, occupancy 0.3548 (11 ÷ 31), counter share
0.8182 (171000 ÷ 209000).

Refusals, each `{"error":{"code",...,"details"}}`:

| Request | Answer |
|---|---|
| `?period=week` | `400 VALIDATION_FAILED` `period must be one of the following values: today, 7d, 30d` |
| `?period=today&dateFrom=2026-10-29` | `400` `period cannot be combined with dateFrom or dateTo` |
| `?dateFrom=2026-10-30&dateTo=2026-10-29` | `400` `dateTo must be on or after dateFrom` |
| `?dateFrom=2025-01-01&dateTo=2026-10-29` | `400` `the period may cover at most 366 days` |
| `?theaterId=0` | `400` `theaterId must not be less than 1` |
| `?hallId=1` | `400` `property hallId should not exist` |
| `?theaterId=999` | `404 NOT_FOUND` |
| box office token | `403 FORBIDDEN` |
| customer token (Layla) | `401 UNAUTHENTICATED` |
| no token | `401 UNAUTHENTICATED` |

## The bell and its read state

`GET /admin/alerts?limit=100` (admin) → `200 total=11 unread=11`:

```
failed-payments:2026-10-29:2  unread | 2 online payments failed today
low-sales:123                 unread | Little Falafel Detectives 03:30 in Hall Q, QA Night Cinema, is 6% sold
hall-gap:2:2026-10-29 … hall-gap:1:2026-10-29 (5)   unread
hall-gap:6:2026-10-31, 11-01, 11-03, 11-04 (4)      unread
```

The decline and the closed wallet are **one** alert with the count in its key. The box office
member's bell: `200 (11, 11)`: the same 11 keys. One alert in full (`?limit=2`, second item):

```json
{"key":"low-sales:123","kind":"low_sales","cinemaDate":"2026-10-29",
 "title":"Little Falafel Detectives 03:30 in Hall Q, QA Night Cinema, is 6% sold","read":false,
 "readAt":null,"failedPayments":null,"lowSales":{"showtimeId":123,"startsAt":"2026-10-30T03:30:00+02:00",
 "movie":{"id":6,"name":"Little Falafel Detectives"},"theater":{"id":7,"name":"QA Night Cinema"},
 "hall":{"id":6,"name":"Hall Q"},"ticketsSold":2,"seatCapacity":31,"soldShare":0.0645},"hallGap":null}
```

with `nextCursor "WyJsb3ctc2FsZXM6MTIzIiwyXQ"`, `cinemaDate "2026-10-29"`.

| Step | Request | Answer |
|---|---|---|
| Admin opens two | `POST /admin/alert-reads {"keys":["failed-payments:2026-10-29:2","low-sales:123"]}` | `200 {"markedCount":2,"unreadCount":9,"total":11}` |
| Admin's bell | `GET /admin/alerts?limit=100` | `total=11 unread=9`; the 9 gaps first, then `failed-payments:2026-10-29:2 read 2026-10-30T02:25:57+02:00` and `low-sales:123 read …` |
| Box office's bell | same, box office | `(11, 11)`: their badge is their own |
| Again | `{"keys":["low-sales:123"]}` | `200 {"markedCount":0,"unreadCount":9,"total":11}` |
| A stale key | `{"keys":["failed-payments:2026-10-29:1"]}` | `200 {"markedCount":0,"unreadCount":9,"total":11}` |
| A third failure | Karim holds C4 on showtime 25, `sim_card_declined` | `201 declined` (released) |
| Admin's bell | `?limit=3` | `(11, 10)`, first `('failed-payments:2026-10-29:3', False)`: a new key, unread again; `…:2` is gone |
| Box office pages of 4 | `?limit=4`, then `cursor=nextCursor` twice | `total=11 unread=11` on each page; keys 4 + 4 + 3 = every key once, in the full list's order, the last `nextCursor` null |
| Box office "Mark all" | `POST /admin/alert-reads` (no body), `Idempotency-Key K` | `200 {"markedCount":11,"unreadCount":0,"total":11}` |
| Replay | same request, same key K | `200` the same body, `Idempotent-Replayed: true` |
| Badges | both bells | box office `(11, 0)`; admin `(11, 10)` |

`staff_alert_reads` afterwards: 13 rows: staff 1 `failed-payments:2026-10-29:2`, `low-sales:123`;
staff 2 the 11 keys current at the time, all with `seen_at` of their marking.

## Alerts that stop holding

| Step | Answer |
|---|---|
| Box office sells 8 seats (C1–C8) of showtime 123 in cash | `201` |
| Bell | the low-sales alert reads `… is 32% sold`, `ticketsSold 10`, `soldShare 0.3226` |
| Box office sells B3 | `201` |
| Bell | `total=10`, no low-sales alert: 11 of 31 is 35.5% |
| `POST /admin/showtimes` hall 6 on 2026-10-31 19:30 | `201` |
| Bell | `total=9`; hall 6's gaps are `2026-11-01`, `2026-11-03`, `2026-11-04` |

## Bell refusals

| Request | Answer |
|---|---|
| `POST /admin/alert-reads {"keys":[]}` | `400 VALIDATION_FAILED` `keys must contain at least 1 elements` |
| `{"keys":["Low Sales"]}` | `400` `each key must be an alert key such as low-sales:81` |
| `{"keys":"low-sales:123"}` | `400` `keys must be an array` (with the size messages) |
| `{"other":true}` | `400` `property other should not exist` |
| 201 keys | `400` `keys must contain no more than 200 elements` |
| `GET /admin/alerts?limit=0`, `?limit=101`, `?cursor=bad!` | `400 VALIDATION_FAILED` |
| customer token, `GET` and `POST` | `401 UNAUTHENTICATED` |
| no token | `401 UNAUTHENTICATED` |

## Log hygiene

The app log (309 lines) holds no customer or staff email and no password
(`grep -c -E 'layla@|omar@|nadia@|karim@|hany.box@|Passw0rd'` → `0`). Request lines carry the
route, status, `correlationId` and principal id only, for example
`{"level":"warn","correlationId":"d0f7a535-…","method":"GET","route":"/api/v1/admin/alerts","statusCode":401,"principalKind":null,"principalId":null,"msg":"request completed"}`.

## Result

Passed: every route of the unit answered as the spec says, the numbers match the hand sums, the
cinema day held across the clock change, each condition was one alert per key, and read state
stayed per staff member.
