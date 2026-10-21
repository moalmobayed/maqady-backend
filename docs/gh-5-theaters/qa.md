---
title: U4b — Manual QA of theaters
owner: Mohamed Tarek
status: Passed — 2026-10-20
last_verified: 2026-10-20
tags: [qa, theaters, opening-hours, special-dates, photos, publishing, admin]
---

# U4b — Manual QA of theaters

Issue #5, spec [`spec.md`](spec.md). QA mode: `curl`. Environment: Node 22, local PostgreSQL 16,
this unit's own database `maqady_u4b_dev` (schema dropped first, then migrated at boot by the
built app: `npm run build`, `node --enable-source-maps dist/main.js`), port 3107, fresh secrets
from `openssl rand -base64 32`, `EMAIL_DRIVER=simulated`, `STORAGE_DRIVER=local` with
`LOCAL_STORAGE_DIR=.media`. Run on 2026-10-20 from 22:53 Cairo time (`+03:00`, summer time), so
today's cinema date is Tuesday 2026-10-20.

Setup:

- The admin came from `npm run admin:create` (`BOOTSTRAP_ADMIN_*` set for that one run). Staff
  invites are U2b's, so the box-office member was inserted with `psql` as a copy of the admin row
  with `role = 'box_office'` (QA only). Both signed in through `POST /api/v1/admin/auth/sessions`;
  `$ADMIN` and `$BOX` below are `Authorization: Bearer <accessToken>` of each.
- Fixtures generated with sharp: `cover.png` 1920 × 1080, `square.jpg` 1000 × 1000,
  `lobby.jpg` 800 × 600.
- `$B` is `http://localhost:3107/api/v1/admin/theaters`; `-H json` stands for
  `-H 'Content-Type: application/json'`; `<new uuid>` is a fresh UUID per request, and a replay
  sends the UUID of the call before it again. Photos go as `multipart/form-data` (`-F`). Responses are trimmed to the status line, `Idempotent-Replayed` when
  present, and the fields named in each step (jq filters). U5 has not registered `active_hall`,
  so publishing needs prices and hours only here; the hall rule is covered by the integration
  suite's stand-in.

## Boot and schema

```
"msg":"Applied migration 0055_01_create_theaters"
"msg":"Applied migration 0055_02_create_theater_phones"
"msg":"Applied migration 0055_03_create_theater_facilities"
"msg":"Applied migration 0055_04_create_theater_photos"
"msg":"Applied migration 0055_05_create_theater_hours"
"msg":"Applied migration 0055_06_create_theater_special_dates"
"msg":"Applied migration 0055_07_add_images_created_by_staff_fk"
"msg":"Listening on port 3107"

$ psql: relrowsecurity of the theater tables
theaters|t  theater_phones|t  theater_facilities|t  theater_photos|t  theater_hours|t  theater_special_dates|t

$ psql: index comments (Knex writes the ? of a comment as $1, as for earlier units)
uq_theaters_name|Admin theater list without a status filter: ORDER BY name, id with the cursor (name, id) > ($1, $2). Also keeps names unique, case-insensitively.
idx_theaters_status_name|Admin theater list with a status filter, and the active theaters (U8): WHERE status = $1 ORDER BY name, id.
uq_theaters_cover_image_id|Covers fk_theaters_cover_image_id, so deleting an image checks theaters by index. Also keeps an image the cover of one theater at most.
uq_theater_phones_theater_id_sort_order|Phones of theaters: WHERE theater_id IN (...) ORDER BY theater_id, sort_order. Covers fk_theater_phones_theater_id.
pk_theater_facilities|Facilities of theaters: WHERE theater_id IN (...). Covers fk_theater_facilities_theater_id.
idx_theater_photos_theater_id_sort_order|Gallery of theaters: WHERE theater_id IN (...) ORDER BY theater_id, sort_order, id. Covers fk_theater_photos_theater_id.
uq_theater_photos_image_id|Covers fk_theater_photos_image_id, so deleting an image checks photos by index. Also keeps an image in one photo at most.
pk_theater_hours|Weekly hours of theaters: WHERE theater_id IN (...); the upsert of PUT hours ON CONFLICT (theater_id, weekday). Covers fk_theater_hours_theater_id.
uq_theater_special_dates_theater_id_cinema_date|Special dates of theaters in a date range: WHERE theater_id IN (...) AND cinema_date BETWEEN $1 AND $2 (equality, then range). Covers fk_theater_special_dates_theater_id; one per theater and date.
```

