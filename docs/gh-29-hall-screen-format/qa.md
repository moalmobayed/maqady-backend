---
title: "#29 P4 — Hall screen size and projection format: manual QA"
owner: Mohamed Tarek
status: Done
last_verified: 2026-11-13
tags: [qa, halls, discovery, showtimes, curl]
---

# #29 P4 — Hall screen size and projection format: manual QA

QA mode `curl` (CLAUDE.md). Evidence for every changed route of
`docs/gh-29-hall-screen-format/spec.md`, on the real app against a real Postgres.

## Setup

- Worktree build of the branch (`npm run build`), database `maqady_p4_dev` (local Postgres 16).
- `npm run seed` (dataset `demo`) migrated the database through `0290_31` and seeded it:

  ```text
  Dataset: demo
  theaters: 6 created, 0 already there
  halls: 5 created, 0 already there
  publish-theaters: 5 created, 0 already there
  ...
  showtimes: 129 created, 0 already there
  ```

- App started with `node --enable-source-maps dist/main.js` on `PORT=3133`, then
  `GET /api/v1/health` → `{"status":"ok"}`.
- Admin token: `POST /api/v1/admin/auth/sessions` as `seed-admin@maqady.local`.
- Shell helpers: `B=http://localhost:3133/api/v1`, `A="Authorization: Bearer $TOKEN"`,
  `J='Content-Type: application/json'`. Responses are trimmed to the fields that matter.

Theater 2 is "Maqady Downtown"; hall 2 is its seeded "Hall 1".

## 1. The migration gives every existing hall `standard`, with no screen

```console
$ psql -d maqady_p4_dev -At -c "select format, count(*), count(screen_width_cm) from maqady.halls group by format"
standard|5|0
$ psql ... "select column_name, column_default, is_nullable from information_schema.columns
            where table_schema='maqady' and table_name='halls'
              and column_name in ('format','screen_width_cm','screen_height_cm') order by column_name"
format|'standard'::character varying|NO
screen_height_cm||YES
screen_width_cm||YES
```

The seed (a `halls: string[]` dataset) still created its halls unchanged:

```console
$ curl -s "$B/admin/theaters/2/halls" -H "$A"
{"items":[{"id":2,"theaterId":2,"name":"Hall 1","status":"active","format":"standard",
  "screenWidthMeters":null,"screenHeightMeters":null,"rowCount":12,"seatsPerRow":16, ...}],
 "nextCursor":null,"total":1}
```

## 2. `PATCH /admin/halls/{id}`: format and screen in metres, stored in centimetres

```console
$ curl -s -X PATCH $B/admin/halls/2 -H "$A" -H "$J" \
    -d '{"format":"dolby_atmos","screenWidthMeters":22.1,"screenHeightMeters":12.3}'
{"id":2,"theaterId":2,"name":"Hall 1","status":"active","format":"dolby_atmos",
 "screenWidthMeters":22.1,"screenHeightMeters":12.3,"rowCount":12,"seatsPerRow":16,
 "seatCount":192, ... ,"updatedAt":"2026-11-13T19:38:48+02:00"}
HTTP 200
$ psql ... "select format, screen_width_cm, screen_height_cm from maqady.halls where id=2"
dolby_atmos|2210|1230
```

## 3. `GET /admin/halls/{id}` returns them

```console
$ curl -s $B/admin/halls/2 -H "$A"
{"id": 2, "name": "Hall 1", "format": "dolby_atmos", "screenWidthMeters": 22.1, "screenHeightMeters": 12.3, ...}
```

## 4. `POST /admin/theaters/{id}/halls` with a format and screen

