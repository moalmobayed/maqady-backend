---
title: "#29 P5 — Manual QA: seed data, staging freshness"
owner: Mohamed Tarek
status: Done
last_verified: 2026-11-13
tags: [seed, datasets, staging, qa, frontend-gaps]
---

# #29 P5 — Manual QA

Run on 2026-11-13 (cinema date 2026-11-13, evening in Cairo) in the P5 worktree, against a local
Postgres 16 database `maqady_p5_dev`, the app on port 3134 (`node dist/main.js`),
`STORAGE_DRIVER=local`, `EMAIL_DRIVER=simulated`. Picture downloads went through the session's
proxy (`NODE_USE_ENV_PROXY=1`). Responses are trimmed to the fields that matter.

## 1. A database seeded before this change gets the new values (back-fill)

The `egypt-2026` dataset as it was before P5 (`git checkout 35c622e -- src/modules/seed`) seeded a
fresh database, then the P5 seed ran against it:

```
$ SEED_DATASET=egypt-2026 npm run seed          # the seed before P5
theaters: 8 created ... halls: 66 created ... movies: 13 created ... showtimes: 1482 created

$ git checkout HEAD -- src/modules/seed && SEED_DATASET=egypt-2026 npm run seed
{"level":"fatal","msg":"The seed failed","err":{"message":"Seed: the picture https://upload.wikimedia.org/
  wikipedia/commons/thumb/b/b9/City_stars_022.jpg/1920px-City_stars_022.jpg answered 429 text/html; ..."}}
```

**Finding (fixed in `ba4d7bd`).** Wikimedia rate-limited the third City Stars photo after four
quick tries (its `Retry-After` was shorter than its limit), and the next run, seeing a gallery of
two photos, would have added none. The fix: a gallery whose captions are the dataset's first ones,
in order, gets the rest; each retry waits the longer of `Retry-After` and 5 s per attempt, over 6
attempts. Unit tests added for both. After the fix:

```
$ SEED_DATASET=egypt-2026 npm run seed
theaters: 0 created, 8 already there
halls: 3 created, 66 already there          # Almaza Hall 9 and 10, Mall of Egypt Hall 10
showtimes: 64 created, 1157 already there   # re-packed VOX slots; ones meeting an old slot are skipped
$ SEED_DATASET=egypt-2026 npm run seed      # the gallery finished, then nothing left to do
halls: 0 created, 69 already there
showtimes: 0 created, 1221 already there
```

What the database then held (`psql`, schema `maqady`):

```
theaters: name | postal_code | whatsapp
VOX City Centre Almaza|11799|        City Stars Cinema|11765|      Cairo Festival Scene|11835|
Cosmos Cinema|11669|                 Galaxy El Manyal|11555|        VOX Mall of Egypt||
Galaxy Cineplex Mall of Arabia||     Cairo Mall Cinema||

facilities: VOX Mall of Egypt|food_court,cafe_bar,free_parking,wheelchair_access,prayer_room
            VOX City Centre Almaza|food_court,cafe_bar,free_parking,wheelchair_access

movies: Mahmoud El Tany|6.9|elCinema users   Matloub Aaeleyan|4.5|elCinema users
        Red Flag|4.8|elCinema users          Shish Doo|4.2|elCinema users
        Wala Kan Ala El-Bal|7.0|elCinema users   El Gawahergy|5.9|elCinema users
        Khally Balak Min Nafsak|7.2|elCinema users   Naseeb|4.3|elCinema users
        Saqr w Kanarya|7.3|elCinema users    Hadoota|| Crypto|| Mamsos|| Leila Bazet Khales||

halls (non-standard): VOX City Centre Almaza Hall 1 max; Hall 2, 3, 4 vip
                      VOX Mall of Egypt Hall 1, 2, 3, 4 vip

gallery: City Stars Cinema 4 photos, Cosmos Cinema 2 photos, captions crediting author and licence
```

The same back-fill with the `demo` dataset (the pre-P5 demo seeded into the same database, then
P5's) gave every Maqady theater its postal code (Sheikh Zayed none) and WhatsApp number, a third
gallery photo (`The VIP lounge`, …) after its first ones, `prayer_room` at New Cairo and Sheikh
Zayed, `Hall 1` formats and screens (Heliopolis `imax` 2210 × 1230 cm), the new `Hall 2` at
Zamalek and New Cairo, and `Demo audience` scores on the 7 Now showing movies. Both runs then
stopped at `featured` with `409 FEATURED_POSITION_TAKEN`: the egypt-2026 movies hold positions 1
to 5. That is the documented "seed an empty database" rule, not new (follow-up below); staging's
carousel is egypt-2026's (checked on `GET /home`: Naseeb, Matloub Aaeleyan, Wala Kan Ala El-Bal,
Saqr w Kanarya, El Gawahergy), so the daily egypt-2026 run keeps it.