## The routes

### 1. POST create (strict): no key, then with a key, then the same key again (replay)

```
$ curl -X POST $B -H $ADMIN -H json -d '{"name":" Maqady Zamalek ","address":"26 July Street","district":"Zamalek","city":"Cairo","latitude":30.0609,"longitude":31.2197,"email":"zamalek@maqady.example"}'
< HTTP/1.1 400 Bad Request
"IDEMPOTENCY_KEY_REQUIRED"
$ curl -X POST $B -H $ADMIN -H json -H 'Idempotency-Key: <new uuid>' -d '{"name":" Maqady Zamalek ","address":"26 July Street","district":"Zamalek","city":"Cairo","latitude":30.0609,"longitude":31.2197,"email":"zamalek@maqady.example"}'
< HTTP/1.1 201 Created
{"id":1,"name":"Maqady Zamalek","status":"draft","email":"zamalek@maqady.example","showContactsPublic":false,"defaultPrices":null,"hours":[],"openState":{"isOpen":false,"closesAt":null,"nextOpensAt":null},"publishBlockers":["prices","hours"],"createdAt":"2026-10-20T22:53:42+03:00"}
$ curl -X POST $B -H $ADMIN -H json -H 'Idempotency-Key: <the same uuid as the call before>' -d '{"name":" Maqady Zamalek ","address":"26 July Street","district":"Zamalek","city":"Cairo","latitude":30.0609,"longitude":31.2197,"email":"zamalek@maqady.example"}'
< HTTP/1.1 201 Created · Idempotent-Replayed: true
{"id":1,"name":"Maqady Zamalek"}
theater id 1
```

### 2. POST create: duplicate name in another case, bad coordinates

```
$ curl -X POST $B -H $ADMIN -H json -H 'Idempotency-Key: <new uuid>' -d '{"name":"MAQADY zamalek","address":"x","district":"x","city":"Cairo","latitude":30,"longitude":31}'
< HTTP/1.1 409 Conflict
{"code":"CONFLICT","details":{"constraint":"uq_theaters_name"}}
$ curl -X POST $B -H $ADMIN -H json -H 'Idempotency-Key: <new uuid>' -d '{"name":"Maqady Maadi","address":"x","district":"Maadi","city":"Cairo","latitude":95,"longitude":31.1234567}'
< HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"latitude","messages":["latitude must not be greater than 90"]},{"field":"longitude","messages":["longitude must be a number conforming to the specified constraints"]}]}}
```

### 3. PATCH fields, then publish refused while prices and hours are missing

```
$ curl -X PATCH $B/1 -H $ADMIN -H json -d '{"parkingInfo":"Valet at the main entrance","district":"Zamalek "}'
< HTTP/1.1 200 OK
{"district":"Zamalek","parkingInfo":"Valet at the main entrance","updatedAt":"2026-10-20T22:53:42+03:00"}
$ curl -X PATCH $B/1 -H $ADMIN -H json -d '{"status":"active"}'
< HTTP/1.1 409 Conflict
{"code":"THEATER_NOT_PUBLISHABLE","details":{"missing":["prices","hours"]}}
$ curl -X PATCH $B/1 -H $ADMIN -H json -d '{"status":"sales_paused"}'
< HTTP/1.1 409 Conflict
{"code":"CONFLICT","details":{"from":"draft","to":"sales_paused"}}
```

### 4. PUT prices, PUT hours (invalid, all closed, then 12:00 to 01:00 with a late Friday)

