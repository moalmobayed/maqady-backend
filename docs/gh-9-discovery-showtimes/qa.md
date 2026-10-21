---
title: U8b — Manual QA of the discovery showtimes
owner: Mohamed Tarek
status: Passed
last_verified: 2026-10-20
tags: [qa, discovery, showtimes, ticker, halls, show-date, seed, contract]
---

# U8b — Manual QA of the discovery showtimes

Issue #9, spec [`spec.md`](spec.md). QA mode: `curl`. Environment: Node 22, local PostgreSQL 16,
this unit's own database `maqady_u8b_dev` (created empty for this run), port 3112, fresh secrets
from `openssl rand -base64 32`, `EMAIL_DRIVER=simulated`, `STORAGE_DRIVER=local`. Built with
`npm run build` (through `npm run seed`). Run on 2026-10-21 from 01:05 UTC, which is 04:05 on
Wednesday 21 October in Cairo (`+03:00`), so today's cinema date is still **Tuesday 2026-10-20**
and every slot of that night has passed.

Two ways of serving, both on the same seeded database:

1. **The real app** (`node --enable-source-maps dist/main.js`), on the real clock: what a customer
   sees at 04:05 — nothing is left today, so the ticker is empty, and the next 6 days are full.
2. **A QA-only harness** (`scratchpad/qa/u8b-fixed-clock-app.js`, not committed): the same
   compiled `AppModule` with `configureApp()`, with only the `Clock` provider replaced by a fixed
   instant (`Test.createTestingModule(...).overrideProvider(Clock)`), so the ticker and the
   "started" states can be seen at chosen times of the seeded week. Nothing else is replaced.

`$B` is `http://localhost:3112/api/v1`. Responses are trimmed by node one-liners over the JSON
to the fields named in each step; nothing else was edited.

## Seed: empty database, then again

```
$ npm run seed
Created the seed admin seed-admin@maqady.local.
theaters: 6 created, 0 already there
halls: 5 created, 0 already there
publish-theaters: 5 created, 0 already there
people: 18 created, 0 already there
movies: 12 created, 0 already there
featured: 5 created, 0 already there
showtimes: 124 created, 0 already there
Done. Sign in to the dashboard as seed-admin@maqady.local.

$ npm run seed
theaters: 0 created, 6 already there
halls: 0 created, 5 already there
publish-theaters: 0 created, 5 already there
people: 0 created, 18 already there
movies: 0 created, 12 already there
featured: 0 created, 5 already there
showtimes: 0 created, 124 already there
Done. Sign in to the dashboard as seed-admin@maqady.local.

$ psql …/maqady_u8b_dev -Atc "select count(*), count(distinct (hall_id, starts_at)), min(cinema_date), max(cinema_date) from maqady.showtimes"
124|124|2026-10-21|2026-10-26
```

124 = 6 cinema days (21–26 Oct) × 4 slots × 5 theaters + the after-midnight slots of Downtown and
New Cairo on Thursday 22 and Friday 23; Tuesday 20's slots had all started, so the dry run said
`in_past` and the step created none of them. The second run created nothing.

## The real app at 04:05 (cinema date 2026-10-20)

```
$ curl -si $B/home | grep -i 'HTTP/\|cache-control'
HTTP/1.1 200 OK
Cache-Control: public, max-age=60
$ curl -s $B/home   # serverTime, cinemaDate, ticker, cinemas[name, hallCount]
{"serverTime":"2026-10-21T04:06:05+03:00","cinemaDate":"2026-10-20","ticker":[],
 "cinemas":[["Maqady Downtown",1],["Maqady Heliopolis",1],["Maqady New Cairo",1],["Maqady Sheikh Zayed",1],["Maqady Zamalek",1]]}
```

The ticker is empty because nothing is left on Tuesday's cinema day; each card counts its active
hall.

### `GET /movies/{id}/showtimes`

```
$ curl -si $B/movies/1/showtimes | grep -i 'HTTP/\|cache-control'
HTTP/1.1 200 OK
Cache-Control: public, max-age=60
$ curl -s $B/movies/1/showtimes   # The Last Lighthouse; each chip as start, hall, from price
{ "movieId": 1, "cinemaDate": "2026-10-20",
  "theaters": [
   { "id": 2, "name": "Maqady Downtown", "district": "Downtown", "city": "Cairo", "showtimeCount": 6 },
   { "id": 3, "name": "Maqady Heliopolis", "district": "Heliopolis", "city": "Cairo", "showtimeCount": 6 },
   { "id": 5, "name": "Maqady Sheikh Zayed", "district": "Sheikh Zayed", "city": "Giza", "showtimeCount": 6 },
   { "id": 1, "name": "Maqady Zamalek", "district": "Zamalek", "city": "Cairo", "showtimeCount": 6 } ],
  "days": [
   { "cinemaDate": "2026-10-20", "showtimeCount": 0, "theaters": [] },
   { "cinemaDate": "2026-10-21", "showtimeCount": 4, "theaters": [
      "Maqady Downtown: 10-21T16:15 Hall 1 from 15000",
      "Maqady Heliopolis: 10-21T19:00 Hall 1 from 15000",
      "Maqady Sheikh Zayed: 10-21T21:45 Hall 1 from 15000",
      "Maqady Zamalek: 10-21T13:30 Hall 1 from 15000" ] },
   … 2026-10-22 to 2026-10-26 the same 4 theaters and times …
  ] }
```

