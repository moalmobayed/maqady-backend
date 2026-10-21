---
title: U7 — Showtimes manual QA
owner: Mohamed Tarek
status: Recorded
last_verified: 2026-10-20
tags: [showtimes, qa, curl]
---

# U7 — Showtimes: manual QA

Issue: #8. Spec: `docs/gh-8-showtimes/spec.md`.

**Setup.** The built app (`npm run build`, then `node dist/main.js`) on port 3111 against the
unit's own development database `maqady_u7_dev`, filled by `npm run seed` (five published
theaters with one active 12 × 16 hall each, open 12:00–01:00; the seed gives Maqady Zamalek
"Holiday hours" 10:00–03:00 on Fri 23 Oct; twelve movies). The real clock was 21 Oct 2026, about
03:00 Cairo time. The admin is the seed admin; a box-office member was created through the real
`StaffService` for the access checks. `$B` is `http://localhost:3111/api/v1`; tokens are shown
as `$ADMIN` and `$BOX`. Each block is the command and the response's status, with the body
trimmed by `jq` to the fields that matter; row counts and audit rows come from `psql`. No
booking exists yet, so the move notifies nobody (`notifiedCount: 0`) and the cancel refunds
nothing: the default seams. Their behaviour with holders and outcomes is covered by the
integration suite (`test/integration/modules/showtimes/admin-showtimes.controller.test.ts`).

**Log hygiene.** The app log of the whole run (241 lines) has a `correlationId` on every request
line and no email address, password or token: `grep -E "@maqady|@example|Passw0rd|Maqady-seed|Bearer "`
finds nothing. Request lines carry method, route, status, time and `principalKind`/`principalId`
only.

**Result.** Every route behaved as the spec says; nothing to fix.

### Before: row counts
```
0 showtimes, 205 keys, 214 audit rows, 0 messages
```

### 1. Dry run: Hall 1 (Maqady Zamalek, 12:00-01:00), The Last Lighthouse (128 min), Fri 23 and Sat 24 Oct at 19:30
```
$ curl -s -X POST $B/admin/showtime-checks -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: a8bd5805-4f91-41ee-94ad-91c9a52883dc" -d '{"movieId":1,"hallId":1,"dates":["2026-10-24","2026-10-23"],"startTime":"19:30"}'
HTTP 200
{"movie":"The Last Lighthouse","hall":"Hall 1","results":[{"cinemaDate":"2026-10-23","result":"available","startsAt":"2026-10-23T19:30:00+03:00","endsAt":"2026-10-23T21:38:00+03:00","cleaningEndsAt":"2026-10-23T21:58:00+03:00","window":{"opensAt":"2026-10-23T10:00:00+03:00","closesAt":"2026-10-24T03:00:00+03:00"}},{"cinemaDate":"2026-10-24","result":"available","startsAt":"2026-10-24T19:30:00+03:00","endsAt":"2026-10-24T21:38:00+03:00","cleaningEndsAt":"2026-10-24T21:58:00+03:00","window":{"opensAt":"2026-10-24T12:00:00+03:00","closesAt":"2026-10-25T01:00:00+03:00"}}]}
```
Counts after the dry run (with a key):
```
0 showtimes, 205 keys, 214 audit rows, 0 messages
```