```
$ curl -X PUT $B/1/prices -H $ADMIN -H json -d '{"front":{"amount":15000,"currency":"EGP"},"middle":{"amount":19000,"currency":"EGP"},"back":{"amount":23000,"currency":"EGP"}}'
< HTTP/1.1 200 OK
{"front":{"amount":15000,"currency":"EGP"},"middle":{"amount":19000,"currency":"EGP"},"back":{"amount":23000,"currency":"EGP"}}
$ curl -X PUT $B/1/prices -H $ADMIN -H json -d '{"front":{"amount":0,"currency":"EGP"},"middle":{"amount":150.5,"currency":"EGP"}}'
< HTTP/1.1 400 Bad Request
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"front.amount","messages":["amount must not be less than 1"]},{"field":"middle.amount","messages":["amount must be an integer number"]},{"field":"back","messages":["back should not be null or undefined","back must be in the currency of front","back must be an object"]}]}}
$ curl -X PUT $B/1/hours -H $ADMIN -H json -d '{"days":[{"weekday":1,"closed":true,"opens":"12:00"},{"weekday":2,"closed":false,"opens":"05:00","closes":"12:00"},{"weekday":3,"closed":false,"opens":"12:00","closes":"11:00"},{"weekday":4,"closed":false},{"weekday":5,"closed":true},{"weekday":6,"closed":true},{"weekday":7,"closed":true}]}'
< HTTP/1.1 400 Bad Request
[{"field":"days.0.opens","messages":["leave out opens and closes on a closed day"]},{"field":"days.1.opens","messages":["opens must be a time from 06:00 to 23:59, written HH:mm"]},{"field":"days.2.closes","messages":["closes must be after opens, written HH:mm; a closing at or before 06:00 is the next day"]},{"field":"days.3.opens","messages":["opens and closes are required on an open day"]},{"field":"days.3.closes","messages":["opens and closes are required on an open day"]}]
$ curl -X PUT $B/1/hours -H $ADMIN -H json -d '{"days":[{"weekday":1,"closed":true},{"weekday":2,"closed":true},{"weekday":3,"closed":true},{"weekday":4,"closed":true},{"weekday":5,"closed":true},{"weekday":6,"closed":true},{"weekday":7,"closed":true}]}'
< HTTP/1.1 200 OK
{"hours":7,"publishBlockers":["hours"]}
$ curl -X PUT $B/1/hours -H $ADMIN -H json -d '{"days":[{"weekday":1,"closed":false,"opens":"12:00","closes":"01:00"},{"weekday":2,"closed":false,"opens":"12:00","closes":"01:00"},{"weekday":3,"closed":false,"opens":"12:00","closes":"01:00"},{"weekday":4,"closed":false,"opens":"12:00","closes":"01:00"},{"weekday":5,"closed":false,"opens":"12:00","closes":"03:00"},{"weekday":6,"closed":false,"opens":"10:00","closes":"02:00"},{"weekday":7,"closed":true}]}'
< HTTP/1.1 200 OK
{"hours":["1 12:00-01:00+1","2 12:00-01:00+1","3 12:00-01:00+1","4 12:00-01:00+1","5 12:00-03:00+1","6 10:00-02:00+1","7 null-null"],"openState":{"isOpen":true,"closesAt":"2026-10-21T01:00:00+03:00","nextOpensAt":null},"publishBlockers":[]}
```

### 5. PUT phones and facilities

```
$ curl -X PUT $B/1/phones -H $ADMIN -H json -d '{"phones":[{"label":"Box office","number":"+20227351100"},{"label":" Cinema manager ","number":"+201009876543"}]}'
< HTTP/1.1 200 OK
[{"label":"Box office","number":"+20227351100"},{"label":"Cinema manager","number":"+201009876543"}]
$ curl -X PUT $B/1/phones -H $ADMIN -H json -d '{"phones":[{"label":"Main","number":"0227351100"}]}'
< HTTP/1.1 400 Bad Request
[{"field":"phones.0.number","messages":["number must be in E.164 format, such as +20227351100"]}]
$ curl -X PUT $B/1/facilities -H $ADMIN -H json -d '{"facilities":["valet_parking","cafe_bar","wheelchair_access"]}'
< HTTP/1.1 200 OK
["wheelchair_access","valet_parking","cafe_bar"]
$ curl -X PUT $B/1/facilities -H $ADMIN -H json -d '{"facilities":["imax","cafe_bar","cafe_bar"]}'
< HTTP/1.1 400 Bad Request
[{"field":"facilities","messages":["each value in facilities must be one of the following values: wheelchair_access, free_parking, valet_parking, street_parking, cafe_bar, food_court, kids_room","All facilities's elements must be unique"]}]
```