Exactly 7 days, today (the 20th, empty) first; theaters by name; New Cairo is not in the picker
because it doesn't show this movie.

```
$ curl -s $B/movies?status=coming_soon   # ids
8 Desert Signal · 9 The Cartographer of Siwa · 10 Midnight at Ramses Station · 11 Paper Kites over Giza
$ curl -s $B/movies/8/showtimes   # movieId, theaters, days[cinemaDate, showtimeCount, theaters.length]
{"movieId":8,"theaters":[],"days":[["2026-10-20",0,0],["2026-10-21",0,0],["2026-10-22",0,0],["2026-10-23",0,0],["2026-10-24",0,0],["2026-10-25",0,0],["2026-10-26",0,0]]}
$ curl -s -o /dev/null -w '%{http_code}' $B/movies/12/showtimes   # the draft movie, Echoes of Abydos
404
$ curl -s -o /dev/null -w '%{http_code}' $B/movies/abc/showtimes
400
```

### `GET /theaters/{id}/showtimes`

```
$ curl -s "$B/theaters/2/showtimes?date=2026-10-22"   # Downtown, Thursday: movies by first showtime
{ "theaterId": 2, "cinemaDate": "2026-10-20",
  "days": [ { "cinemaDate": "2026-10-22", "movies": [
    "Khan el-Khalili Blues: 2026-10-22T13:30:00+03:00 (cinemaDate 2026-10-22), 2026-10-23T00:15:00+03:00 (cinemaDate 2026-10-22)",
    "The Last Lighthouse: 2026-10-22T16:15:00+03:00 (cinemaDate 2026-10-22)",
    "Red Sea Rising: 2026-10-22T19:00:00+03:00 (cinemaDate 2026-10-22)",
    "Garden City Romance: 2026-10-22T21:45:00+03:00 (cinemaDate 2026-10-22)" ] } ] }
```

The 00:15 show on Friday 23 is listed under **Thursday 22**, its cinema date, with its real
`startsAt`. One chip in full:

```
{"id":26,"startsAt":"2026-10-22T13:30:00+03:00","endsAt":"2026-10-22T15:11:00+03:00","cinemaDate":"2026-10-22",
 "hall":{"id":2,"name":"Hall 1"},
 "prices":{"front":{"amount":15000,"currency":"EGP"},"middle":{"amount":19000,"currency":"EGP"},"back":{"amount":23000,"currency":"EGP"}},
 "fromPrice":{"amount":15000,"currency":"EGP"},"hasStarted":false}
```

```
$ curl -s $B/theaters/2/showtimes   # the 7 days: movie x showtimes
2026-10-20:
2026-10-21: Khan el-Khalili Blues x1, The Last Lighthouse x1, Red Sea Rising x1, Garden City Romance x1
2026-10-22: Khan el-Khalili Blues x2, The Last Lighthouse x1, Red Sea Rising x1, Garden City Romance x1
2026-10-23: Khan el-Khalili Blues x2, The Last Lighthouse x1, Red Sea Rising x1, Garden City Romance x1
2026-10-24: Khan el-Khalili Blues x1, The Last Lighthouse x1, Red Sea Rising x1, Garden City Romance x1
2026-10-25: Khan el-Khalili Blues x1, The Last Lighthouse x1, Red Sea Rising x1, Garden City Romance x1
2026-10-26: Khan el-Khalili Blues x1, The Last Lighthouse x1, Red Sea Rising x1, Garden City Romance x1
$ for d in 2026-10-19 2026-10-27; do curl -s "$B/theaters/2/showtimes?date=$d"; done   # outside the 7 days
{"theaterId":2,"cinemaDate":"2026-10-20","days":[{"cinemaDate":"2026-10-19","movies":[]}]}
{"theaterId":2,"cinemaDate":"2026-10-20","days":[{"cinemaDate":"2026-10-27","movies":[]}]}
$ curl -s "$B/theaters/2/showtimes?date=2026-02-30"
{"error":{"code":"VALIDATION_FAILED","message":"The request is not valid.","details":{"fields":[{"field":"date","messages":["date must hold dates written YYYY-MM-DD, at the latest 9999-11-30"]}]},"correlationId":"5ea5dacb-…"}}
$ curl -s $B/theaters/6/showtimes   # Maqady Dokki, the draft; then an unknown id
404 NOT_FOUND
404 NOT_FOUND
$ curl -si $B/theaters/6/showtimes | grep -i cache-control
Cache-Control: no-store
```

