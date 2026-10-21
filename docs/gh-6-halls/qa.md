---
title: U5 — Manual QA of halls
owner: Mohamed Tarek
status: Passed — 2026-10-20
last_verified: 2026-10-20
tags: [qa, halls, layouts, seat-maps, publishing, admin]
---

# U5 — Manual QA of halls

Issue #6, spec [`spec.md`](spec.md). QA mode: `curl`. Environment: Node 22, local PostgreSQL 16,
this unit's own database `maqady_u5_dev` (schema dropped first, then migrated by the built app:
`npm run build`, then `node --enable-source-maps dist/cli/admin-create.js` and
`node --enable-source-maps dist/main.js`), port 3110, fresh secrets from
`openssl rand -base64 32`, `EMAIL_DRIVER=simulated`, `STORAGE_DRIVER=local`. Run on 2026-10-21
from 01:46 Cairo time (`+03:00`).

Setup:

- The admin came from `admin:create` (`BOOTSTRAP_ADMIN_*` set for that one run). The box-office
  member was inserted with `psql` as a copy of the admin row with `role = 'box_office'` (QA only).
  Both signed in through `POST /api/v1/admin/auth/sessions`.
- The script that ran every step is reproduced by the commands named in each `$` line: `curl`
  against `http://localhost:3110/api/v1` with `Authorization: Bearer <accessToken>` of the admin
  (the box office in the access section), `Content-Type: application/json`, and a fresh UUID as
  `Idempotency-Key` where shown. Responses are trimmed to the status line,
  `Idempotent-Replayed` when present, and the fields named in each step (jq filters).
- The theater was created through `POST /admin/theaters`, its hours and prices set through
  `PUT …/hours` and `PUT …/prices`.
- The showtime-dependent rules (`HALL_IN_USE`, the delete and retire blockers) need U7 and U10;
  their seams are covered by the integration suite's stand-ins (`test/support/halls-probe.module.ts`).
  With nothing registered here, every hall is deletable and retirable.

## Schema

```
$ psql: knex_migrations
0060_01_create_halls
0060_02_create_hall_rows
0060_03_create_hall_seat_marks

$ psql: relrowsecurity
halls|true  hall_rows|true  hall_seat_marks|true

$ psql: index comments (Knex writes the ? of a comment as $n, as for earlier units)
uq_halls_theater_id_name|Covers fk_halls_theater_id. Admin hall list: WHERE theater_id = $1 [AND status = $2] ORDER BY name, id with the cursor (name, id) > ($3, $4); halls of theaters (U7, U8): WHERE theater_id IN (...); the active_hall publish check: WHERE theater_id = $5 AND status = 'active'. Also keeps hall names unique per theater, case-insensitively.
uq_halls_id_theater_id|Target of the composite foreign key showtimes (hall_id, theater_id) (U7, design 6.3).
pk_hall_rows|Covers fk_hall_rows_hall_id. Rows of halls: WHERE hall_id IN (...) ORDER BY hall_id, row_index; the layout replace: DELETE ... WHERE hall_id = $1.
uq_hall_rows_hall_id_row_label|Target of fk_hall_seat_marks_hall_id_row_label, so a seat mark always sits in an existing row of its hall.
pk_hall_seat_marks|Covers fk_hall_seat_marks_hall_id_row_label. Marks of halls: WHERE hall_id IN (...) ORDER BY hall_id, row_label, seat_number.

$ psql (rolled back): the row label CHECK and the marks foreign key
INSERT INTO hall_rows VALUES (1, 8, 'J', 'back')   -> INSERT 0 1
INSERT INTO hall_rows VALUES (1, 9, 'I', 'back')   -> violates check constraint "chk_hall_rows_row_label"
INSERT INTO hall_seat_marks VALUES (1, 'K', 1, 'no_seat')
                                                   -> violates foreign key constraint "fk_hall_seat_marks_hall_id_row_label"
```

## The routes

### Theater

```
theater id 1
$ GET /admin/theaters/1
HTTP/1.1 200 OK
{"status":"draft","publishBlockers":["prices","hours","active_hall"]}
```

### Create a hall (POST, strict)

```
$ POST /admin/theaters/1/halls {name:'  Hall 1 '}
HTTP/1.1 201 Created
{"id":1,"theaterId":1,"name":"Hall 1","status":"draft","rowCount":12,"seatsPerRow":16,"seatCount":192,"wheelchairCount":0,"zoneSeatCounts":{"front":48,"middle":80,"back":64},"deletable":true,"createdAt":"2026-10-21T01:46:08+03:00","updatedAt":"2026-10-21T01:46:08+03:00"}
$ same key again (replay)
HTTP/1.1 201 Created
Idempotent-Replayed: true
{"id":1,"name":"Hall 1","status":"draft"}
$ no Idempotency-Key
HTTP/1.1 400 Bad Request
{"code":"IDEMPOTENCY_KEY_REQUIRED","details":null}
$ name taken in another case: HALL 1
HTTP/1.1 409 Conflict
{"code":"CONFLICT","details":{"constraint":"uq_halls_theater_id_name"}}
$ blank name
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"name","messages":["name must be longer than or equal to 1 characters"]}]}}
$ unknown theater 999
HTTP/1.1 404 Not Found
{"code":"NOT_FOUND"}
```