```console
$ curl -s -X POST $B/admin/theaters/2/halls -H "$A" -H "$J" -H "Idempotency-Key: <uuid>" \
    -d '{"name":"VIP Lounge","format":"vip","screenWidthMeters":18.5,"screenHeightMeters":7.75}'
{"id": 6, "name": "VIP Lounge", "status": "draft", "format": "vip", "screenWidthMeters": 18.5, "screenHeightMeters": 7.75, ...}
HTTP 201
$ curl -s -X PATCH $B/admin/halls/6 -H "$A" -H "$J" -d '{"status":"active"}'
HTTP 200
$ psql ... "select format, screen_width_cm, screen_height_cm from maqady.halls where id=6"
vip|1850|775
```

## 5. Refusals: `400 VALIDATION_FAILED` on the right field, nothing written

```console
PATCH /admin/halls/2 {"screenWidthMeters":20}
400 VALIDATION_FAILED [{"field": "screenHeightMeters", "messages": ["screenHeightMeters is required with screenWidthMeters"]}]
PATCH {"screenWidthMeters":20,"screenHeightMeters":null}
400 VALIDATION_FAILED [{"field": "screenHeightMeters", "messages": ["screenHeightMeters can be null only when screenWidthMeters is null too"]}]
PATCH {"screenWidthMeters":0.5,"screenHeightMeters":9}
400 VALIDATION_FAILED [{"field": "screenWidthMeters", "messages": ["screenWidthMeters must be a number of metres from 1 to 50 with at most 2 decimals"]}]
PATCH {"screenWidthMeters":18.123,"screenHeightMeters":9}
400 VALIDATION_FAILED [{"field": "screenWidthMeters", "messages": ["screenWidthMeters must be a number of metres from 1 to 50 with at most 2 decimals"]}]
PATCH {"screenWidthMeters":"18","screenHeightMeters":9}
400 VALIDATION_FAILED [{"field": "screenWidthMeters", "messages": ["screenWidthMeters must be a number of metres from 1 to 50 with at most 2 decimals"]}]
PATCH {"format":"IMAX"}
400 VALIDATION_FAILED [{"field": "format", "messages": ["format must be one of the following values: standard, vip, imax, dolby_atmos, 4dx, screenx, max"]}]
PATCH {"format":"3d"}
400 VALIDATION_FAILED [{"field": "format", "messages": ["format must be one of the following values: ..."]}]
PATCH {"format":null}
400 VALIDATION_FAILED [{"field": "format", "messages": ["format must be one of the following values: ..."]}]
PATCH {}
400 VALIDATION_FAILED [{"field": "name", "messages": ["send at least one field to change", ...]}]
$ psql ... "select format, screen_width_cm, screen_height_cm from maqady.halls where id=2"
dolby_atmos|2210|1230
```

## 6. Audit rows: field names, never values

```console
$ psql ... "select action, entity_id, changed_fields, metadata from maqady.audit_events
            where entity_type='hall' and entity_id in (2, 6) order by id"
hall.created|2|{}|{"theaterId": 2}
hall.activated|2|{}|{"to": "active", "from": "draft"}
hall.updated|2|{format,screenHeightMeters,screenWidthMeters}|{}
hall.created|6|{}|{"theaterId": 2}
hall.activated|6|{}|{"to": "active", "from": "draft"}
```

## 7. `GET /theaters/{id}`: halls with `format` and `screen`

```console
$ curl -s $B/theaters/2
"halls": [{"id": 2, "name": "Hall 1", "seatCount": 192, "wheelchairCount": 0, "format": "dolby_atmos", "screen": {"widthMeters": 22.1, "heightMeters": 12.3}},
          {"id": 6, "name": "VIP Lounge", "seatCount": 192, "wheelchairCount": 0, "format": "vip", "screen": {"widthMeters": 18.5, "heightMeters": 7.75}}]
"hallCount": 2
```

## 8. A showtime in the VIP hall

```console
$ curl -s -X POST $B/admin/showtimes -H "$A" -H "$J" -H "Idempotency-Key: <uuid>" \
    -d '{"movieId":1,"hallId":6,"dates":["2026-11-14"],"startTime":"19:00","skipUnavailable":false}'
201 created 1 ['created']
```