## 2. A fresh database, seeded twice

```
$ dropdb maqady_p5_dev && createdb maqady_p5_dev && rm -rf .media
$ SEED_DATASET=egypt-2026 npm run seed          # 137 s
theaters: 8 created, 0 already there
halls: 69 created, 0 already there
publish-theaters: 8 created, 0 already there
people: 118 created, 0 already there
movies: 13 created, 0 already there
featured: 5 created, 0 already there
showtimes: 1513 created, 0 already there
$ SEED_DATASET=egypt-2026 npm run seed          # 19 s
theaters: 0 created, 8 already there
halls: 0 created, 69 already there
... showtimes: 0 created, 1513 already there
```

## 3. The routes, with the seeded data

`B=localhost:3134/api/v1`. The demo dataset was added on top (as on staging) for the examples
of WhatsApp and screen size.

**`GET $B/theaters?limit=20`**: `totalHalls` at the root, `postalCode` on the cards.

```json
{"nextCursor": null, "total": 13, "totalHalls": 76}
3  Cairo Festival Scene  Cairo 11835  7 halls
2  City Stars Cinema     Cairo 11765  10 halls
6  VOX Mall of Egypt     Giza  null   10 halls  [..., "food_court", "prayer_room"]
12 Maqady New Cairo      Cairo 11835  2 halls   [..., "prayer_room"]
```

**`GET $B/theaters/2`** (City Stars): gallery from Wikimedia Commons, no WhatsApp published.

```json
{"id": 2, "name": "City Stars Cinema", "city": "Cairo", "postalCode": "11765", "whatsapp": null,
 "whatsappUrl": null,
 "photos": [{"id": 1, "caption": "Citystars mall: the atrium. Photo: Salehmetwaly, CC BY-SA 3.0, via Wikimedia Commons",
             "image": {"variants": [{"name": "small", "width": 480, "height": 320}, {"name": "medium", ...},
                                    {"name": "large", "width": 1600, "height": 1067}]}},
            ... 4 photos],
 "halls": [{"id": 11, "name": "Hall 1", "seatCount": 192, "format": "standard", "screen": null}, ...]}
```

The stored `medium.webp` was opened and checked by eye: the Citystars atrium, sharp at 1024 px.

**`GET $B/theaters/6`** (VOX Mall of Egypt): prayer room, Gold/VIP halls as `vip`, no source for a
screen size.

```json
{"postalCode": null, "facilities": ["wheelchair_access", "free_parking", "cafe_bar", "food_court", "prayer_room"],
 "photos": [],
 "halls": [{"name": "Hall 1", "format": "vip", "screen": null}, {"name": "Hall 2", "format": "vip", ...},
           {"name": "Hall 3", "format": "vip"}, {"name": "Hall 4", "format": "vip"}, {"name": "Hall 5", "format": "standard"}, ...]}
```

**`GET $B/theaters/11`** (Maqady Heliopolis, demo): WhatsApp and a screen size.

```json
{"postalCode": "11757", "whatsapp": "+201223456789", "whatsappUrl": "https://wa.me/201223456789",
 "photos": [{"caption": "The kids room"}, {"caption": "The IMAX hall"}, {"caption": "The ticket hall"}],
 "halls": [{"id": 72, "name": "Hall 1", "format": "imax", "screen": {"widthMeters": 22.1, "heightMeters": 12.3}}]}
```

**`GET $B/theaters/1/showtimes?date=2026-11-14`** (VOX City Centre Almaza): movies with nested
showtimes, hall, format and price.

```json
{"theaterId": 1, "cinemaDate": "2026-11-13",
 "days": [{"cinemaDate": "2026-11-14", "movies": [{
   "movie": {"id": 2, "title": "Matloub Aaeleyan", "rating": 4.5, "runtimeMinutes": 135, "ageRating": "12+",
             "genres": [{"slug": "comedy"}]},
   "showtimes": [
     {"startsAt": "2026-11-14T12:30:00+02:00", "hall": {"id": 1, "name": "Hall 1"}, "format": "max", "fromPrice": {"amount": 18000, "currency": "EGP"}},
     {"startsAt": "2026-11-14T13:30:00+02:00", "hall": {"id": 3, "name": "Hall 3"}, "format": "vip", ...},
     {"startsAt": "2026-11-14T15:00:00+02:00", "hall": {"id": 5, "name": "Hall 5"}, "format": "standard", ...}]}]}]}
```