### 6. Special dates: create (no key, past date, valid, duplicate), patch, delete

```
$ curl -X POST $B/1/special-dates -H $ADMIN -H json -d '{"cinemaDate":"2026-10-25","label":"Holiday","closed":true}'
< HTTP/1.1 400 Bad Request
"IDEMPOTENCY_KEY_REQUIRED"
$ curl -X POST $B/1/special-dates -H $ADMIN -H json -H 'Idempotency-Key: <new uuid>' -d '{"cinemaDate":"2026-10-19","label":"Yesterday","closed":true}'
< HTTP/1.1 400 Bad Request
{"fields":[{"field":"cinemaDate","messages":["cinemaDate must be today's cinema date or later"]}]}
$ curl -X POST $B/1/special-dates -H $ADMIN -H json -H 'Idempotency-Key: <new uuid>' -d '{"cinemaDate":"2026-10-21","label":"Armed Forces Day","closed":false,"opens":"10:00","closes":"03:00"}'
< HTTP/1.1 201 Created
{"id":1,"cinemaDate":"2026-10-21","label":"Armed Forces Day","closed":false,"opens":"10:00","closes":"03:00","closesNextDay":true}
$ curl -X POST $B/1/special-dates -H $ADMIN -H json -H 'Idempotency-Key: <new uuid>' -d '{"cinemaDate":"2026-10-21","label":"Again","closed":true}'
< HTTP/1.1 409 Conflict
{"code":"CONFLICT","details":{"constraint":"uq_theater_special_dates_theater_id_cinema_date"}}
$ curl -X PATCH $B/1/special-dates/1 -H $ADMIN -H json -d '{"closes":"04:00"}'
< HTTP/1.1 200 OK
{"id":1,"cinemaDate":"2026-10-21","label":"Armed Forces Day","closed":false,"opens":"10:00","closes":"04:00","closesNextDay":true}
$ curl -X PATCH $B/1/special-dates/1 -H $ADMIN -H json -d '{"closed":true,"opens":"11:00"}'
< HTTP/1.1 400 Bad Request
[{"field":"opens","messages":["leave out opens and closes on a closed day"]}]
$ curl -X POST $B/1/special-dates -H $ADMIN -H json -H 'Idempotency-Key: <new uuid>' -d '{"cinemaDate":"2026-12-31","label":"New Year's Eve","closed":true}'
< HTTP/1.1 201 Created
{"id":3,"cinemaDate":"2026-12-31","label":"New Year's Eve","closed":true,"opens":null,"closes":null,"closesNextDay":false}
$ curl -X DELETE $B/1/special-dates/3 -H $ADMIN
< HTTP/1.1 204 No Content
$ curl -X DELETE $B/1/special-dates/3 -H $ADMIN
< HTTP/1.1 404 Not Found
"NOT_FOUND"
```

### 7. Photos: cover (PNG 1920x1080), square cover refused, gallery with caption, caption on a cover, replay

