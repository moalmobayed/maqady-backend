---
title: P1 (#29) — Movies list facets manual QA
owner: Mohamed Tarek
status: Passed
last_verified: 2026-11-13
tags: [qa, discovery, movies, facets, curl]
---

# P1 (#29) — Movies list facets: manual QA

Run on Friday 2026-11-13 at about 15:50 Cairo time (13:50 UTC), on the real clock, against
`maqady_p1_dev` seeded with `npm run seed` (demo dataset: 12 movies, 7 Now showing, 4 Coming
soon and the draft "Echoes of Abydos" (mystery, thriller); 18 people; 5 active theaters; 139
showtimes over the week from the seed day). The app ran from the build (`node dist/main.js`) on
port 3130, with `DEBUG=knex:query` for the query counts. `$API` is
`http://localhost:3130/api/v1`. Responses are trimmed with `jq` to the fields that matter.

The cinema date was 2026-11-13, a Friday, so This weekend is the 13th and the 14th.

## Default tab, page of 2

```bash
curl -s -i "$API/movies?limit=2" | grep -i "^HTTP\|cache-control"
curl -s "$API/movies?limit=2" | jq -c '{total, nextCursor, tabCounts,
  genres: [.facets.genres[] | "\(.slug):\(.count)"], peopleTotal: .facets.peopleTotal,
  showDates: .facets.showDates}'
curl -s "$API/movies?limit=2" | jq -c '.facets.people[0] | {id, fullName, count,
  photo: {alt: .photo.alt, variants: [.photo.variants[].name]}}'
```

```text
HTTP/1.1 200 OK
Cache-Control: public, max-age=60
{"total":7,"nextCursor":"WyIyMDI2LTExLTA4IiwzXQ","tabCounts":{"nowShowing":7,"comingSoon":4},
 "genres":["action:1","adventure:1","animation:1","comedy:3","drama:2","family:2","mystery:1",
           "romance:2","sci-fi:1","thriller:2"],
 "peopleTotal":10,
 "showDates":[{"value":"today","count":7,"cinemaDates":["2026-11-13"]},
              {"value":"tomorrow","count":7,"cinemaDates":["2026-11-14"]},
              {"value":"weekend","count":7,"cinemaDates":["2026-11-13","2026-11-14"]}]}
{"id":10,"fullName":"Dina Sherif","count":2,"photo":{"alt":"Dina Sherif","variants":["small","medium","large"]}}
```

The page holds 2 movies; the facets count all 7, every genre listed alphabetically, the
discovery cache header unchanged. Counted by hand over the whole tab (`limit=100`):

```bash
curl -s "$API/movies?limit=100" | jq -c '[.items[].genres[].slug] | group_by(.) | map("\(.[0]):\(length)")'
```

```text
["action:1","adventure:1","animation:1","comedy:3","drama:2","family:2","mystery:1","romance:2","sci-fi:1","thriller:2"]
```

Equal to the facet. The draft's mystery and thriller are not counted (mystery 1 and thriller 2
are the Now showing movies').

## Each facet ignores its own filter and follows the others

```bash
curl -s "$API/movies?genres=comedy" | jq -c '{total,
  genres: [.facets.genres[] | select(.count>0) | "\(.slug):\(.count)"],
  people: [.facets.people[] | "\(.fullName):\(.count)"],
  showDates: [.facets.showDates[] | "\(.value):\(.count)"]}'
```

```text
{"total":3,"genres":["action:1","adventure:1","animation:1","comedy:3","drama:2","family:2","mystery:1","romance:2","sci-fi:1","thriller:2"],
 "people":["Mariam Fouad:2","Hany Mansour:1","Karim Fahmy:1","Laila Hassan:1","Omar Zaki:1","Salma Adel:1"],
 "showDates":["today:3","tomorrow:3","weekend:3"]}
```

The genre filter leaves every genre's count as it was, and narrows the cast (10 to 6, by count
then name) and the show dates (7 to 3).

```bash
curl -s "$API/movies?people=1" | jq -c '{items: [.items[].title],
  genres: [.facets.genres[] | select(.count>0) | "\(.slug):\(.count)"], peopleTotal: .facets.peopleTotal}'
curl -s "$API/movies?people=1" | jq -c '[.facets.people[:3][] | "\(.fullName):\(.count)"]'
```

```text
{"items":["Garden City Romance","The Last Lighthouse"],"genres":["comedy:1","drama:1","mystery:1","romance:1"],"peopleTotal":10}
["Dina Sherif:2","Hany Mansour:2","Karim Fahmy:2"]
```

Filtering by Karim Fahmy narrows the genres to his two movies; the cast stays whole (10).

```bash
curl -s "$API/movies?q=lighthouse" | jq -c '{items: [.items[].title],
  genres: [.facets.genres[] | select(.count>0) | "\(.slug):\(.count)"],
  people: [.facets.people[] | "\(.fullName):\(.count)"],
  showDates: [.facets.showDates[] | "\(.value):\(.count)"]}'
```

```text
{"items":["The Last Lighthouse"],"genres":["drama:1","mystery:1"],"people":["Karim Fahmy:1","Nour El-Sayed:1","Youssef Rizk:1"],"showDates":["today:1","tomorrow:1","weekend:1"]}
```

## Show dates

```bash
curl -s "$API/movies?showDate=today" | jq -c '{total, tabCounts,
  showDates: [.facets.showDates[] | "\(.value):\(.count)"]}'
for v in today tomorrow weekend; do echo -n "showDate=$v total: "; curl -s "$API/movies?showDate=$v" | jq .total; done
```

```text
{"total":7,"tabCounts":{"nowShowing":7,"comingSoon":4},"showDates":["today:7","tomorrow:7","weekend:7"]}
showDate=today total: 7
showDate=tomorrow total: 7
showDate=weekend total: 7
```