### 2. Create both dates (skipUnavailable false)
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: edb27c41-4b57-44ff-9f4c-450a1ce034d6" -d '{"movieId":1,"hallId":1,"dates":["2026-10-23","2026-10-24"],"startTime":"19:30","skipUnavailable":false}'
HTTP 201
{"createdCount":2,"skippedCount":0,"results":[{"cinemaDate":"2026-10-23","result":"created","showtime":{"id":1,"cinemaDate":"2026-10-23","startTime":"19:30","startsAt":"2026-10-23T19:30:00+03:00","endsAt":"2026-10-23T21:38:00+03:00","cleaningEndsAt":"2026-10-23T21:58:00+03:00","status":"scheduled","seatCapacity":160,"fromPrice":15000,"movable":true,"cancellable":true}},{"cinemaDate":"2026-10-24","result":"created","showtime":{"id":2,"cinemaDate":"2026-10-24","startTime":"19:30","startsAt":"2026-10-24T19:30:00+03:00","endsAt":"2026-10-24T21:38:00+03:00","cleaningEndsAt":"2026-10-24T21:58:00+03:00","status":"scheduled","seatCapacity":160,"fromPrice":15000,"movable":true,"cancellable":true}}]}
```

### 2b. Little Falafel Detectives (88 min) at 13:00 on the 23rd in the same hall
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 72416d95-4170-4c78-a824-05ab121a4ec7" -d '{"movieId":6,"hallId":1,"dates":["2026-10-23"],"startTime":"13:00","skipUnavailable":false}'
HTTP 201
[{"result":"created","showtime":{"id":3,"cinemaDate":"2026-10-23","startTime":"13:00","startsAt":"2026-10-23T13:00:00+03:00","endsAt":"2026-10-23T14:28:00+03:00","cleaningEndsAt":"2026-10-23T14:48:00+03:00","status":"scheduled","seatCapacity":160,"fromPrice":15000,"movable":true,"cancellable":true}}]
```

### 3. Replay with the same key
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: edb27c41-4b57-44ff-9f4c-450a1ce034d6" -d '{"movieId":1,"hallId":1,"dates":["2026-10-23","2026-10-24"],"startTime":"19:30","skipUnavailable":false}'
HTTP 201 Idempotent-Replayed: true
{"createdCount":2,"ids":[1,2]}
```

### 4. Without a key
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -d '{"movieId":1,"hallId":1,"dates":["2026-10-25"],"startTime":"19:30","skipUnavailable":false}'
HTTP 400
{"code":"IDEMPOTENCY_KEY_REQUIRED","details":null}
```

### 5. Dry run 20:00 on the 23rd and 25th: a conflict with suggestions
```
$ curl -s -X POST $B/admin/showtime-checks -H "Authorization: Bearer $ADMIN" -d '{"movieId":2,"hallId":1,"dates":["2026-10-23","2026-10-25"],"startTime":"20:00"}'
HTTP 200
[{"cinemaDate":"2026-10-23","result":"conflict","conflicts":[{"showtimeId":1,"movieTitle":"The Last Lighthouse","startsAt":"2026-10-23T19:30:00+03:00","endsAt":"2026-10-23T21:38:00+03:00","cleaningEndsAt":"2026-10-23T21:58:00+03:00"}],"suggestions":["22:00","22:05","22:10"]},{"cinemaDate":"2026-10-25","result":"available","conflicts":[],"suggestions":[]}]
```

### 6. Create 20:00 on the 23rd and 25th, skipUnavailable true
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: eac6009c-1244-4f79-8e83-86e55c01e319" -d '{"movieId":2,"hallId":1,"dates":["2026-10-23","2026-10-25"],"startTime":"20:00","skipUnavailable":true}'
HTTP 201
{"createdCount":1,"skippedCount":1,"results":[{"cinemaDate":"2026-10-23","result":"conflict","showtimeId":null,"conflicts":[1]},{"cinemaDate":"2026-10-25","result":"created","showtimeId":5,"conflicts":[]}]}
```

### 7. The same, skipUnavailable false, 23rd and 26th: nothing created
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 05bf4a08-06e1-437b-b98d-bf99cbdb48ba" -d '{"movieId":2,"hallId":1,"dates":["2026-10-23","2026-10-26"],"startTime":"20:00","skipUnavailable":false}'
HTTP 409
{"code":"SHOWTIMES_NOT_CREATED","results":[{"cinemaDate":"2026-10-23","result":"conflict","conflicts":[1]},{"cinemaDate":"2026-10-26","result":"available","conflicts":[]}]}
```

### 8. Outside the opening hours: 11:00, and 23:30 (ends after 01:00)
```
$ curl -s -X POST $B/admin/showtime-checks -H "Authorization: Bearer $ADMIN" -d '{"movieId":1,"hallId":1,"dates":["2026-10-27"],"startTime":"11:00"}'
HTTP 200
[{"result":"outside_opening_hours","window":{"opensAt":"2026-10-27T12:00:00+03:00","closesAt":"2026-10-28T01:00:00+03:00"},"suggestions":["12:00","12:05","12:10"]}]
```
```
$ curl -s -X POST $B/admin/showtime-checks -H "Authorization: Bearer $ADMIN" -d '{"movieId":1,"hallId":1,"dates":["2026-10-27"],"startTime":"23:30"}'
HTTP 200
[{"result":"outside_opening_hours","endsAt":"2026-10-28T01:38:00+03:00","window":{"opensAt":"2026-10-27T12:00:00+03:00","closesAt":"2026-10-28T01:00:00+03:00"}}]
```