### The movie side panel, the show-date filter, the theater halls

```
$ curl -s $B/movies/1   # showtimeSummary
{ "nextShowToday": null, "cinemaCount": 4, "fromPrice": { "amount": 15000, "currency": "EGP" } }
$ curl -s $B/movies/8   # Coming soon: showtimeSummary
{"nextShowToday":null,"cinemaCount":0,"fromPrice":null}

$ for q in "" showDate=today showDate=tomorrow showDate=weekend; do curl -s "$B/movies?$q"; done   # total, tabCounts
(any) total 7 {"nowShowing":7,"comingSoon":4}
showDate=today total 0 {"nowShowing":0,"comingSoon":4}
showDate=tomorrow total 7 {"nowShowing":7,"comingSoon":4}
showDate=weekend total 7 {"nowShowing":7,"comingSoon":4}
$ curl -s "$B/movies?status=coming_soon&showDate=today"
{"error":{"code":"VALIDATION_FAILED","message":"The request is not valid.","details":{"fields":[{"field":"showDate","messages":["showDate applies to the now_showing tab only"]}]},"correlationId":"e01e616f-…"}}
$ curl -s "$B/movies?showDate=sunday"   # error.details
{"fields":[{"field":"showDate","messages":["showDate must be one of the following values: today, tomorrow, weekend"]}]}

$ curl -s $B/theaters/1   # id, name, hallCount, halls
{"id":1,"name":"Maqady Zamalek","hallCount":1,"halls":[{"id":1,"name":"Hall 1","seatCount":192,"wheelchairCount":0}]}
$ curl -s $B/theaters   # items[name, hallCount]
[["Maqady Downtown",1],["Maqady Heliopolis",1],["Maqady New Cairo",1],["Maqady Sheikh Zayed",1],["Maqady Zamalek",1]]
```

On Tuesday's cinema day at 04:05 nothing is left "today"; tomorrow (Wednesday 21) and this weekend
(Friday 23 and Saturday 24) have all 7 Now showing movies, and the Coming soon count ignores the
filter.

## The harness at chosen instants

### Wednesday 21 October, 18:00 — the ticker, and the `/home` comparison with the draft

```
$ node scratchpad/qa/u8b-fixed-clock-app.js 2026-10-21T18:00:00+03:00 &
fixed clock 2026-10-21T15:00:00.000Z on 3112
$ curl -s $B/home   # serverTime, cinemaDate, ticker
{ "serverTime": "2026-10-21T18:00:00+03:00", "cinemaDate": "2026-10-21",
  "ticker": [
   { "movie": { "id": 2, "title": "Nile After Midnight" },
     "nextShowtime": { "id": 13, "startsAt": "2026-10-21T19:00:00+03:00", "cinemaDate": "2026-10-21", "theater": { "id": 1, "name": "Maqady Zamalek" } } },
   { "movie": { "id": 5, "title": "Red Sea Rising" },
     "nextShowtime": { "id": 37, "startsAt": "2026-10-21T19:00:00+03:00", "cinemaDate": "2026-10-21", "theater": { "id": 2, "name": "Maqady Downtown" } } },
   { "movie": { "id": 1, "title": "The Last Lighthouse" },
     "nextShowtime": { "id": 63, "startsAt": "2026-10-21T19:00:00+03:00", "cinemaDate": "2026-10-21", "theater": { "id": 3, "name": "Maqady Heliopolis" } } },
   { "movie": { "id": 7, "title": "Garden City Romance" },
     "nextShowtime": { "id": 87, "startsAt": "2026-10-21T19:00:00+03:00", "cinemaDate": "2026-10-21", "theater": { "id": 4, "name": "Maqady New Cairo" } } },
   { "movie": { "id": 6, "title": "Little Falafel Detectives" },
     "nextShowtime": { "id": 113, "startsAt": "2026-10-21T19:00:00+03:00", "cinemaDate": "2026-10-21", "theater": { "id": 5, "name": "Maqady Sheikh Zayed" } } },
   { "movie": { "id": 3, "title": "Sandstorm Protocol" },
     "nextShowtime": { "id": 19, "startsAt": "2026-10-21T21:45:00+03:00", "cinemaDate": "2026-10-21", "theater": { "id": 1, "name": "Maqady Zamalek" } } } ] }
$ curl -s $B/home | node scratchpad/qa/u8b-validate-home.js
HomeResponse valid
TickerItem valid
TickerItem valid
TickerItem valid
TickerItem valid
TickerItem valid
TickerItem valid
```

