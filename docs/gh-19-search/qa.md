---
title: U18 — Search manual QA
owner: Mohamed Tarek
status: Passed
last_verified: 2026-10-30
tags: [qa, search, admin, roles, anonymisation, rate-limit, curl]
---

# U18 — Search: manual QA

Run on 2026-10-30 just after midnight UTC (02:16 Cairo time), on the real clock, against
`maqady_u18_dev` seeded with `npm run seed` (demo dataset: 12 movies, one of them the draft
"Echoes of Abydos"; 18 people; 5 active theaters and the draft "Maqady Dokki"), the app started
from the build with `node dist/main.js` on port 3126 (`EMAIL_DRIVER=simulated`,
`STORAGE_DRIVER=local`, the production rate limits). `$API` is `http://localhost:3126/api/v1`.
Responses are trimmed with `jq` to the fields that matter; the trimming filter is shown once.

Setup. The seed admin (`seed-admin@maqady.local`) and a box office member (`Hany Adel`, created
by a QA-only insert into `staff_users` with the real `PasswordService.hash()`: the invite link is
not readable with the simulated driver) signed in through `POST /admin/auth/sessions`. Two
customers registered through `POST /auth/registrations` and set a phone with `PATCH /me`
(answers `{"fullName":"Layla Hassan","phone":"+201012345678"}` and
`{"fullName":"Salma Nour","phone":"+201087654321"}`), then each held one seat of seeded showtime 1
(The Last Lighthouse, Maqady Zamalek) and paid by card:
`{"reference":"MQ-N9UMNJ","status":"confirmed","payment":"succeeded"}` (Layla, E5) and
`{"reference":"MQ-JW9N4S","status":"confirmed","payment":"succeeded"}` (Salma, E6).

## Public search, `GET /search`

```bash
curl -s -G "$API/search" --data-urlencode "q=$Q" -H 'X-Forwarded-For: 198.51.100.20' | jq -c \
  '{q, movies: [.movies.items[] | {id, title, status, matchedPerson: (.matchedPerson.fullName // null)}],
    moviesMore: .movies.hasMore, people: [.people.items[] | {id, fullName, roles}],
    theaters: [.theaters.items[] | {id, name, district, status}]}'
```

| `q` | Answer (`200`) | Shows |
|---|---|---|
| `lighthouse` | `movies:[{"id":1,"title":"The Last Lighthouse","status":"now_showing","matchedPerson":null}]`, `people:[]`, `theaters:[]` | part of a title, any case |
| `Lighthose` | the same movie 1 | a typo still finds it |
| `abydos`, `Echoes` | every group empty | the draft movie never appears |
| `karim` | `movies:[{"id":7,"title":"Garden City Romance","matchedPerson":"Karim Fahmy"},{"id":1,"title":"The Last Lighthouse","matchedPerson":"Karim Fahmy"}]`, `people:[{"id":1,"fullName":"Karim Fahmy","roles":["actor"]}]` | movies by cast, naming the person; people with roles |
| `Karim Fahmi` | the same | a typo in a name |
| `zamalek`, `Zamalik` | `theaters:[{"id":1,"name":"Maqady Zamalek","district":"Zamalek","status":"active"}]` | by area, a typo included |
| `dokki` | every group empty | the draft theater never appears |
| `maqady` | `theaters`: the 5 active theaters (ids 2, 3, 4, 5, 1, by name within the same rank), `hasMore:false`; Maqady Dokki absent | only `active` theaters |
| `%_` | every group empty | `%` and `_` are plain characters, not wildcards |

One whole movie item (`q=Lighthouse`, the variant list shortened to the names):

```json
{"id":1,"title":"The Last Lighthouse","status":"now_showing","releaseDate":"2026-10-10","runtimeMinutes":128,"ageRating":"12+","poster":{"alt":"The Last Lighthouse poster","variants":["small","medium","large"]},"matchedPerson":null}
```

Headers of `q=nile`: `HTTP/1.1 200 OK`, `X-Request-Id: d06f02a6-…`, `Cache-Control: public, max-age=60`.

Validation (each `400`, `Cache-Control: no-store`):

| Request | Answer |
|---|---|
| `q=a` | `{"code":"VALIDATION_FAILED","fields":[{"field":"q","messages":["q must be longer than or equal to 2 characters"]}]}` |
| `q=   b   ` | the same (trimmed to one character) |
| `q=` 101 × `x` | `{"code":"VALIDATION_FAILED","fields":[{"field":"q","messages":["q must be shorter than or equal to 100 characters"]}]}` |
| no `q` | `{"code":"VALIDATION_FAILED","fields":["q"]}` |

### Rate limit

61 searches in a row from `X-Forwarded-For: 198.51.100.30`:

```bash
for n in $(seq 1 61); do curl -s -o /dev/null -w '%{http_code}\n' -G "$API/search" \
  --data-urlencode "q=nile $n" -H 'X-Forwarded-For: 198.51.100.30'; done | sort | uniq -c
```