## 9. `GET /movies/{id}/showtimes`: chip formats and each theater-day's `formats`

Per day and theater: `formats`, then each chip as (start, hall, format). Downtown on the 14th
has a Dolby Atmos and a VIP showtime, listed in the format order (VIP before Dolby Atmos); the
other days and theaters have one format each.

```console
$ curl -s $B/movies/1/showtimes
2026-11-13 Maqady Sheikh Zayed formats= ['standard'] chips= [('21:45', 'Hall 1', 'standard')]
2026-11-14 Maqady Downtown formats= ['vip', 'dolby_atmos'] chips= [('16:15', 'Hall 1', 'dolby_atmos'), ('19:00', 'VIP Lounge', 'vip')]
2026-11-14 Maqady Heliopolis formats= ['standard'] chips= [('19:00', 'Hall 1', 'standard')]
2026-11-14 Maqady Sheikh Zayed formats= ['standard'] chips= [('21:45', 'Hall 1', 'standard')]
2026-11-14 Maqady Zamalek formats= ['standard'] chips= [('13:30', 'Hall 1', 'standard')]
2026-11-15 Maqady Downtown formats= ['dolby_atmos'] chips= [('16:15', 'Hall 1', 'dolby_atmos')]
...
Cache-Control: public, max-age=60
```

## 10. `GET /theaters/{id}/showtimes`: every chip carries its hall's format

```console
$ curl -s "$B/theaters/2/showtimes?date=2026-11-14"
2026-11-14 Khan el-Khalili Blues [('13:30', 'Hall 1', 'dolby_atmos')]
2026-11-14 The Last Lighthouse [('16:15', 'Hall 1', 'dolby_atmos'), ('19:00', 'VIP Lounge', 'vip')]
2026-11-14 Red Sea Rising [('19:00', 'Hall 1', 'dolby_atmos')]
2026-11-14 Garden City Romance [('21:45', 'Hall 1', 'dolby_atmos')]
```

One chip in full (`PublicShowtime`):

```json
{"id": 26, "startsAt": "2026-11-14T13:30:00+02:00", "endsAt": "2026-11-14T15:11:00+02:00",
 "cinemaDate": "2026-11-14", "hall": {"id": 2, "name": "Hall 1"}, "format": "dolby_atmos",
 "prices": {"front": {"amount": 15000, "currency": "EGP"}, "middle": {"amount": 19000, "currency": "EGP"},
            "back": {"amount": 23000, "currency": "EGP"}},
 "fromPrice": {"amount": 15000, "currency": "EGP"}, "hasStarted": false}
```

The showtimes seeded before the change show the hall's new format (it is read from the hall),
and their prices did not change.

## 11. Both sides null clears the screen

```console
$ curl -s -X PATCH $B/admin/halls/6 -H "$A" -H "$J" -d '{"screenWidthMeters":null,"screenHeightMeters":null}'
{'id': 6, 'format': 'vip', 'screenWidthMeters': None, 'screenHeightMeters': None}
$ curl -s $B/theaters/2
[('Hall 1', 'dolby_atmos', {'widthMeters': 22.1, 'heightMeters': 12.3}), ('VIP Lounge', 'vip', None)]
$ psql ... "select action, changed_fields from maqady.audit_events where entity_type='hall' and entity_id=6 order by id desc limit 1"
hall.updated|{screenHeightMeters,screenWidthMeters}
```

## 12. Log hygiene

The app log (241 lines) holds request lines with the route template, status and principal id
only; no request body, format, screen size, token or email appears in it (`grep` for the values
sent matched only timestamps).

## Result

Every changed route behaves as the spec says: the admin fields round-trip metres through
centimetres, refusals name the right field and write nothing, the audit names fields only, and
the theater page halls and both public showtime lists carry the hall format (and the halls their
screen), with each theater-day's formats on the movie matrix.