### Default layout

```
$ GET /admin/halls/1/layout
HTTP/1.1 200 OK
{"rowCount":12,"seatsPerRow":16,"aisleAfter":[4,12],"rows":"A:front B:front C:front D:middle E:middle F:middle G:middle H:middle J:back K:back L:back M:back","seatMarks":[],"seatCount":192,"zoneSeatCounts":{"front":48,"middle":80,"back":64}}
```

### Replace the layout (PUT)

```
$ PUT /admin/halls/1/layout 4 x 8, A1 wheelchair, D8 no seat
HTTP/1.1 200 OK
{"hallId":1,"rowCount":4,"seatsPerRow":8,"aisleAfter":[4],"rows":[{"label":"A","zone":"front"},{"label":"B","zone":"middle"},{"label":"C","zone":"middle"},{"label":"D","zone":"back"}],"seatMarks":[{"rowLabel":"A","seatNumber":1,"kind":"wheelchair"},{"rowLabel":"D","seatNumber":8,"kind":"no_seat"}],"seatCount":31,"wheelchairCount":1,"zoneSeatCounts":{"front":8,"middle":16,"back":7},"updatedAt":"2026-10-21T01:46:08+03:00"}
$ PUT 15 x 20
HTTP/1.1 200 OK
{"rowCount":15,"seatsPerRow":20,"aisleAfter":[4,16],"rows":"ABCDEFGHJKLMNOP","seatCount":300,"wheelchairCount":1,"zoneSeatCounts":{"front":100,"middle":100,"back":100}}
$ PUT 4 x 9, all back
HTTP/1.1 200 OK
{"aisleAfter":[4,5],"seatCount":36,"zoneSeatCounts":{"front":0,"middle":0,"back":36}}
$ PUT back to 4 x 8
HTTP/1.1 200 OK
{"rowCount":4,"seatsPerRow":8,"aisleAfter":[4],"seatCount":31,"wheelchairCount":1}
$ psql: stored rows and marks
4|8
A:front B:middle C:middle D:back
A1:wheelchair D8:no_seat
```

### Invalid layouts (stored layout unchanged)

```
$ mark in row E of a 4-row hall
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","fields":["seatMarks.0.rowLabel"]}
$ seat 9 in an 8-seat row
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","fields":["seatMarks.0.seatNumber"]}
$ 3 zones for 4 rows
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","fields":["rowZones"]}
$ front behind middle
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","fields":["rowZones.1"]}
$ B2 marked twice
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","fields":["seatMarks.1"]}
$ row I, seat 21, kind vip, 16 rows
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","fields":["rowCount","seatMarks.0.rowLabel","seatMarks.0.seatNumber","seatMarks.0.kind"]}
$ every cell a gap
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"seatMarks","messages":["a layout needs at least one seat; every cell is marked no_seat"]}]}}
$ unknown hall 999
HTTP/1.1 404 Not Found
{"code":"NOT_FOUND"}
$ GET layout after the refusals
HTTP/1.1 200 OK
{"rowCount":4,"seatsPerRow":8,"seatCount":31,"wheelchairCount":1}
```

### Publishing needs an active hall

```
(hours and prices set)
$ PATCH theater status active, hall 1 still draft
HTTP/1.1 409 Conflict
{"code":"THEATER_NOT_PUBLISHABLE","details":{"missing":["active_hall"]}}
$ GET theater
HTTP/1.1 200 OK
{"publishBlockers":["active_hall"]}
$ PATCH /admin/halls/1 {status: active}
HTTP/1.1 200 OK
{"name":"Hall 1","status":"active","updatedAt":"2026-10-21T01:46:08+03:00"}
$ PATCH theater status active
HTTP/1.1 200 OK
{"status":"active","publishBlockers":[]}
```

### Rename, status rules

```
$ PATCH {name: Hall One}
HTTP/1.1 200 OK
{"name":"Hall One","status":"active"}
$ PATCH {status: draft} on active
HTTP/1.1 409 Conflict
{"code":"CONFLICT","details":{"from":"active","to":"draft"}}
$ PATCH {}
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"name","messages":["send at least one field to change","name must be shorter than or equal to 40 characters","name must be a string"]}]}}
$ PATCH that changes nothing
HTTP/1.1 200 OK
{"name":"Hall One","status":"active"}
$ POST Hall 2
HTTP/1.1 201 Created
{"id":3,"name":"Hall 2","status":"draft"}
$ PATCH Hall 2 {status: retired} (draft to retired)
HTTP/1.1 200 OK
{"name":"Hall 2","status":"retired"}
$ PATCH Hall 2 {status: active} (retired is final)
HTTP/1.1 409 Conflict
{"code":"CONFLICT","details":{"from":"retired","to":"active"}}
$ PUT layout of retired Hall 2
HTTP/1.1 409 Conflict
{"code":"CONFLICT","details":{"status":"retired"}}
$ PATCH Hall 2 {name: Old Hall 2} (rename while retired)
HTTP/1.1 200 OK
{"name":"Old Hall 2","status":"retired"}
```