Soonest first (ties at 19:00 by showtime id); Khan el-Khalili Blues is left out because its two
Wednesday shows (13:30 Downtown, 16:15 New Cairo) have started. `u8b-validate-home.js` compiles
`HomeResponse` and `TickerItem` from `contracts/drafts/home-page.openapi.yaml` with ajv (formats
strict, `nullable` as "or null", as `test/support/discovery.ts` does) and validates the real
response and every ticker item: all valid. The schema-by-schema comparison of the generated
contract with the draft is the integration suite `discovery-contract.test.ts` (below, "Gates":
it passes with the new routes in the document).

```
$ curl -s $B/movies/1   # showtimeSummary at 18:00
{"nextShowToday":{"id":63,"startsAt":"2026-10-21T19:00:00+03:00","cinemaDate":"2026-10-21",
  "theater":{"id":3,"name":"Maqady Heliopolis","district":"Heliopolis","city":"Cairo"},"hall":{"id":3,"name":"Hall 1"},
  "fromPrice":{"amount":15000,"currency":"EGP"}},"cinemaCount":4,"fromPrice":{"amount":15000,"currency":"EGP"}}
$ curl -s "$B/movies?showDate=today"   # titles, tabCounts
Garden City Romance, Sandstorm Protocol, Nile After Midnight, The Last Lighthouse, Red Sea Rising, Little Falafel Detectives {"nowShowing":6,"comingSoon":4}
```

### Friday 23 October, 00:05 — after midnight, still Thursday's cinema day

```
$ node scratchpad/qa/u8b-fixed-clock-app.js 2026-10-23T00:05:00+03:00 &
fixed clock 2026-10-22T21:05:00.000Z on 3112
$ curl -s $B/home   # serverTime, cinemaDate, ticker
{"serverTime":"2026-10-23T00:05:00+03:00","cinemaDate":"2026-10-22","ticker":[
 {"movie":{"id":4,"title":"Khan el-Khalili Blues"},"nextShowtime":{"id":49,"startsAt":"2026-10-23T00:15:00+03:00","cinemaDate":"2026-10-22","theater":{"id":2,"name":"Maqady Downtown"}}},
 {"movie":{"id":2,"title":"Nile After Midnight"},"nextShowtime":{"id":99,"startsAt":"2026-10-23T00:20:00+03:00","cinemaDate":"2026-10-22","theater":{"id":4,"name":"Maqady New Cairo"}}}]}
$ curl -s $B/home | node scratchpad/qa/u8b-validate-home.js
HomeResponse valid
TickerItem valid
TickerItem valid
$ curl -s $B/movies/2/showtimes   # days[0]: theater, [startsAt, cinemaDate, hasStarted]
2026-10-22 [["Maqady New Cairo",[["2026-10-23T00:20:00+03:00","2026-10-22",false]]]]
```

Only the two after-midnight shows are left "today", both under cinema date 2026-10-22.

### Wednesday 21 October, 17:00 — a started chip

```
$ node scratchpad/qa/u8b-fixed-clock-app.js 2026-10-21T17:00:00+03:00 &
fixed clock 2026-10-21T14:00:00.000Z on 3112
$ curl -s "$B/theaters/1/showtimes?date=2026-10-21"   # Zamalek: start-end, started
Little Falafel Detectives: 16:15-17:43 started
Nile After Midnight: 19:00-20:52
Sandstorm Protocol: 21:45-23:49
$ curl -s "$B/movies?showDate=weekend"   # total, tabCounts
weekend 7 {"nowShowing":7,"comingSoon":4}
```

The 13:30 show (ended at 15:38) is left out; the 16:15 one is running and marked started.

## Logs

Request lines name the route template and status, never a query value:

```
{"level":"warn",…,"correlationId":"3dde05a5-…","method":"GET","route":"/api/v1/movies/:id/showtimes","statusCode":404,"responseTime":3,"principalKind":null,"principalId":null,"msg":"request completed"}
{"level":"warn",…,"correlationId":"51956de9-…","method":"GET","route":"/api/v1/movies/:id/showtimes","statusCode":400,"responseTime":1,"principalKind":null,"principalId":null,"msg":"request completed"}
```

## Result

Every route added or changed answers as the spec says on a seeded database: the 7-day lists grouped
by cinema date (the 00:15 and 00:20 shows under the previous date), prices and "from" prices,
ended showtimes left out and started ones marked, Coming soon empty, draft and unknown `404`,
malformed dates `400`; the side panel, the show-date filter and its tab counts, the theater halls
and hall counts; and a non-empty ticker that validates against the draft's `HomeResponse` and
`TickerItem`. The seed runs twice without duplicating a showtime.
