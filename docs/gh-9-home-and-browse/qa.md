---
title: U8a — Manual QA of the home page and browsing reads
owner: Mohamed Tarek
status: Passed — 2026-10-20
last_verified: 2026-10-20
tags: [qa, discovery, home, movies, theaters, seed, contract]
---

# U8a — Manual QA of the home page and browsing reads

Issue #9, spec [`spec.md`](spec.md). QA mode: `curl`. Environment: Node 22, local PostgreSQL 16,
this unit's own database `maqady_u8a_dev` (schema dropped first), port 3113, fresh secrets from
`openssl rand -base64 32`, `EMAIL_DRIVER=simulated`, `STORAGE_DRIVER=local` with
`LOCAL_STORAGE_DIR=.media`. Built with `npm run build`, served with
`node --enable-source-maps dist/main.js`. Run on 2026-10-20 from 22:49 UTC, which is 01:49 on
Wednesday 21 October in Cairo (`+03:00`), so today's cinema date is still **Tuesday 2026-10-20**
and every seeded theater has just closed for the night (the latest weekday closing is 01:00).

`$B` is `http://localhost:3113/api/v1`. Responses are trimmed to the fields named in each step
(node one-liners over the JSON); nothing else was edited.

## Seed: empty database, then again

```
$ psql …/maqady_u8a_dev -c 'DROP SCHEMA maqady CASCADE'; rm -rf .media
$ npm run seed
Created the seed admin seed-admin@maqady.local.
theaters: 6 created, 0 already there
publish-theaters: 5 created, 0 already there
people: 18 created, 0 already there
movies: 12 created, 0 already there
featured: 5 created, 0 already there
Done. Sign in to the dashboard as seed-admin@maqady.local.
$ npm run seed
theaters: 0 created, 6 already there
publish-theaters: 0 created, 5 already there
people: 0 created, 18 already there
movies: 0 created, 12 already there
featured: 0 created, 5 already there
Done. Sign in to the dashboard as seed-admin@maqady.local.
```

Row counts after both runs (`psql`): theaters 6, movies 12, people 18, images 62, movie_videos
24, movie_credits 51, theater_photos 6, staff_users 1. The first run took 23 s, the second 9 s.

```
$ NODE_ENV=production node dist/cli/seed.js; echo $?
{"level":"fatal","msg":"The seed failed","err":{"type":"Error","message":"The seed refuses to run:\n- NODE_ENV is production: the seed is for development databases only", …}}
1
```

## GET /home on the seeded database

```
$ curl -s -D - $B/home
HTTP/1.1 200 OK
X-Request-Id: edea0d89-cb09-411c-9e4d-e4bbd8e09759
Cache-Control: public, max-age=60
Content-Type: application/json; charset=utf-8
```

Summary of the body:

```
serverTime  2026-10-21T01:49:56+03:00     cinemaDate 2026-10-20
featured    1 The Last Lighthouse (now_showing, hero eRsGyueVLvQ, backdrop small 480x270, medium 1024x576, large 1920x1080)
            2 Nile After Midnight   3 Sandstorm Protocol   4 Little Falafel Detectives   5 Desert Signal (coming_soon)
ticker      []
genres      action:1 adventure:2 animation:2 comedy:3 drama:3 family:3 mystery:3 romance:2 sci-fi:2 thriller:3
nowShowing  total 7: Garden City Romance 2026-10-18 (first genre Romance), Sandstorm Protocol 2026-10-15,
            Nile After Midnight 2026-10-08, The Last Lighthouse 2026-10-01, Khan el-Khalili Blues 2026-09-24,
            Red Sea Rising 2026-09-17, Little Falafel Detectives 2026-09-10
comingSoon  total 4: Desert Signal 2026-10-28, The Cartographer of Siwa 2026-11-04,
            Midnight at Ramses Station 2026-11-11, Paper Kites over Giza 2026-11-25
cinemas     Maqady Downtown      closed, nextOpensAt 2026-10-21T10:00:00+03:00, mainPhone Main line +20223921200
            Maqady Heliopolis    closed, nextOpensAt 2026-10-21T11:00:00+03:00
            Maqady New Cairo     closed, nextOpensAt 2026-10-21T12:00:00+03:00
            Maqady Sheikh Zayed  closed, nextOpensAt 2026-10-21T13:00:00+03:00, mainPhone null (contacts hidden)
            Maqady Zamalek       closed, nextOpensAt 2026-10-21T12:00:00+03:00
            (Maqady Dokki is a draft and is absent; every hallCount 0 until halls exist)
```