`60 × 200`, `1 × 429`. The next one:

```
HTTP/1.1 429 Too Many Requests
Retry-After-search: 60
Retry-After: 60
{"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again shortly.","details":null,"correlationId":"a4677c38-…"}}
```

Another address (`198.51.100.31`) still gets `200`, and so does the staff search from the throttled
address (`GET /admin/search?q=nile` with the admin token: `200`): it is not counted by `search`.

## Staff search, `GET /admin/search`

```bash
curl -s -G "$API/admin/search" --data-urlencode "q=$Q" -H "Authorization: Bearer $TOKEN" | jq -c \
  '{bookings: [.bookings.items[]? | {reference, status, paymentStatus, contact: .contact.name}],
    customers: [.customers.items[]? | {id, fullName, phone}],
    movies: (if .movies == null then null else [.movies.items[] | {id, title, status}] end),
    people: (if .people == null then null else [.people.items[] | .fullName] end),
    theaters: (if .theaters == null then null else [.theaters.items[] | {id, name, status}] end)}'
```

### By role

| `q` | Admin | Box office |
|---|---|---|
| `layla` | `bookings:[{"reference":"MQ-N9UMNJ","status":"confirmed","paymentStatus":"paid","contact":"Layla Hassan"}]`, `customers:[{"id":1,"fullName":"Layla Hassan","phone":"+201012345678"}]`, `movies:[]`, `people:[]`, `theaters:[]` | the same bookings and customers; `movies:null`, `people:null`, `theaters:null` |
| `abydos` | `movies:[{"id":12,"title":"Echoes of Abydos","status":"draft"}]` | `movies:null`, `people:null`, `theaters:null` |
| `dokki` | `theaters:[{"id":6,"name":"Maqady Dokki","status":"draft"}]` | `movies:null`, `people:null`, `theaters:null` |

### Bookings and customers (box office token)

| `q` | Answer |
|---|---|
| `mq-n9umnj` | `bookings:[MQ-N9UMNJ confirmed paid "Layla Hassan"]`, `customers:[]` (a reference finds exactly that booking) |
| `Layla Hasan` | the booking and customer 1 (one typo in the name) |
| `Laila Hasan` | nothing: two typos put it under the 0.6 word-similarity threshold (by design: a looser match would start returning other people) |
| `hassan@exa` | the booking and customer 1 (part of the email) |
| `01012345678` | the booking and customer 1 (a local mobile finds the stored `+201012345678`) |

The whole first items of `q=01012345678` (showtime shortened):

```json
{"booking":{"reference":"MQ-N9UMNJ","status":"confirmed","paymentStatus":"paid","channel":"online","owner":"customer","contact":{"name":"Layla Hassan","email":"layla.hassan@example.com","phone":"+201012345678"},"seatLabels":["E5"],"seatCount":1,"total":{"amount":19000,"currency":"EGP"},"showtime":{"movieTitle":"The Last Lighthouse","theater":"Maqady Zamalek","startsAt":"2026-10-30T13:30:00+02:00"}},
 "customer":{"id":1,"fullName":"Layla Hassan","email":"layla.hassan@example.com","phone":"+201012345678","status":"active","emailVerified":false,"joinedAt":"2026-10-30T02:16:31+02:00"},
 "hasMore":[false,false]}
```

Headers: `HTTP/1.1 200 OK`, `Cache-Control: private, no-store`.

Refusals: no token → `UNAUTHENTICATED`; Layla's customer token (signed in through
`POST /auth/sessions`) → `UNAUTHENTICATED` (a customer token is not a staff token); `q=x` with the
admin token → `VALIDATION_FAILED` on `q`.

### An anonymised customer

Salma (customer 2), before, with the admin token:

| `q` | Answer |
|---|---|
| `Salma Nour`, `salma.nour@`, `01087654321`, `+201087654321` | each `{"bookings":[{"reference":"MQ-JW9N4S","contact":"Salma Nour"}],"customers":[2]}` |

`DELETE /admin/customers/2` →
`{"customerId":2,"bookingsKept":1,"removed":{"sessions":1,"oneTimeTokens":1,"idempotencyKeys":2,"messages":3,"bookingNotes":0,"bookingContacts":1}}`.

After, every one of `Salma Nour`, `salma.nour@`, `01087654321`, `+201087654321`, `salma` and `nour`
answers `{"bookings":[],"customers":[]}` for the admin, and the first three the same for box office.
The booking is kept and its reference still finds it, without a contact:
`q=MQ-JW9N4S` → `{"bookings":[{"reference":"MQ-JW9N4S","status":"confirmed","contact":{"name":null,"email":null,"phone":null}}],"customers":[]}`.

## Log hygiene

The app's log (339 lines for the whole run) has no match for `salma`, `layla`, `hassan`,
`01012345678`, `0108765` or `example.com`: request lines carry the route template
(`"route":"/api/v1/admin/search"`), never the query string, and the principal's kind and id.

The app was stopped by its own PID afterwards.