```
$ curl -X POST $B/1/photos -H $ADMIN -H 'Idempotency-Key: <new uuid>' -F usage=cover -F file=@cover.png
< HTTP/1.1 201 Created
{"cover":{"alt":"Maqady Zamalek","variants":["small 640x360","medium 1280x720","large 1920x1080"],"small":"http://localhost:3107/media/backdrop/5987b897-ca31-41c2-9fc5-c6624441552a/small.webp"}}
$ curl -X POST $B/1/photos -H $ADMIN -H 'Idempotency-Key: <new uuid>' -F usage=cover -F file=@square.jpg
< HTTP/1.1 422 Unprocessable Entity
{"code":"IMAGE_WRONG_SHAPE","details":{"kind":"backdrop","aspect":"16:9","minWidth":1280,"minHeight":720,"width":1000,"height":1000}}
$ curl -X POST $B/1/photos -H $ADMIN -H 'Idempotency-Key: <new uuid>' -F usage=gallery -F 'caption=The lobby' -F file=@lobby.jpg
< HTTP/1.1 201 Created
{"photos":[{"id":1,"caption":"The lobby","position":0,"alt":"The lobby","sizes":["480x360","800x600","800x600"]}]}
$ curl -X POST $B/1/photos -H $ADMIN -H 'Idempotency-Key: <the same uuid as the call before>' -F usage=gallery -F 'caption=The lobby' -F file=@lobby.jpg
< HTTP/1.1 201 Created · Idempotent-Replayed: true
{"photos":[1]}
$ curl -X POST $B/1/photos -H $ADMIN -H 'Idempotency-Key: <new uuid>' -F usage=cover -F caption=Front -F file=@cover.png
< HTTP/1.1 400 Bad Request
{"fields":[{"field":"caption","messages":["caption is for gallery photos only; a cover has none"]}]}
$ curl -X POST $B/1/photos -H $ADMIN -H 'Idempotency-Key: <new uuid>' -F usage=gallery -F file=@lobby.jpg
< HTTP/1.1 201 Created
{"photos":[1,2]}
$ curl -X POST $B/999/photos -H $ADMIN -H 'Idempotency-Key: <new uuid>' -F usage=gallery -F file=@lobby.jpg
< HTTP/1.1 404 Not Found
"NOT_FOUND"
$ curl -s -o /dev/null -w '%{http_code} %{content_type}' http://localhost:3107/media/backdrop/5987b897-ca31-41c2-9fc5-c6624441552a/small.webp
200 image/webp
```

### 8. PATCH a photo (move to first, drop caption), DELETE a photo, DELETE the cover

```
$ curl -X PATCH $B/1/photos/2 -H $ADMIN -H json -d '{"position":0}'
< HTTP/1.1 200 OK
{"photos":[{"id":2,"caption":null,"position":0,"alt":"Maqady Zamalek"},{"id":1,"caption":"The lobby","position":1,"alt":"The lobby"}]}
$ curl -X PATCH $B/1/photos/1 -H $ADMIN -H json -d '{"caption":null}'
< HTTP/1.1 200 OK
{"photos":[{"id":2,"caption":null,"position":0},{"id":1,"caption":null,"position":1}]}
$ curl -X DELETE $B/1/photos/1 -H $ADMIN
< HTTP/1.1 204 No Content
$ curl -X DELETE $B/1/cover -H $ADMIN
< HTTP/1.1 204 No Content
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:3107/media/backdrop/5987b897-ca31-41c2-9fc5-c6624441552a/small.webp
404
$ find .media -type f | wc -l
3
```

### 9. GET the theater

```
$ curl $B/1 -H $ADMIN
< HTTP/1.1 200 OK
{"status":"draft","phones":[{"label":"Box office","number":"+20227351100"},{"label":"Cinema manager","number":"+201009876543"}],"facilities":["wheelchair_access","valet_parking","cafe_bar"],"hours":7,"specialDates":[{"id":1,"cinemaDate":"2026-10-21","label":"Armed Forces Day","closed":false,"opens":"10:00","closes":"04:00","closesNextDay":true}],"cover":null,"photos":[{"id":2,"position":0}],"openState":{"isOpen":true,"closesAt":"2026-10-21T01:00:00+03:00","nextOpensAt":null},"publishBlockers":[]}
$ curl $B/999 -H $ADMIN
< HTTP/1.1 404 Not Found
"NOT_FOUND"
$ curl $B/abc -H $ADMIN
< HTTP/1.1 400 Bad Request
{"fields":[{"field":"id","messages":["id must not be greater than 9007199254740991","id must not be less than 1","id must be an integer number"]}]}
```