The first slide, the first Now showing card and the Zamalek card, verbatim (image URLs
shortened to their path):

```json
{ "position": 1,
  "movie": { "id": 1, "title": "The Last Lighthouse",
    "synopsis": "A lighthouse keeper on the Red Sea coast finds a logbook that predicts the storms before they arrive.",
    "genres": [ { "id": 7, "name": "Mystery", "slug": "mystery" }, { "id": 5, "name": "Drama", "slug": "drama" } ],
    "runtimeMinutes": 128, "ageRating": "12+", "releaseDate": "2026-10-01", "status": "now_showing" },
  "heroVideo": { "id": 1, "youtubeId": "eRsGyueVLvQ", "title": "Official trailer", "kind": "trailer",
    "durationSeconds": 134, "embedUrl": "https://www.youtube-nocookie.com/embed/eRsGyueVLvQ",
    "thumbnailUrl": "https://i.ytimg.com/vi/eRsGyueVLvQ/hqdefault.jpg" },
  "backdrop": { "alt": "The Last Lighthouse", "variants": [
    { "name": "small", "url": "http://localhost:3113/media/gallery/b92b…/small.webp", "width": 480, "height": 270 },
    { "name": "medium", "url": "…/medium.webp", "width": 1024, "height": 576 },
    { "name": "large", "url": "…/large.webp", "width": 1920, "height": 1080 } ] } }

{ "id": 7, "title": "Garden City Romance",
  "poster": { "alt": "Garden City Romance poster", "variants": [
    { "name": "small", "url": "http://localhost:3113/media/poster/24da…/small.webp", "width": 200, "height": 300 },
    { "name": "medium", "url": "…/medium.webp", "width": 400, "height": 600 },
    { "name": "large", "url": "…/large.webp", "width": 800, "height": 1200 } ] },
  "genres": [ { "id": 8, "name": "Romance", "slug": "romance" }, { "id": 4, "name": "Comedy", "slug": "comedy" } ],
  "runtimeMinutes": 106, "ageRating": "PG", "releaseDate": "2026-10-18", "status": "now_showing" }

{ "id": 1, "name": "Maqady Zamalek", "district": "Zamalek", "city": "Cairo", "address": "26 July Street, Zamalek",
  "cover": { "alt": "Maqady Zamalek", "variants": [
    { "name": "small", "url": "http://localhost:3113/media/backdrop/8efd…/small.webp", "width": 640, "height": 360 },
    { "name": "medium", "url": "…/medium.webp", "width": 1280, "height": 720 },
    { "name": "large", "url": "…/large.webp", "width": 1920, "height": 1080 } ] },
  "openState": { "isOpen": false, "closesAt": null, "nextOpensAt": "2026-10-21T12:00:00+03:00" },
  "mainPhone": { "label": "Main line", "number": "+20227351100" },
  "hallCount": 0, "facilities": [ "wheelchair_access", "valet_parking", "cafe_bar" ] }
```

This has the shape of the draft's example: the same keys and nesting, a nullable poster and
backdrop filled with `small`/`medium`/`large` variants, the privacy-enhanced embed URL, Cairo
times with offset, E.164 phones. The ticker is empty until U8b's showtimes. The open states say
"closed" because the run was at 01:49; the integration suite moves the Clock across 01:00 and
shows `isOpen: true` with `closesAt` the same night.

