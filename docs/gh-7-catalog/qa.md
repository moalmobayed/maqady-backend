---
title: U6 — Manual QA of the catalog
owner: Mohamed Tarek
status: Passed — 2026-10-20
last_verified: 2026-10-20
tags: [qa, catalog, movies, people, credits, youtube, photos, featured]
---

# U6 — Manual QA of the catalog

Issue #7, spec [`spec.md`](spec.md). QA mode: `curl` (with `jq` to trim bodies). Environment:
Node 22, local PostgreSQL 16, this unit's own database `maqady_u6_dev` (migrated at boot), port
3108, fresh secrets from `openssl rand -base64 32`, `EMAIL_DRIVER=simulated`,
`STORAGE_DRIVER=local` with `LOCAL_STORAGE_DIR=.media`. The app ran as built
(`npm run build`, `node --enable-source-maps dist/main.js`).

Accounts: the first admin from `npm run admin:create` (`QA Admin`, staff #1). U2b's invites are
not merged yet, so the box-office member (#2) was created by a QA-only script that calls the real
`StaffService.createActiveMember()`; both signed in through `POST /api/v1/admin/auth/sessions`.
Images were generated with sharp: `still-1600x900.jpg`, `bts-1200x900.jpg`,
`poster-800x1200.png`, `square-1000.png`, `person-600.png`, `person-599.png`.

`$B` is `http://localhost:3108/api/v1`, `$H` the admin's `Authorization: Bearer …`, `$J`
`Content-Type: application/json`. Correlation ids are elided.

## Boot and migrations

```
"msg":"Applied migration 0070_01_create_genres"   … "Applied migration 0070_09_add_movies_media_fks"
$ psql maqady_u6_dev -c "select id,name,slug from maqady.genres order by id"
 1 Action action · 2 Adventure adventure · 3 Animation animation · 4 Comedy comedy · 5 Drama drama
 6 Family family · 7 Mystery mystery · 8 Romance romance · 9 Sci-fi sci-fi · 10 Thriller thriller
```

## Movies: create, edit, publish, status rules

```
$ curl -i -X POST $B/admin/movies -H "$H" -H 'Idempotency-Key: qa-u6-create-1' -H "$J" -d '{"title":"  The Last Lighthouse  "}'
HTTP/1.1 201 Created
{"id":1,"title":"The Last Lighthouse","status":"draft","synopsis":null,…,"ageRating":"12+",…,"genres":[],"poster":null,
 "featuredPosition":null,"photos":[],"videos":[],"credits":[],"publishBlockers":["synopsis","runtimeMinutes","releaseDate","genres"],
 "createdAt":"2026-10-20T23:02:05+03:00","updatedAt":"2026-10-20T23:02:05+03:00","updatedBy":{"id":1,"fullName":"QA Admin"}}

# the same request again
HTTP/1.1 201 Created
Idempotent-Replayed: true

# no key
{"error":{"code":"IDEMPOTENCY_KEY_REQUIRED","message":"This request needs an Idempotency-Key header.","details":null,…}}

$ curl -X PATCH $B/admin/movies/1 -H "$H" -H "$J" -d '{"status":"now_showing"}'
{"error":{"code":"MOVIE_NOT_PUBLISHABLE","message":"Add a synopsis, runtime, release date and at least one genre before publishing.",
 "details":{"missing":["synopsis","runtimeMinutes","releaseDate","genres"]},…}}

$ curl -X PATCH $B/admin/movies/1 … -d '{"synopsis":"A lighthouse keeper …","runtimeMinutes":128,"releaseDate":"2026-10-01","genreIds":[7,5],"budgetLabel":"EGP 48M","language":"Arabic, English subtitles"}'
{"status":"draft","genres":[{"id":7,"name":"Mystery","slug":"mystery"},{"id":5,"name":"Drama","slug":"drama"}],"publishBlockers":[],"budgetLabel":"EGP 48M"}

$ … -d '{"status":"now_showing"}'                    → {"status":"now_showing","publishBlockers":[]}
$ … -d '{"status":"coming_soon"}'                    → {"code":"CONFLICT","details":{"from":"now_showing","to":"coming_soon"}}
$ … -d '{"synopsis":""}'                             → {"code":"MOVIE_NOT_PUBLISHABLE","details":{"missing":["synopsis"]}}
$ … -d '{"genreIds":[99]}'                           → {"code":"VALIDATION_FAILED","details":{"fields":[{"field":"genreIds","messages":["genreIds must name existing genres"]}]}}
```

Genres keep the order sent (Mystery before Drama), the empty synopsis is stored as null and
refused on a public movie, and Now showing never goes back to Coming soon.

## YouTube videos

```
$ curl -X POST $B/admin/movies/1/videos -H "$H" -H "$J" -H 'Idempotency-Key: qa-u6-video-1' \
    -d '{"url":"https://youtu.be/aBcDeFgHiJk?si=share","title":"Official trailer","kind":"trailer","durationSeconds":134}'
[{"id":1,"youtubeId":"aBcDeFgHiJk","title":"Official trailer","kind":"trailer","durationSeconds":134,
  "embedUrl":"https://www.youtube-nocookie.com/embed/aBcDeFgHiJk","thumbnailUrl":"https://i.ytimg.com/vi/aBcDeFgHiJk/hqdefault.jpg",
  "watchUrl":"https://www.youtube.com/watch?v=aBcDeFgHiJk","position":0,"isHero":false}]

# a shorts link → [{"id":1,"youtubeId":"aBcDeFgHiJk","position":0},{"id":2,"youtubeId":"dQw4w9WgXcQ","position":1}]
# vimeo, youtube.com.evil.example and a bare id, each:
{"code":"VALIDATION_FAILED","details":{"fields":[{"field":"url","messages":["That doesn't look like a YouTube video link."]}]}}
# the first video again as a watch link → {"code":"CONFLICT","details":{"constraint":"uq_movie_videos_movie_id_youtube_id"}}

$ curl -X PATCH $B/admin/movies/1/videos/2 … -d '{"position":0,"title":"Making the storm"}'
[{"id":2,"title":"Making the storm","position":0},{"id":1,"title":"Official trailer","position":1}]
```

`movie_videos` holds only `aBcDeFgHiJk` and `dQw4w9WgXcQ`; every URL is derived.

## The home carousel and the hero video

```
$ … PATCH /admin/movies/1 -d '{"featuredPosition":1}'                      → {"code":"MOVIE_NOT_FEATURABLE","details":{"reasons":["no_hero_video"]}}
$ … PATCH /admin/movies/1 -d '{"heroVideoId":1,"featuredPosition":1}'      → {"featuredPosition":1,"heroVideoId":1,"hero":[1]}
# movie 2 (Desert Signal) with a nocookie-embed teaser (video 3):
$ … PATCH /admin/movies/2 -d '{"status":"coming_soon","heroVideoId":3,"featuredPosition":1}'
{"code":"FEATURED_POSITION_TAKEN","details":{"position":1,"movieId":1}}
$ … the same with "featuredPosition":2                                       → {"id":2,"status":"coming_soon","featuredPosition":2}
$ curl -X DELETE $B/admin/movies/1/videos/1 -H "$H"                          → {"code":"MOVIE_NOT_FEATURABLE","details":{"reasons":["no_hero_video"]}}
$ … PATCH /admin/movies/1 -d '{"heroVideoId":null}'                         → {"code":"MOVIE_NOT_FEATURABLE","details":{"reasons":["no_hero_video"]}}
# later: unfeature, then delete the hero
$ … PATCH /admin/movies/1 -d '{"featuredPosition":null}'                    → {"featuredPosition":null}
$ curl -X DELETE $B/admin/movies/1/videos/1 -H "$H"                          → HTTP 204
$ curl $B/admin/movies/1 -H "$H"                                             → {"heroVideoId":null,"videos":[{"id":2,"position":0}]}
```

## Photos, the backdrop and the poster (real pipeline, local storage)

```
$ curl -X POST $B/admin/movies/1/photos -H "$H" -H 'Idempotency-Key: qa-u6-photo-1' \
    -F kind=still -F 'caption=Youssef climbs to the lamp room' -F file=@still-1600x900.jpg
$ curl $B/admin/movies/1 -H "$H" | jq '.photos[]'
{"id":1,"kind":"still","caption":"Youssef climbs to the lamp room","position":0,"isBackdrop":false,"alt":"Youssef climbs to the lamp room",
 "variants":[{"name":"small","width":480,"height":270},{"name":"medium","width":1024,"height":576},{"name":"large","width":1600,"height":900}],
 "url":"http://localhost:3108/media/gallery/b8a325ea-ef53-4afd-b34d-05fbf0acd345/small.webp"}

# the same upload and key again
HTTP/1.1 201 Created
Idempotent-Replayed: true            (still one photo)

# bts-1200x900.jpg, kind behind_the_scenes, no caption → alt falls back to the title
[{"id":1,…,"position":0},{"id":2,"kind":"behind_the_scenes","caption":null,"position":1,"alt":"The Last Lighthouse"}]

$ … PATCH /admin/movies/1 -d '{"backdropPhotoId":1}'  → {"backdropPhotoId":1,"backdrop":[1]}
$ … PATCH /admin/movies/1 -d '{"backdropPhotoId":2}'
{"code":"IMAGE_WRONG_SHAPE","details":{"kind":"backdrop","aspect":"16:9","minWidth":1280,"minHeight":720,"width":1200,"height":900}}
$ … PATCH /admin/movies/1/photos/2 -d '{"position":0,"caption":"On set in Hurghada"}'
[{"id":2,"caption":"On set in Hurghada","position":0},{"id":1,"caption":"Youssef climbs to the lamp room","position":1}]

$ curl -X PUT $B/admin/movies/1/poster -H "$H" -F file=@poster-800x1200.png
{"alt":"The Last Lighthouse poster","variants":[{"name":"small","width":200,"height":300},{"name":"medium","width":400,"height":600},{"name":"large","width":800,"height":1200}]}
$ curl -X PUT $B/admin/movies/1/poster -H "$H" -F file=@square-1000.png
{"code":"IMAGE_WRONG_SHAPE","details":{"kind":"poster","aspect":"2:3","minWidth":400,"minHeight":600,"width":1000,"height":1000}}
$ curl -o /dev/null -w '%{http_code} %{content_type}' http://localhost:3108/media/poster/1b95471b-…/small.webp
200 image/webp

# deleting the backdrop photo
prefix gallery/b8a325ea-ef53-4afd-b34d-05fbf0acd345 files: large.webp medium.webp small.webp
$ curl -X DELETE $B/admin/movies/1/photos/1 -H "$H"   → HTTP 204
{"backdropPhotoId":null,"photos":[{"id":2,"position":0}]}
ls: cannot access '.media/gallery/b8a325ea-ef53-4afd-b34d-05fbf0acd345': No such file or directory
$ curl -X DELETE $B/admin/movies/1/poster -H "$H"     → HTTP 204, {"poster":null}; again → HTTP 204
```

## People, credits from both sides, person photo, delete

```
$ curl -X POST $B/admin/people … -d '{"fullName":"Karim Fahmy","roles":["actor"],"birthDate":"1984-03-12","birthPlace":"Alexandria, Egypt"}'
{"id":1,"fullName":"Karim Fahmy","roles":["actor"],"creditedRoles":[],"imdbUrl":null}
# Hala Nour (director, writer, IMDb link) → id 2; Sami Adel → id 3
# an Instagram box holding an IMDb link and a 401-character bio → fields ["bio","instagramUrl"]

$ curl -X PUT $B/admin/movies/1/credits … -d '{"credits":[{"personId":1,"role":"actor","characterName":"Youssef"},{"personId":2,"role":"director"},{"personId":2,"role":"writer"}]}'
[{"role":"actor","characterName":"Youssef","position":0,"person":"Karim Fahmy"},{"role":"director","characterName":null,"position":1,"person":"Hala Nour"},
 {"role":"writer","characterName":null,"position":2,"person":"Hala Nour"}]
# a character name on a director → [{"field":"credits.0.characterName","messages":["characterName is only for the actor and voice roles"]}]
# an unknown person              → [{"field":"credits.0.personId","messages":["personId must name an existing person"]}]

$ curl -X PUT $B/admin/people/3/credits … -d '{"credits":[{"movieId":1,"role":"actor","characterName":"The guard"},{"movieId":2,"role":"voice","characterName":"Radio"}]}'
{"creditedRoles":["actor","voice"],"credits":[{"role":"voice","characterName":"Radio","movie":"Desert Signal"},{"role":"actor","characterName":"The guard","movie":"The Last Lighthouse"}]}
# movie 1's list: Karim 0, Hala (director) 1, Hala (writer) 2, Sami 3 — appended last

$ curl -X PUT $B/admin/people/1/photo -H "$H" -F file=@person-600.png   → {"alt":"Karim Fahmy","variants":[150,300,600]}
$ curl -X PUT $B/admin/people/1/photo -H "$H" -F file=@person-599.png
{"code":"IMAGE_WRONG_SHAPE","details":{"kind":"person","aspect":"1:1","minWidth":600,"minHeight":600,"width":599,"height":599}}
$ curl -X PATCH $B/admin/people/1 … -d '{"bio":"Stage actor turned screen lead.","instagramUrl":"https://www.instagram.com/karim","roles":["actor","producer"]}'
{"bio":"Stage actor turned screen lead.","instagramUrl":"https://www.instagram.com/karim","roles":["actor","producer"]}

$ curl "$B/admin/people?roleGroup=actors" -H "$H"
{"total":2,"items":[{"fullName":"Karim Fahmy","roles":["actor","producer"],"creditCount":1,"birthYear":1984,"knownFor":["The Last Lighthouse"]},
 {"fullName":"Sami Adel","roles":["actor","voice"],"creditCount":2,"birthYear":null,"knownFor":["Desert Signal","The Last Lighthouse"]}]}
$ curl "$B/admin/people?q=NOUR" -H "$H"   → ["Hala Nour"]

$ curl -X DELETE $B/admin/people/3 -H "$H"   → HTTP 204
# movie 1's credits: Karim 0, Hala 1, Hala 2 (renumbered); movie 2's credits: []
```

## Lists, bulk archive and delete

```
$ curl "$B/admin/movies?limit=1" -H "$H"
{"total":2,"statusCounts":{"draft":0,"comingSoon":1,"nowShowing":1,"archived":0},"next":true,
 "items":[{"id":2,"title":"Desert Signal","status":"coming_soon","featuredPosition":2,"photoCount":0,"videoCount":1,"creditCount":0,"poster":false}]}
$ curl "$B/admin/movies?q=fahm" -H "$H"          → ["The Last Lighthouse"]   (found by its cast)
$ curl "$B/admin/movies?status=coming_soon" -H "$H" → {"total":1,"titles":["Desert Signal"]}

$ curl -X PATCH $B/admin/movies … -d '{"movieIds":[2,3,999],"status":"archived"}' → {"code":"NOT_FOUND","details":{"missingIds":[999]}}
$ … -d '{"movieIds":[2,3],"status":"archived"}'  → {"archivedIds":[2,3],"alreadyArchivedIds":[]}
$ … -d '{"movieIds":[2],"status":"archived"}'    → {"archivedIds":[],"alreadyArchivedIds":[2]}
$ curl $B/admin/movies/2 -H "$H"                  → {"status":"archived","featuredPosition":null}

$ curl -X DELETE $B/admin/movies/1 -H "$H"         → HTTP 204
$ psql -tAc "select (movies id=1),(photos),(videos),(credits),(genres of movie 1),(gallery and poster images)"
0|0|0|0|0|0
$ curl $B/admin/movies/1 -H "$H"                  → "NOT_FOUND"
```

## Access: every route refuses box office and anonymous callers

```
GET /admin/movies box_office=FORBIDDEN none=UNAUTHENTICATED
POST /admin/movies box_office=FORBIDDEN none=UNAUTHENTICATED
PATCH /admin/movies box_office=FORBIDDEN none=UNAUTHENTICATED
GET /admin/movies/2 box_office=FORBIDDEN none=UNAUTHENTICATED
PATCH /admin/movies/2 box_office=FORBIDDEN none=UNAUTHENTICATED
DELETE /admin/movies/2 box_office=FORBIDDEN none=UNAUTHENTICATED
PUT /admin/movies/2/credits box_office=FORBIDDEN none=UNAUTHENTICATED
PUT /admin/movies/2/poster box_office=FORBIDDEN none=UNAUTHENTICATED
DELETE /admin/movies/2/poster box_office=FORBIDDEN none=UNAUTHENTICATED
POST /admin/movies/2/photos box_office=FORBIDDEN none=UNAUTHENTICATED
PATCH /admin/movies/2/photos/1 box_office=FORBIDDEN none=UNAUTHENTICATED
DELETE /admin/movies/2/photos/1 box_office=FORBIDDEN none=UNAUTHENTICATED
POST /admin/movies/2/videos box_office=FORBIDDEN none=UNAUTHENTICATED
PATCH /admin/movies/2/videos/3 box_office=FORBIDDEN none=UNAUTHENTICATED
DELETE /admin/movies/2/videos/3 box_office=FORBIDDEN none=UNAUTHENTICATED
GET /admin/people box_office=FORBIDDEN none=UNAUTHENTICATED
POST /admin/people box_office=FORBIDDEN none=UNAUTHENTICATED
GET /admin/people/1 box_office=FORBIDDEN none=UNAUTHENTICATED
PATCH /admin/people/1 box_office=FORBIDDEN none=UNAUTHENTICATED
DELETE /admin/people/1 box_office=FORBIDDEN none=UNAUTHENTICATED
PUT /admin/people/1/photo box_office=FORBIDDEN none=UNAUTHENTICATED
DELETE /admin/people/1/photo box_office=FORBIDDEN none=UNAUTHENTICATED
PUT /admin/people/1/credits box_office=FORBIDDEN none=UNAUTHENTICATED
```

## Activity log and log hygiene

```
$ psql -c "select action, count(*) from maqady.audit_events where entity_type in ('movie','movie_photo','movie_video','person') group by action order by action"
 movie.archived 2 · movie.created 3 · movie.credits_replaced 1 · movie.deleted 1 · movie.featured 2 · movie.poster_removed 1
 movie.poster_replaced 1 · movie.status_changed 2 · movie.unfeatured 2 · movie.updated 4 · movie_photo.created 2
 movie_photo.deleted 1 · movie_photo.updated 1 · movie_video.created 3 · movie_video.deleted 1 · movie_video.updated 1
 person.created 3 · person.credits_replaced 1 · person.deleted 1 · person.photo_replaced 1 · person.updated 1
$ psql -tAc "select count(*) from maqady.audit_events where (changed_fields::text || metadata::text) ~* '(Lighthouse|Karim|Fahmy|Hala|youtube\.com|EGP 48M|Youssef)'"
0
$ grep -c '"msg":"request completed"' app.log                                → 121
$ grep -ciE 'Lighthouse|Karim|Fahmy|Youssef|qa\.admin@|aBcDeFgHiJk' app.log    → 0
$ grep -o '"level":"[a-z]*"' app.log | sort | uniq -c                         → 115 info, 67 warn (the 4xx request lines), no error
```

## Observations

- A request that fails DTO validation reports only the DTO's fields: a future `birthDate` sent
  with an invalid bio was reported once the bio was fixed (the birth date check runs in the
  service, after validation). Covered by the integration suite on its own.
- No defect found.