Every count equals what the filter lists, and the `showDate` filter does not change the
show-date counts. (The demo seed schedules every Now showing movie every day, so the counts are
equal here; the Clock-driven cases, started and after-midnight showtimes, paused and draft
theaters and the Saturday and Sunday weekends, are proven with a fixed Clock in
`test/integration/modules/discovery/movie-facets-showtimes.test.ts`.)

## Coming soon tab

```bash
curl -s "$API/movies?status=coming_soon" | jq -c '{items: [.items[].title],
  genres: [.facets.genres[] | select(.count>0) | "\(.slug):\(.count)"],
  people: [.facets.people[] | "\(.fullName):\(.count)"], showDates: .facets.showDates}'
```

```text
{"items":["Desert Signal","The Cartographer of Siwa","Midnight at Ramses Station","Paper Kites over Giza"],
 "genres":["adventure:1","animation:1","drama:1","family:1","mystery:2","sci-fi:1","thriller:1"],
 "people":["Dina Sherif:1","Laila Hassan:1","Nour El-Sayed:1","Omar Zaki:1","Salma Adel:1","Tarek Nabil:1","Youssef Rizk:1"],
 "showDates":[{"value":"today","count":0,"cinemaDates":["2026-11-13"]},{"value":"tomorrow","count":0,"cinemaDates":["2026-11-14"]},{"value":"weekend","count":0,"cinemaDates":["2026-11-13","2026-11-14"]}]}
```

## The draft never counts

```bash
psql -d maqady_p1_dev -Atc "SELECT m.title, m.status, string_agg(g.slug, ',') FROM maqady.movies m
  LEFT JOIN maqady.movie_genres mg ON mg.movie_id = m.id LEFT JOIN maqady.genres g ON g.id = mg.genre_id
  WHERE m.status NOT IN ('now_showing', 'coming_soon') GROUP BY m.id"
curl -s "$API/movies?q=abydos" | jq -c '{total, tabCounts, genres: [.facets.genres[] | select(.count>0)], people: .facets.people}'
```

```text
Echoes of Abydos|draft|mystery,thriller
{"total":0,"tabCounts":{"nowShowing":0,"comingSoon":0},"genres":[],"people":[]}
```

## Refusal unchanged

```bash
curl -s -i "$API/movies?status=coming_soon&showDate=today" | grep -i "^HTTP\|cache-control\|^{"
```

```text
HTTP/1.1 400 Bad Request
Cache-Control: no-store
{"error":{"code":"VALIDATION_FAILED","message":"The request is not valid.","details":{"fields":[{"field":"showDate","messages":["showDate applies to the now_showing tab only"]}]},"correlationId":"7abedc97-2983-4ad5-80c5-be1dd3b1bfdf"}}
```

## Query cost

Queries logged by `DEBUG=knex:query` per request (the difference in the log's line count):

```text
/movies?limit=1 -> 12 queries
/movies?limit=100 -> 12 queries
/movies?genres=comedy&people=1&q=ga -> 12 queries
/movies?status=coming_soon -> 12 queries
```

The same 12 whatever the page size or the filters: genres; active theater ids; the distinct
(movie, cinema date) pairs; the page and its total; the page's genres and posters; the tab
counts; the genre counts; the cast with `count(*) OVER ()`; the cast photos; the ids for the
show-date counts. A first run, before the theater read was narrowed to ids, cost 16 (the full
theater details, six queries, for ids only); commit `perf(discovery)` fixed it.

No error or warning in the server log during the run.

## Re-check after merging P2 (movie rating)

Run at 19:14 Cairo time the same day, after merging `main-jf8hqi` (P2 adds
`0290_11_add_movies_rating` and `rating` on the card), on the same database migrated with
`npm run migrate`, from a fresh build on port 3130.

```bash
curl -s "$API/movies?limit=2" | jq -c '{total, tabCounts, rating: [.items[].rating],
  genres: [.facets.genres[] | "\(.slug):\(.count)"], peopleTotal: .facets.peopleTotal,
  showDates: .facets.showDates}'
curl -s "$API/movies?genres=comedy&limit=2" | jq -c '{total, genres: [.facets.genres[] | "\(.slug):\(.count)"],
  peopleTotal: .facets.peopleTotal, showDates: [.facets.showDates[] | "\(.value):\(.count)"]}'
curl -s "$API/movies?showDate=tomorrow&limit=100" | jq -c '{total}'
```

```text
{"total":7,"tabCounts":{"nowShowing":7,"comingSoon":4},"rating":[null,null],
 "genres":["action:1","adventure:1","animation:1","comedy:3","drama:2","family:2","mystery:1",
           "romance:2","sci-fi:1","thriller:2"],
 "peopleTotal":10,
 "showDates":[{"value":"today","count":6,"cinemaDates":["2026-11-13"]},
              {"value":"tomorrow","count":7,"cinemaDates":["2026-11-14"]},
              {"value":"weekend","count":7,"cinemaDates":["2026-11-13","2026-11-14"]}]}
{"total":3,"genres":["action:1","adventure:1","animation:1","comedy:3","drama:2","family:2","mystery:1",
           "romance:2","sci-fi:1","thriller:2"],"peopleTotal":6,"showDates":["today:2","tomorrow:3","weekend:3"]}
{"total":7}
```

The facets sit beside P2's `rating` unchanged. Today is now 6, not 7: one movie's last showtime
of the day has started since the first run, so it no longer counts (the Clock rule). The comedy
filter leaves the genre counts as they were but narrows the cast and the show dates; the
Tomorrow count equals what `showDate=tomorrow` lists.