```
$ NODE_PATH=$PWD/node_modules node validate-home.js contracts/drafts/home-page.openapi.yaml home.json
valid against HomeResponse
$ curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download} bytes\n' <first poster small url>
200 image/webp 946 bytes
$ curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer nope' $B/home
200
```

(`validate-home.js` is a QA-only script in the scratchpad: ajv with `ajv-formats` over the draft's
schemas, `nullable` mapped to "or null", as `test/support/discovery.ts` does.)

## Contract comparison: generated `/home` against the draft

`npm run contract`, then the generated `contracts/openapi.yaml` compared with
`contracts/drafts/home-page.openapi.yaml`: every schema reachable from `HomeResponse`, with prose
(`description`, `example`) and the default `nullable: false` ignored, key order ignored, and a
lone `allOf: [$ref]` read as its `$ref` (how @nestjs/swagger writes a reference that has a
description).

```
equal     AgeRating
equal     Facility
equal     FeaturedMovie required=["position","movie","heroVideo","backdrop"]
equal     FeaturedMovieDetails required=["id","title","synopsis","genres","runtimeMinutes","ageRating","releaseDate","status"]
equal     GenreRef required=["id","name","slug"]
equal     GenreWithCount
equal     HomeResponse required=["serverTime","cinemaDate","featured","ticker","genres","nowShowing","comingSoon","cinemas"]
equal     Image required=["alt","variants"]
equal     ImageVariant required=["name","url","width","height"]
equal     MovieCard required=["id","title","poster","genres","runtimeMinutes","ageRating","releaseDate","status"]
equal     MovieCardList required=["items","total"]
equal     MovieStatus
equal     OpenState required=["isOpen","closesAt","nextOpensAt"]
equal     Phone required=["label","number"]
equal     TheaterCard required=["id","name","district","city","address","cover","openState","mainPhone","hallCount","facilities"]
equal     TickerItem required=["movie","nextShowtime"]
equal     Video required=["id","youtubeId","title","kind","durationSeconds","embedUrl","thumbnailUrl"]
equal     VideoKind
operationId getHome getHome | tags ["Discovery"] ["Discovery"] | security [] []
responses 200,429,500,503 | 200,429,500,503
200 schema {"$ref":"#/components/schemas/HomeResponse"} {"$ref":"#/components/schemas/HomeResponse"}
200 headers X-Request-Id | X-Request-Id
reached in generated the same 18 schemas
```

Differences found and fixed in the code on the way:

- `TickerItem` first came out without `required: [movie, nextShowtime]`: a property written as an
  inline object schema with its own `required` list is not added to the parent's list by
  @nestjs/swagger. Fixed with `selfRequired: true` on both properties.
- `GenreWithCount` is an `allOf` of `GenreRef` and `{ movieCount }` in the draft, which
  @nestjs/swagger can't build from a class; it is published as written through
  `defineComposedSchema()`.

Names, types, nullability, enums (`MovieStatus` is the public `coming_soon`/`now_showing`;
`AgeRating`, `VideoKind`, `Facility`), required lists, formats (`date-time`, `date`, `uri`,
`uuid` on `X-Request-Id`), `minimum`/`maximum`/`maxItems`/`minItems`/`maxLength` and `pattern`
are all equal. `test/integration/modules/discovery/dto/discovery-contract.test.ts` checks the same
on every run (and failed when `featured.maxItems` was changed to 6 on purpose).

## GET /genres