### 9. Summer-time night: 23 Apr 2026 at 00:30 does not exist (24 Apr 00:00 jumps to 01:00); 22 Apr is past
```
$ curl -s -X POST $B/admin/showtime-checks -H "Authorization: Bearer $ADMIN" -d '{"movieId":1,"hallId":1,"dates":["2026-04-22","2026-04-23"],"startTime":"00:30"}'
HTTP 200
[{"cinemaDate":"2026-04-22","result":"in_past","startsAt":"2026-04-23T00:30:00+02:00"},{"cinemaDate":"2026-04-23","result":"time_does_not_exist","startsAt":null}]
```

### 10. Fall-back night: 29 Oct 2026 at 23:30 is its first occurrence (+03:00); Little Falafel Detectives (88 min) ends at 23:58 +02:00
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 23a839bb-9d2f-4549-9a9e-82b93a17d35c" -d '{"movieId":6,"hallId":1,"dates":["2026-10-29"],"startTime":"23:30","skipUnavailable":false}'
HTTP 201
[{"result":"created","showtime":{"id":8,"cinemaDate":"2026-10-29","startTime":"23:30","startsAt":"2026-10-29T23:30:00+03:00","endsAt":"2026-10-29T23:58:00+02:00","cleaningEndsAt":"2026-10-30T00:18:00+02:00","status":"scheduled","seatCapacity":160,"fromPrice":15000,"movable":true,"cancellable":true}}]
```

### 11. After midnight: theater 2 open 12:00-04:00, Nile After Midnight at 00:30 on cinema date Fri 23 Oct
```
$ curl -s -X PUT $B/admin/theaters/2/hours -H "Authorization: Bearer $ADMIN" -d '{"days": [ every weekday 12:00-04:00 ]}'
HTTP 200
```
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 8949fc24-5171-4da1-97c7-a5ae08ffe2da" -d '{"movieId":2,"hallId":2,"dates":["2026-10-23"],"startTime":"00:30","skipUnavailable":false}'
HTTP 201
[{"result":"created","showtime":{"id":9,"cinemaDate":"2026-10-23","startTime":"00:30","startsAt":"2026-10-24T00:30:00+03:00","endsAt":"2026-10-24T02:22:00+03:00","cleaningEndsAt":"2026-10-24T02:42:00+03:00","status":"scheduled","seatCapacity":192,"fromPrice":15000,"movable":true,"cancellable":true}}]
```
```
$ curl -s -X GET $B/admin/showtimes?theaterId=2&date=2026-10-23 -H "Authorization: Bearer $ADMIN"
HTTP 200
{"cinemaDate":"2026-10-23","window":{"opensAt":"2026-10-23T12:00:00+03:00","closesAt":"2026-10-24T04:00:00+03:00"},"items":[{"id":9,"startsAt":"2026-10-24T00:30:00+03:00","cinemaDate":"2026-10-23"}],"total":1}
```
```
$ curl -s -X GET $B/admin/showtimes?theaterId=2&date=2026-10-24 -H "Authorization: Bearer $ADMIN"
HTTP 200
{"items":[],"total":0}
```