### 10. Publish (no hall rule registered until U5), pause, resume, back to draft refused, delete refused

```
$ curl -X PATCH $B/1 -H $ADMIN -H json -d '{"status":"active"}'
< HTTP/1.1 200 OK
{"status":"active","publishBlockers":[]}
$ curl -X PATCH $B/1 -H $ADMIN -H json -d '{"status":"sales_paused"}'
< HTTP/1.1 200 OK
{"status":"sales_paused"}
$ curl -X PATCH $B/1 -H $ADMIN -H json -d '{"status":"active"}'
< HTTP/1.1 200 OK
{"status":"active"}
$ curl -X PATCH $B/1 -H $ADMIN -H json -d '{"status":"draft"}'
< HTTP/1.1 409 Conflict
{"code":"CONFLICT","details":{"from":"active","to":"draft"}}
$ curl -X PATCH $B/1 -H $ADMIN -H json -d '{"status":"active","city":"Cairo"}'
< HTTP/1.1 200 OK
{"status":"active","updatedAt":"2026-10-20T22:53:44+03:00"}
$ curl -X DELETE $B/1 -H $ADMIN
< HTTP/1.1 409 Conflict
{"code":"THEATER_NOT_DELETABLE","details":{"reasons":["not_draft"]}}
```

### 11. A second theater, the list, a draft deleted

```
$ curl -X POST $B -H $ADMIN -H json -H 'Idempotency-Key: <new uuid>' -d '{"name":"Maqady Maadi","address":"Road 9","district":"Maadi","city":"Cairo","latitude":29.9602,"longitude":31.2569}'
< HTTP/1.1 201 Created
{"id":3,"status":"draft"}
$ curl '$B?limit=1' -H $ADMIN
< HTTP/1.1 200 OK
{"total":2,"nextCursor":"WyJNYXFhZHkgTWFhZGkiLDNd","items":[{"id":3,"name":"Maqady Maadi","status":"draft","mainPhone":null,"openState":{"isOpen":false,"closesAt":null,"nextOpensAt":null},"today":{"cinemaDate":"2026-10-20","closed":true,"opens":null,"closes":null,"closesNextDay":false,"specialDateLabel":null}}]}
$ curl '$B?limit=1&cursor=WyJNYXFhZHkgTWFhZGkiLDNd' -H $ADMIN
< HTTP/1.1 200 OK
{"total":2,"nextCursor":null,"items":[{"id":1,"name":"Maqady Zamalek","status":"active"}]}
$ curl '$B?status=draft' -H $ADMIN
< HTTP/1.1 200 OK
{"total":1,"items":["Maqady Maadi"]}
$ curl '$B?status=closed' -H $ADMIN
< HTTP/1.1 400 Bad Request
{"fields":[{"field":"status","messages":["status must be one of the following values: draft, active, sales_paused"]}]}
$ curl -X DELETE $B/3 -H $ADMIN
< HTTP/1.1 204 No Content
```

### 12. Access: box office and no token

```
$ curl $B -H $BOX
< HTTP/1.1 403 Forbidden
"FORBIDDEN"
$ curl -X POST $B -H $BOX -H json -H 'Idempotency-Key: <new uuid>' -d '{}'
< HTTP/1.1 403 Forbidden
"FORBIDDEN"
$ curl -X PUT $B/1/hours -H $BOX -H json -d '{}'
< HTTP/1.1 403 Forbidden
"FORBIDDEN"
$ curl -X POST $B/1/photos -H $BOX -H 'Idempotency-Key: <new uuid>' -F usage=gallery -F file=@lobby.jpg
< HTTP/1.1 403 Forbidden
"FORBIDDEN"
$ curl -X DELETE $B/1/cover -H $BOX
< HTTP/1.1 403 Forbidden
"FORBIDDEN"
$ curl $B/1
< HTTP/1.1 401 Unauthorized
"UNAUTHENTICATED"
```

Notes on what the output shows:

- Step 1: the name was trimmed; a retry with the same key replayed the stored `201`.
- Step 3: `"district": "Zamalek "` is trimmed to the stored value, so only `parkingInfo` changed
  (and only it is in the audit row below).
- Step 4: with every day closed, `hours` stays missing; Sunday (7) is closed in the final week,
  Friday closes at 03:00 and Saturday opens at 10:00. At 22:52 on Tuesday the theater is open
  until 01:00 the next morning.
- Step 6: the refused duplicate used up sequence value 2, so New Year's Eve is id 3.
- Step 7: the cover is centre-cropped to 16:9 in three sizes; a square image is refused before
  anything is stored; the gallery photo keeps 4:3 and is never upscaled; the replayed upload
  answers the stored body and adds nothing; an unknown theater is `404` before any image work.
- Step 8: after deleting a gallery photo and the cover, the cover URL is `404` and `.media` holds
  only the remaining photo's three files.
- Step 10: a `PATCH` that changes nothing (`status` and `city` as they are) answers `200`,
  keeps `updatedAt` and records nothing.

## Audit rows

`audit_events` after the run, the rows of this unit (`action LIKE 'theater%'`). Field names and
counts only: no phone number, email, address or label value.

```
action|entity_type|entity_id|actor_staff_user_id|changed_fields|metadata
theater.created|theater|1|1|{}|{}
theater.updated|theater|1|1|{parkingInfo}|{}
theater.prices_replaced|theater|1|1|{}|{"back": 23000, "front": 15000, "middle": 19000, "currency": "EGP"}
theater.hours_replaced|theater|1|1|{}|{"openDays": 0}
theater.hours_replaced|theater|1|1|{}|{"openDays": 6}
theater.phones_replaced|theater|1|1|{}|{"count": 2}
theater.facilities_replaced|theater|1|1|{}|{"count": 3}
theater_special_date.created|theater_special_date|1|1|{}|{"theaterId": 1, "cinemaDate": "2026-10-21"}
theater_special_date.updated|theater_special_date|1|1|{closes}|{"theaterId": 1, "cinemaDate": "2026-10-21"}
theater_special_date.created|theater_special_date|3|1|{}|{"theaterId": 1, "cinemaDate": "2026-12-31"}
theater_special_date.deleted|theater_special_date|3|1|{}|{"theaterId": 1, "cinemaDate": "2026-12-31"}
theater.cover_replaced|theater|1|1|{}|{"hadCover": false}
theater_photo.created|theater_photo|1|1|{}|{"theaterId": 1}
theater_photo.created|theater_photo|2|1|{}|{"theaterId": 1}
theater_photo.updated|theater_photo|2|1|{position}|{"theaterId": 1}
theater_photo.updated|theater_photo|1|1|{caption}|{"theaterId": 1}
theater_photo.deleted|theater_photo|1|1|{}|{"theaterId": 1}
theater.cover_removed|theater|1|1|{}|{}
theater.published|theater|1|1|{}|{"to": "active", "from": "draft"}
theater.sales_paused|theater|1|1|{}|{"to": "sales_paused", "from": "active"}
theater.sales_resumed|theater|1|1|{}|{"to": "active", "from": "sales_paused"}
theater.created|theater|3|1|{}|{}
theater.deleted|theater|3|1|{}|{"hadCover": false, "photoCount": 0}
```

## Logs

`grep -E -c '20227351100|201009876543|zamalek@|26 July|Valet' app.log` → `0` over 133 lines: no
phone number, email, address or free text reached the logs. Request lines carry the route
template, status, principal kind and id, for example:

```
{"level":"warn",…,"method":"DELETE","route":"/api/v1/admin/theaters/:id/cover","statusCode":403,"principalKind":"staff","principalId":2,"msg":"request completed"}
```

## Result

Every route of the unit answered as the spec says: create, edit, publish (refused with the
missing requirements), pause, resume, the refused transitions, deletion rules, phones,
facilities, prices, weekly hours, special dates, cover and gallery uploads through the real image
pipeline and local storage, reordering, deletes with their files, the list with cursor and
filter, and `FORBIDDEN` for a box-office token. No defect found.