```
$ curl -s $B/genres
{"total":10,"nextCursor":null,"first":{"id":1,"name":"Action","slug":"action","movieCount":1},
 "slugs":"action:1 adventure:2 animation:2 comedy:3 drama:3 family:3 mystery:3 romance:2 sci-fi:2 thriller:3"}
$ curl -s "$B/genres?status=coming_soon"
action:0 adventure:1 animation:1 comedy:0 drama:1 family:1 mystery:2 romance:0 sci-fi:1 thriller:1
$ curl -s "$B/genres?limit=4"; curl -s "$B/genres?limit=4&cursor=WyJDb21lZHkiLDRd"
{"names":["Action","Adventure","Animation","Comedy"],"nextCursor":"WyJDb21lZHkiLDRd","total":10}
{"names":["Drama","Family","Mystery","Romance"],"nextCursor":"WyJSb21hbmNlIiw4XQ"}
$ curl -s "$B/genres?status=draft"
{"error":{"code":"VALIDATION_FAILED","message":"The request is not valid.","details":{"fields":[{"field":"status","messages":["status must be one of the following values: coming_soon, now_showing"]}]},"correlationId":"69447bae-…"}}
```

## GET /movies

```
$ curl -s $B/movies
{"titles":["Garden City Romance","Sandstorm Protocol","Nile After Midnight","The Last Lighthouse","Khan el-Khalili Blues","Red Sea Rising","Little Falafel Detectives"],"total":7,"nextCursor":null,"tabCounts":{"nowShowing":7,"comingSoon":4}}
$ curl -s "$B/movies?status=coming_soon"
{"titles":["Desert Signal","The Cartographer of Siwa","Midnight at Ramses Station","Paper Kites over Giza"],"total":4,…,"tabCounts":{"nowShowing":7,"comingSoon":4}}
$ curl -s "$B/movies?genres=comedy,family"
{"titles":["Garden City Romance","Khan el-Khalili Blues","Little Falafel Detectives"],"total":3,…,"tabCounts":{"nowShowing":3,"comingSoon":1}}
$ curl -s "$B/movies?genres=western"
{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"genres","messages":["unknown genre: western"]}]}}
$ curl -s "$B/movies?q=nile"          → ["Nile After Midnight"], tabCounts {"nowShowing":1,"comingSoon":0}
$ curl -s "$B/movies?q=karim"         → ["Garden City Romance","The Last Lighthouse"] (a cast name)
$ curl -s "$B/movies?people=1"        → ["Garden City Romance","The Last Lighthouse"] (Karim Fahmy)
$ curl -s "$B/movies?q=abydos"        → [] and tabCounts 0/0 (Echoes of Abydos is a draft)
$ curl -s "$B/movies?limit=3"
{"titles":["Garden City Romance","Sandstorm Protocol","Nile After Midnight"],"total":7,"nextCursor":"WyIyMDI2LTEwLTA4IiwyXQ",…}
$ curl -s "$B/movies?limit=3&cursor=WyIyMDI2LTEwLTA4IiwyXQ"
{"titles":["The Last Lighthouse","Khan el-Khalili Blues","Red Sea Rising"],"total":7,"nextCursor":"WyIyMDI2LTA5LTE3Iiw1XQ",…}
$ curl -s "$B/movies?status=archived&people=x"
{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"status","messages":["status must be one of the following values: coming_soon, now_showing"]},{"field":"people","messages":[…three messages…]}]}}
```

**Found here and fixed** (`fix(discovery): refuse a bad person id …`, with a unit test that
failed first): `people=x` answered three messages, two of them about number bounds. After the
fix:

```
$ curl -s "$B/movies?people=x"
{"fields":[{"field":"people","messages":["each person must be a person id"]}]}
```

## GET /movies/{id} and /similar