### 12. Not schedulable: Desert Signal is Coming soon; unknown hall
```
$ curl -s -X POST $B/admin/showtime-checks -H "Authorization: Bearer $ADMIN" -d '{"movieId":8,"hallId":1,"dates":["2026-10-23"],"startTime":"13:00"}'
HTTP 409
{"code":"SHOWTIME_NOT_SCHEDULABLE","details":{"reasons":["movie_not_now_showing"]}}
```
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 70e560d9-8048-4532-bd6c-8e3a78f68f55" -d '{"movieId":1,"hallId":999,"dates":["2026-10-23"],"startTime":"13:00","skipUnavailable":true}'
HTTP 404
{"code":"NOT_FOUND","details":{"entity":"hall"}}
```

### 13. The manage panel and the timeline (one per page)
```
$ curl -s -X GET $B/admin/showtimes/1 -H "Authorization: Bearer $ADMIN"
HTTP 200
{"theater":{"id":1,"name":"Maqady Zamalek","status":"active"},"movie":{"id":1,"title":"The Last Lighthouse","status":"now_showing","runtimeMinutes":128,"ageRating":"12+"},"hall":{"id":1,"name":"Hall 1"},"prices":{"front":15000,"middle":19000,"back":23000},"id":1,"cinemaDate":"2026-10-23","startTime":"19:30","startsAt":"2026-10-23T19:30:00+03:00","endsAt":"2026-10-23T21:38:00+03:00","cleaningEndsAt":"2026-10-23T21:58:00+03:00","status":"scheduled","seatCapacity":160,"fromPrice":15000,"movable":true,"cancellable":true}
```
```
$ curl -s -X GET $B/admin/showtimes?theaterId=1&date=2026-10-23&limit=1 -H "Authorization: Bearer $ADMIN"
HTTP 200
{"theater":{"id":1,"name":"Maqady Zamalek","status":"active"},"cinemaDate":"2026-10-23","window":{"opensAt":"2026-10-23T10:00:00+03:00","closesAt":"2026-10-24T03:00:00+03:00"},"specialDateLabel":"Holiday hours","halls":[{"id":1,"name":"Hall 1","status":"active","seatCount":160}],"items":[{"id":3,"startTime":"13:00","movie":"Little Falafel Detectives"}],"nextCursor":"WyIyMDI2LTEwLTIzVDEwOjAwOjAwLjAwMFoiLDNd","total":2}
```
```
$ curl -s -X GET $B/admin/showtimes?theaterId=1&date=2026-10-23&limit=1&cursor=WyIyMDI2LTEwLTIzVDEwOjAwOjAwLjAwMFoiLDNd -H "Authorization: Bearer $ADMIN"
HTTP 200
{"items":[{"id":1,"startTime":"19:30","movie":"The Last Lighthouse"}],"nextCursor":null,"total":2}
```
```
$ curl -s -X GET $B/admin/showtimes?theaterId=1&date=2026-02-30 -H "Authorization: Bearer $ADMIN"
HTTP 400
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"date","messages":["date must hold dates written YYYY-MM-DD"]}]}}
```

### 14. Move the 23 Oct 19:30 showtime to 14:00 (into the 13:00 one, clean at 14:48), then to 16:00
```
$ curl -s -X PATCH $B/admin/showtimes/1 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: d1a25c38-55d9-4ee2-bcc1-007bc0c5aa56" -d '{"startTime":"14:00"}'
HTTP 409
{"code":"SHOWTIME_CONFLICT","details":{"conflicts":[{"showtimeId":3,"movieTitle":"Little Falafel Detectives","startsAt":"2026-10-23T13:00:00+03:00","endsAt":"2026-10-23T14:28:00+03:00","cleaningEndsAt":"2026-10-23T14:48:00+03:00"}]}}
```
```
$ curl -s -X PATCH $B/admin/showtimes/1 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 5a17fa13-c69a-42b1-a452-3babeb330bab" -d '{"startTime":"16:00"}'
HTTP 200
{"id":1,"cinemaDate":"2026-10-23","startTime":"16:00","startsAt":"2026-10-23T16:00:00+03:00","endsAt":"2026-10-23T18:08:00+03:00","cleaningEndsAt":"2026-10-23T18:28:00+03:00","status":"scheduled","seatCapacity":160,"fromPrice":15000,"movable":true,"cancellable":true}
```

### 15. Move the 24 Oct showtime past closing, onto a nonexistent time, into the past, to another date
```
$ curl -s -X PATCH $B/admin/showtimes/2 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 98e6cddb-d026-43f5-a6fc-559dd06fee2e" -d '{"startTime":"23:30"}'
HTTP 422
{"code":"OUTSIDE_OPENING_HOURS","details":{"window":{"opensAt":"2026-10-24T12:00:00+03:00","closesAt":"2026-10-25T01:00:00+03:00"}}}
```
```
$ curl -s -X PATCH $B/admin/showtimes/2 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 72866d7a-6c80-4b45-942f-c944672d5059" -d '{"cinemaDate":"2026-04-23","startTime":"00:30"}'
HTTP 422
{"code":"TIME_DOES_NOT_EXIST","details":{"date":"2026-04-24","time":"00:30","cinemaDate":"2026-04-23"}}
```
```
$ curl -s -X PATCH $B/admin/showtimes/2 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: f40fece4-baa8-40a8-9f91-269c94f5639b" -d '{"cinemaDate":"2026-10-01","startTime":"13:00"}'
HTTP 400
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"startTime","messages":["startTime must be after now"]}]}}
```
```
$ curl -s -X PATCH $B/admin/showtimes/2 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: dfb8c02b-2707-4b76-936d-db07acd749fc" -d '{"cinemaDate":"2026-10-26","startTime":"18:45"}'
HTTP 200
{"id":2,"cinemaDate":"2026-10-26","startTime":"18:45","startsAt":"2026-10-26T18:45:00+03:00","endsAt":"2026-10-26T20:53:00+03:00","cleaningEndsAt":"2026-10-26T21:13:00+03:00","status":"scheduled","seatCapacity":160,"fromPrice":15000,"movable":true,"cancellable":true}
```

### 16. New prices, then a no-op (the same start again)
```
$ curl -s -X PATCH $B/admin/showtimes/1 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 83841b77-b780-4e4c-85fa-3bf8fe6622f2" -d '{"prices":{"front":{"amount":12000,"currency":"EGP"},"middle":{"amount":19000,"currency":"EGP"},"back":{"amount":23000,"currency":"EGP"}}}'
HTTP 200
{"prices":{"front":12000,"middle":19000,"back":23000},"fromPrice":12000}
```
```
$ curl -s -X PATCH $B/admin/showtimes/1 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: cc07799f-476d-402a-8598-140a576c46a5" -d '{"startTime":"16:00"}'
HTTP 200
{"startTime":"16:00","updatedAt":"2026-10-21T03:02:04+03:00"}
```

### 17. Malformed changes
```
$ curl -s -X PATCH $B/admin/showtimes/1 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: dff4ac3b-28f8-4d07-8bd5-c9c8b44f1c8c" -d '{}'
HTTP 400
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"startTime","messages":["send startTime (with cinemaDate to move to another date), prices, or status with cancelReason","startTime must be a 24-hour time written HH:mm, such as 19:30"]}]}}
```
```
$ curl -s -X PATCH $B/admin/showtimes/1 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 5859e7a8-35bd-4a97-bffb-4e3f8530cba9" -d '{"status":"cancelled","cancelReason":"low_sales","startTime":"14:00"}'
HTTP 400
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"status","messages":["a cancellation is sent alone: status and cancelReason, nothing else"]}]}}
```

### 18. Cancel the after-midnight showtime, then again
```
$ curl -s -X PATCH $B/admin/showtimes/9 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: ab3f6d30-8c44-4cd3-a7cb-f636bc9fdeba" -d '{"status":"cancelled","cancelReason":"print_not_delivered"}'
HTTP 200
{"id":9,"status":"cancelled","cancelReason":"print_not_delivered","cancelledAt":"2026-10-21T03:02:04+03:00","movable":false,"cancellable":false}
```
```
$ curl -s -X PATCH $B/admin/showtimes/9 -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: 25700f4e-19e8-478b-8e59-aef9da16f459" -d '{"status":"cancelled","cancelReason":"low_sales"}'
HTTP 409
{"code":"SHOWTIME_NOT_EDITABLE","details":{"reason":"cancelled"}}
```

### 19. Hall, theater and movie rules
```
$ curl -s -X DELETE $B/admin/halls/1 -H "Authorization: Bearer $ADMIN"
HTTP 409
{"code":"HALL_NOT_DELETABLE","details":{"reasons":["has_showtimes"]}}
```
```
$ curl -s -X PATCH $B/admin/halls/1 -H "Authorization: Bearer $ADMIN" -d '{"status":"retired"}'
HTTP 409
{"code":"HALL_NOT_RETIRABLE","details":{"reasons":["has_future_showtimes"]}}
```
```
$ curl -s -X DELETE $B/admin/movies/1 -H "Authorization: Bearer $ADMIN"
HTTP 409
{"code":"MOVIE_NOT_DELETABLE","details":{"reasons":["has_showtimes"]}}
```
```
$ curl -s -X DELETE $B/admin/theaters/1 -H "Authorization: Bearer $ADMIN"
HTTP 409
{"code":"THEATER_NOT_DELETABLE","details":{"reasons":["not_draft","has_showtimes"]}}
```

### 20. A layout save refreshes upcoming showtimes' capacity
```
1|160
2|160
3|160
5|160
8|160
```
```
$ curl -s -X PUT $B/admin/halls/1/layout -H "Authorization: Bearer $ADMIN" -d '{"rowCount":10,"seatsPerRow":16,"rowZones":["front","front","front","middle","middle","middle","middle","back","back","back"],"seatMarks":[]}'
HTTP 200
{"seatCount":160,"zoneSeatCounts":{"front":48,"middle":64,"back":48}}
```
```
1|160
2|160
3|160
5|160
8|160
```

### 21. Access: box office and no token
```
$ curl -s -X GET $B/admin/showtimes?theaterId=1&date=2026-10-23 -H "Authorization: Bearer $BOX"
HTTP 403
{"code":"FORBIDDEN","details":null}
```
```
$ curl -s -X POST $B/admin/showtime-checks -H "Authorization: Bearer $BOX" -d '{"movieId":1,"hallId":1,"dates":["2026-10-23"],"startTime":"13:00"}'
HTTP 403
{"code":"FORBIDDEN","details":null}
```
```
$ curl -s -X POST $B/admin/showtimes -H "Authorization: Bearer $BOX" -H "Idempotency-Key: ed6bc7ae-00bd-4530-8f4e-e231f44143e6" -d '{}'
HTTP 403
{"code":"FORBIDDEN","details":null}
```
```
$ curl -s -X GET $B/admin/showtimes/1 -H "Authorization: Bearer $BOX"
HTTP 403
{"code":"FORBIDDEN","details":null}
```
```
$ curl -s -X PATCH $B/admin/showtimes/1 -H "Authorization: Bearer $BOX" -H "Idempotency-Key: d5d639c5-214d-46d6-a7af-52ff6bcf5dde" -d '{}'
HTTP 403
{"code":"FORBIDDEN","details":null}
```
```
$ curl -s -X GET $B/admin/showtimes/1
HTTP 401
{"code":"UNAUTHENTICATED","details":null}
```

### 22. Audit rows of showtimes
```
showtime.created|1|{}|{"hallId": 1, "movieId": 1, "theaterId": 1, "cinemaDate": "2026-10-23"}
showtime.created|2|{}|{"hallId": 1, "movieId": 1, "theaterId": 1, "cinemaDate": "2026-10-24"}
showtime.created|3|{}|{"hallId": 1, "movieId": 6, "theaterId": 1, "cinemaDate": "2026-10-23"}
showtime.created|5|{}|{"hallId": 1, "movieId": 2, "theaterId": 1, "cinemaDate": "2026-10-25"}
showtime.created|8|{}|{"hallId": 1, "movieId": 6, "theaterId": 1, "cinemaDate": "2026-10-29"}
showtime.created|9|{}|{"hallId": 2, "movieId": 2, "theaterId": 2, "cinemaDate": "2026-10-23"}
showtime.moved|1|{startsAt}|{"startsAt": "2026-10-23T16:00:00+03:00", "notifiedCount": 0, "previousStartsAt": "2026-10-23T19:30:00+03:00"}
showtime.moved|2|{startsAt}|{"startsAt": "2026-10-26T18:45:00+03:00", "notifiedCount": 0, "previousStartsAt": "2026-10-24T19:30:00+03:00"}
showtime.prices_changed|1|{priceFront}|{}
showtime.cancelled|9|{cancelReason,status}|{"reason": "print_not_delivered", "notifiedCount": 0, "releasedHoldCount": 0, "refundedBookingCount": 0}
```

### After: row counts
```
6 showtimes, 215 keys, 226 audit rows, 0 messages
```