### List and get

```
(Hall 3, Hall 4, Hall 5 added)
$ GET /admin/theaters/1/halls?limit=2
HTTP/1.1 200 OK
{"total":5,"nextCursor":"WyJIYWxsIDQiLDVd","items":["Hall 3 draft 12x16 192 seats deletable=true","Hall 4 draft 12x16 192 seats deletable=true"]}
$ next page
HTTP/1.1 200 OK
{"total":5,"nextCursor":"WyJIYWxsIE9uZSIsMV0","items":["Hall 5","Hall One"]}
$ ?status=active
HTTP/1.1 200 OK
{"total":1,"items":["Hall One"]}
$ ?status=closed
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","fields":["status"]}
$ GET /admin/theaters/999/halls
HTTP/1.1 404 Not Found
{"code":"NOT_FOUND"}
$ GET /admin/halls/1
HTTP/1.1 200 OK
{"id":1,"theaterId":1,"name":"Hall One","status":"active","rowCount":4,"seatsPerRow":8,"seatCount":31,"wheelchairCount":1,"zoneSeatCounts":{"front":8,"middle":16,"back":7},"deletable":true,"createdAt":"2026-10-21T01:46:08+03:00","updatedAt":"2026-10-21T01:46:08+03:00"}
$ GET /admin/halls/abc
HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","fields":["id"]}
```

### Delete

```
$ DELETE /admin/halls/6
HTTP/1.1 204 No Content
$ psql: rows of deleted hall
0
$ DELETE again
HTTP/1.1 404 Not Found
{"code":"NOT_FOUND"}
```

### Box office and anonymous

```
GET /admin/theaters/1/halls box_office=FORBIDDEN anonymous=401
POST /admin/theaters/1/halls box_office=FORBIDDEN anonymous=401
GET /admin/halls/1 box_office=FORBIDDEN anonymous=401
PATCH /admin/halls/1 box_office=FORBIDDEN anonymous=401
DELETE /admin/halls/1 box_office=FORBIDDEN anonymous=401
GET /admin/halls/1/layout box_office=FORBIDDEN anonymous=401
PUT /admin/halls/1/layout box_office=FORBIDDEN anonymous=401
```

### Audit rows

```
hall.created|1|{}|{"theaterId": 1}
hall.layout_replaced|1|{}|{"rowCount": 4, "seatCount": 31, "seatsPerRow": 8, "wheelchairCount": 1}
hall.layout_replaced|1|{}|{"rowCount": 15, "seatCount": 300, "seatsPerRow": 20, "wheelchairCount": 1}
hall.layout_replaced|1|{}|{"rowCount": 4, "seatCount": 36, "seatsPerRow": 9, "wheelchairCount": 0}
hall.layout_replaced|1|{}|{"rowCount": 4, "seatCount": 31, "seatsPerRow": 8, "wheelchairCount": 1}
hall.activated|1|{}|{"to": "active", "from": "draft"}
hall.updated|1|{name}|{}
hall.created|3|{}|{"theaterId": 1}
hall.retired|3|{}|{"to": "retired", "from": "draft"}
hall.updated|3|{name}|{}
hall.created|4|{}|{"theaterId": 1}
hall.created|5|{}|{"theaterId": 1}
hall.created|6|{}|{"theaterId": 1}
hall.deleted|6|{}|{"theaterId": 1}
```

## Log hygiene

```
$ grep -c 'Hall One\|qa.maqady.local\|Maqady QA' app.log
0
$ one request line
{"level":"info","correlationId":"8eabd36e-…","method":"POST","route":"/api/v1/admin/theaters/:id/halls","statusCode":201,"responseTime":20,"principalKind":"staff","principalId":1,"msg":"request completed"}
$ the name clash, logged by SQLSTATE and constraint only
{"level":"warn","context":"GlobalExceptionFilter","code":"CONFLICT","err":{"type":"DatabaseError","code":"23505","constraint":"uq_halls_theater_id_name",…}}
```

## Result

Every route of the unit answered as the spec says: creation with the 12 × 16 default and its
replay, the case-insensitive name rule, layouts from 4 × 8 to 15 × 20 with `aisleAfter`
`[4]`, `[4, 5]` and `[4, 16]`, every validation refusal leaving the stored layout as it was,
`active_hall` refusing and then allowing the publish, the status rules, paging, delete, and
`FORBIDDEN` / `401` on all seven routes for a box-office token and for none. Audit rows hold
field names and counts only, and the log holds no names or emails.