```
$ curl -s -D - -o /dev/null $B/movies/1     → HTTP/1.1 200 OK, Cache-Control: public, max-age=60
$ curl -s $B/movies/1
{ "id": 1, "title": "The Last Lighthouse", "status": "now_showing", "synopsis": "A lighthouse keeper …",
  "runtimeMinutes": 128, "releaseDate": "2026-10-01", "ageRating": "12+", "language": "Arabic",
  "country": "Egypt", "productionCompany": "Nile Light Pictures", "budgetLabel": "EGP 48M",
  "filmingLocations": "Marsa Alam, Red Sea", "genres": [mystery, drama],
  "poster": "The Last Lighthouse poster (3 sizes)", "backdrop": "The Last Lighthouse",
  "heroVideo": "eRsGyueVLvQ trailer",
  "videos": ["eRsGyueVLvQ trailer Official trailer", "R6MlUcmOul8 teaser Teaser"],
  "photos": ["still A still from the film alt=A still from the film", "behind_the_scenes On set alt=On set"],
  "credits": ["0 director Amr Galal [photo]", "1 writer Rania Kamal [photo]",
              "2 actor Karim Fahmy as Youssef, the keeper [photo]", "3 actor Nour El-Sayed as Salma [photo]",
              "4 actor Youssef Rizk as Captain Fawzy [photo]", "5 cinematographer Ahmed Samir [photo]",
              "6 composer Ingy Morsy [photo]"] }
$ for id in 12 999 abc; do curl -s $B/movies/$id; done
{"code":"NOT_FOUND","message":"The requested resource was not found."}     (12 is the draft)
{"code":"NOT_FOUND","message":"The requested resource was not found."}
{"code":"VALIDATION_FAILED","message":"The request is not valid."}
$ curl -s $B/movies/1/similar
["Nile After Midnight [romance,drama]"]   (the only other Now showing movie sharing mystery or drama)
$ curl -s -o /dev/null -w '%{http_code}\n' $B/movies/12/similar
404
```

## GET /people

```
$ curl -s "$B/people?limit=5"
{"total":18,"nextCursor":"WyJIYWxhIEV6emF0IiwxMl0","items":["16 Ahmed Samir cinematographer [photo 150/300/600]","11 Amr Galal director/writer [photo …]","18 Bassem Ragab producer [photo …]","10 Dina Sherif actor [photo …]","12 Hala Ezzat director [photo …]"]}
$ curl -s "$B/people?roleGroup=directors"  → ["Amr Galal director/writer","Hala Ezzat director","Sherif Wahba director/writer"]
$ curl -s "$B/people?q=fahm"               → ["Karim Fahmy"]
$ curl -s "$B/people?roleGroup=extras"     → VALIDATION_FAILED
```

## GET /theaters and /theaters/{id}