**`GET $B/movies/2/showtimes`** (Matloub Aaeleyan): the matrix, 7 cinema days.

```json
days: ["2026-11-13", "2026-11-14", ..., "2026-11-19"]
{"cinemaDate": "2026-11-14", "theater": {"id": 1, "name": "VOX City Centre Almaza"},
 "formats": ["standard", "vip", "max"],
 "showtimes": [{"id": 1, "startsAt": "2026-11-14T12:30:00+02:00", "endsAt": "2026-11-14T14:45:00+02:00",
                "hall": {"id": 1, "name": "Hall 1"}, "format": "max",
                "prices": {"front": {"amount": 18000, "currency": "EGP"}, ...}, "hasStarted": false}, ...]}
```

**`GET $B/movies?limit=2`**: facets over every matching movie, show dates now counted.

```json
{"total": 16, "tabCounts": {"nowShowing": 16, "comingSoon": 8},
 "facets": {"genres": [{"slug": "action", "count": 3}, {"slug": "adventure", "count": 1}, {"slug": "comedy", "count": 12}, ...],
            "people": [{"id": 128, "fullName": "Dina Sherif", "count": 2}, ...],
            "showDates": [{"value": "today", "count": 6, "cinemaDates": ["2026-11-13"]},
                          {"value": "tomorrow", "count": 8, "cinemaDates": ["2026-11-14"]},
                          {"value": "weekend", "count": 8, "cinemaDates": ["2026-11-13", "2026-11-14"]}]},
 "items": [{"id": 20, "title": "Garden City Romance", "rating": 6.2}, {"id": 16, "title": "Sandstorm Protocol", "rating": 6.6}]}
```

**`GET $B/movies/8`** (Naseeb): the score, and the fields elCinema does not publish.

```json
{"id": 8, "title": "Naseeb", "rating": 4.3, "ratingSource": "elCinema users",
 "productionCompany": "Albatros Production", "budgetLabel": null, "filmingLocations": null,
 "showtimeSummary": {"nextShowToday": {"startsAt": "2026-11-13T22:00:00+02:00", "theater": {"name": "VOX City Centre Almaza"},
                     "hall": {"name": "Hall 10"}, "fromPrice": {"amount": 18000, "currency": "EGP"}},
                     "cinemaCount": 7, "fromPrice": {"amount": 9000, "currency": "EGP"}}}
```

**`GET $B/movies/8/similar`**: 4 cards with scores.

```
4 [(20, 'Garden City Romance', 6.2), (5, 'Wala Kan Ala El-Bal', 7), (9, 'Saqr w Kanarya', 7.3), (15, 'Nile After Midnight', 7.1)]
```

**`GET $B/home`**: the ticker has showtimes again (6 still to start that evening), cards carry
`rating` and `postalCode`.

```json
{"ticker": 6 items, "nowShowing.items[0]": {"title": "Garden City Romance", "rating": 6.2},
 "cinemas": [{"name": "Cairo Festival Scene", "city": "Cairo", "postalCode": "11835"},
             {"name": "Cairo Mall Cinema", "city": "Giza", "postalCode": null}]}
```

**`GET $B/genres`**: `movieCount` per genre: `[('action', 3), ('adventure', 2), ('animation', 2), ('comedy', 15), ('drama', 4)]`.

## 4. The workflow

```
$ python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/seed-staging.yml')); print(d[True]['schedule'], d['jobs']['seed']['env']['SEED_DATASET'])"
[{'cron': '17 5 * * *'}] ${{ github.event_name == 'workflow_dispatch' && inputs.dataset || 'egypt-2026' }}
$ npx prettier --check .github/workflows/seed-staging.yml
All matched files use Prettier code style!
```

The schedule cannot be exercised locally; GitHub runs it from the default branch's copy of the
workflow once merged there.

## 5. Log hygiene

`p5-app.log` (the app during the curls) and the seed logs carry request ids, routes and status
codes only: no postal code, WhatsApp number or caption values were logged.