```
$ curl -s $B/theaters
{"total":5,"nextCursor":null,"items":[
 "Maqady Downtown open=false next 2026-10-21T10:00:00+03:00 today 10:00-00:00 (next day)",
 "Maqady Heliopolis open=false next 2026-10-21T11:00:00+03:00 today 11:00-00:30 (next day)",
 "Maqady New Cairo open=false next 2026-10-21T12:00:00+03:00 today 12:00-01:00 (next day)",
 "Maqady Sheikh Zayed open=false next 2026-10-21T13:00:00+03:00 today 13:00-01:00 (next day)",
 "Maqady Zamalek open=false next 2026-10-21T12:00:00+03:00 today 12:00-01:00 (next day)"]}
$ curl -s "$B/theaters?parking=true"   → Heliopolis, New Cairo, Sheikh Zayed, Zamalek (free or valet), total 4
$ curl -s "$B/theaters?openNow=true"   → {"total":0,"nextCursor":null,"items":[]}   (01:51, all closed)
$ curl -s "$B/theaters?limit=2"        → Downtown, Heliopolis, total 5, nextCursor "WyJNYXFhZHkgSGVsaW9wb2xpcyIsM10"
$ curl -s "$B/theaters?openNow=1"      → VALIDATION_FAILED
$ curl -s "$B/theaters?limit=1"        (one item, weekly hours trimmed)
{ "id": 2, "name": "Maqady Downtown", "district": "Downtown", "city": "Cairo",
  "address": "12 Talaat Harb Street, Downtown", "cover": "Maqady Downtown",
  "openState": { "isOpen": false, "closesAt": null, "nextOpensAt": "2026-10-21T10:00:00+03:00" },
  "mainPhone": { "label": "Main line", "number": "+20223921200" }, "hallCount": 0,
  "facilities": [ "street_parking", "cafe_bar" ], "latitude": 30.0478, "longitude": 31.2384,
  "today": { "cinemaDate": "2026-10-20", "closed": false, "opens": "10:00", "closes": "00:00",
             "closesNextDay": true, "specialDateLabel": null },
  "weeklyHours": [ { "weekday": 1, "closed": false, "opens": "10:00", "closes": "00:00", "closesNextDay": true }, … ] }
$ curl -s $B/theaters/1
{ "id": 1, "name": "Maqady Zamalek", …, "latitude": 30.0609, "longitude": 31.2197,
  "transitInfo": "Metro: Opera station, then 10 minutes on foot over the bridge",
  "parkingInfo": "Valet at the main entrance", "email": "zamalek@maqady.example",
  "phones": [ { "label": "Main line", "number": "+20227351100" }, { "label": "Box office", "number": "+20227351101" } ],
  "facilities": [ "wheelchair_access", "valet_parking", "cafe_bar" ], "cover": "Maqady Zamalek",
  "photos": [ "1 The lobby alt=The lobby", "2 Hall 1 from the back row alt=Hall 1 from the back row" ],
  "openState": { "isOpen": false, "closesAt": null, "nextOpensAt": "2026-10-21T12:00:00+03:00" },
  "today": { "cinemaDate": "2026-10-20", "opens": "12:00", "closes": "01:00", "closesNextDay": true, … },
  "weeklyHours": "7 days",
  "specialDates": [ { "id": 1, "cinemaDate": "2026-10-23", "label": "Holiday hours", "closed": false,
                      "opens": "10:00", "closes": "03:00", "closesNextDay": true } ],
  "hallCount": 0 }
$ curl -s $B/theaters/5      (Sheikh Zayed hides its contacts)
{"name":"Maqady Sheikh Zayed","email":null,"phones":[],"photos":[],"specialDates":[]}
$ for id in 6 999 abc; do curl -s $B/theaters/$id; done
{"code":"NOT_FOUND"}  (6 is the Dokki draft)
{"code":"NOT_FOUND"}
{"code":"VALIDATION_FAILED"}
```

## Status changes reach the public reads at once

Signed in as the seed admin (`POST $B/admin/auth/sessions`), `$TOKEN` its access token:

```
PATCH /admin/theaters/1 {"status":"sales_paused"}: 200
GET /theaters/1: 404
home cinemas: Maqady Downtown, Maqady Heliopolis, Maqady New Cairo, Maqady Sheikh Zayed
PATCH /admin/theaters/1 {"status":"active"}: 200
home cinemas: Maqady Downtown, Maqady Heliopolis, Maqady New Cairo, Maqady Sheikh Zayed, Maqady Zamalek
PATCH /admin/movies/7 {"status":"archived"}: 200
nowShowing total 6: Sandstorm Protocol, Nile After Midnight, The Last Lighthouse, Khan el-Khalili Blues, Red Sea Rising, Little Falafel Detectives | romance 1
GET /movies/7: 404
PATCH /admin/movies/7 {"status":"now_showing"}: 200
nowShowing total 7 | romance 2
```

(Responses may be cached by browsers and proxies for 60 seconds; the API itself always answers
from the database.)

## Rate limit and logs

The app restarted with `RATE_LIMIT_DEFAULT=3/1m` (the default limit counts per route, per IP):

```
GET /home #1: 200
GET /home #2: 200
GET /home #3: 200
GET /home #4: 429
Retry-After: 60
{"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again shortly.","details":null,"correlationId":"73a24cfd-…"}}
GET /theaters (its own counter): 200
```

A request line of `/home` (no body, no personal data):

```
{"level":"info","time":"2026-10-20T22:53:00.214Z","pid":14705,"hostname":"vm","correlationId":"881a213d-…","method":"GET","route":"/api/v1/home","statusCode":200,"responseTime":68,"principalKind":null,"principalId":null,"msg":"request completed"}
```

The app was then restarted with the default limits.
