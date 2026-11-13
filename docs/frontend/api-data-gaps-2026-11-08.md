---
title: "Answer to the API Data Gaps Report (2026-11-08)"
owner: Mohamed Tarek
status: Current
last_verified: 2026-11-13
tags: [frontend, api, discovery, staging, frontend-gaps]
---

# Answer to the API Data Gaps Report (2026-11-08)

Issue #29. For each item of your report: where the data is now, an example from a local run
(trimmed), and what only the cinemas can give us. Base URL
`https://maqady-backend.vercel.app/api/v1`; every field below is in Swagger (`/api/docs`) with a
description of what the UI shows.

## Why staging looked empty

The showtime routes you listed were there, but staging's seed had scheduled only the 7 days from
2026-10-29. Staging is now re-seeded every morning (05:17 UTC) with the real `egypt-2026`
dataset, so showtimes always cover today and the next 6 cinema days. A cinema day runs from
06:00 to 05:59 Cairo time; a show at 00:30 belongs to the evening before.

Staging also holds the invented `demo` dataset (the "Maqady …" theaters and their movies) beside
the real one. Its values are made up on purpose, so every new field has an example; the real
cinemas only carry what a public source confirms.

## Movies page

| # | You asked for | Where it is | Status |
|---|---|---|---|
| 1 | Movies per genre | `GET /movies` → `facets.genres[].count`, over every matching movie (pagination does not change it; the count ignores the `genre` filter itself). Also `GET /genres` → `movieCount` | New (`facets`); `movieCount` was already there |
| 2 | Actors for the sidebar | `GET /movies` → `facets.people[]` (`id`, `fullName`, `photo`, `count`); filter with `people=<id>,<id>` | New (`facets`); the filter was already there |
| 3 | SHOW DATE options | `GET /movies` → `facets.showDates[]` (`value`, `count`, `cinemaDates`); filter with `showDate=today\|tomorrow\|weekend` | New (`facets`); the filter was already there |

```json
GET /movies?limit=2
{"total": 16, "tabCounts": {"nowShowing": 16, "comingSoon": 8},
 "facets": {
   "genres": [{"id": 1, "name": "Action", "slug": "action", "count": 3},
              {"id": 4, "name": "Comedy", "slug": "comedy", "count": 12}, ...],
   "people": [{"id": 128, "fullName": "Dina Sherif", "photo": {...}, "count": 2}, ...],
   "showDates": [{"value": "today", "count": 6, "cinemaDates": ["2026-11-13"]},
                 {"value": "tomorrow", "count": 8, "cinemaDates": ["2026-11-14"]},
                 {"value": "weekend", "count": 8, "cinemaDates": ["2026-11-13", "2026-11-14"]}]},
 "items": [{"id": 20, "title": "Garden City Romance", "rating": 6.2, ...}, ...]}
```

## Theaters page

| # | You asked for | Where it is | Status |
|---|---|---|---|
| 4 | Total halls ("25 HALLS") | `GET /theaters` → `totalHalls` at the root, next to `total`; not affected by pagination | New |
| 5 | Facilities incl. Prayer room and Kids room | `facilities[]` on every theater card and page; the `Facility` enum in Swagger: `wheelchair_access`, `free_parking`, `valet_parking`, `street_parking`, `cafe_bar`, `food_court`, `kids_room`, `prayer_room` | `prayer_room` new; `kids_room` was already there |
| 6 | Postal code ("Cairo 11211") | `postalCode` (5 digits or `null`) on `GET /theaters` items, `GET /theaters/{id}` and the `GET /home` cinema cards; show it after `city` | New |

```json
GET /theaters?limit=20
{"items": [{"id": 2, "name": "City Stars Cinema", "city": "Cairo", "postalCode": "11765",
            "hallCount": 10, "facilities": ["wheelchair_access", "free_parking", "cafe_bar", "food_court"], ...},
           {"id": 6, "name": "VOX Mall of Egypt", "city": "Giza", "postalCode": null,
            "facilities": [..., "food_court", "prayer_room"], ...}],
 "nextCursor": null, "total": 13, "totalHalls": 76}
```

## Theater details

| # | You asked for | Where it is | Status |
|---|---|---|---|
| 7 | SHOWTIMES HERE | `GET /theaters/{id}/showtimes?date=YYYY-MM-DD` → `days[].movies[]`: the `movie` card (title, poster, genres, runtime, age rating, `rating`) and its `showtimes[]` with `startsAt`, `hall.name`, `format` and `fromPrice` / `prices` | Route was already there; `format` and `rating` new; now filled every day on staging |
| 8 | Photo gallery (3+) | `GET /theaters/{id}` → `photos[]` (`caption`, `image.variants` small/medium/large) | Route was already there. Real data: City Stars (4) and Cosmos (2), freely licensed Wikimedia Commons photos whose caption credits the photographer and licence: please show the caption. Demo theaters have 3 each |
| 9 | WhatsApp | `GET /theaters/{id}` → `whatsapp` (E.164) and `whatsappUrl` (`https://wa.me/…`, ready for the button); both `null` when the theater hides its contacts | New. No real cinema publishes a WhatsApp number, so they are `null`; the demo theaters have one |
| 10 | Hall screen size | `GET /theaters/{id}` → `halls[].screen` `{widthMeters, heightMeters}` or `null`, and `halls[].format` | New. No real cinema publishes its screen sizes, so they are `null`; the demo theaters have them |
| 11 | prayer_room facility | as item 5 | New |

```json
GET /theaters/11          (a demo theater, every field filled)
{"id": 11, "name": "Maqady Heliopolis", "city": "Cairo", "postalCode": "11757",
 "whatsapp": "+201223456789", "whatsappUrl": "https://wa.me/201223456789",
 "photos": [{"id": 10, "caption": "The kids room", "image": {"variants": [...]}}, ... 3 photos],
 "halls": [{"id": 72, "name": "Hall 1", "seatCount": 192, "format": "imax",
            "screen": {"widthMeters": 22.1, "heightMeters": 12.3}}]}

GET /theaters/1/showtimes?date=2026-11-14
{"theaterId": 1, "days": [{"cinemaDate": "2026-11-14", "movies": [{
  "movie": {"id": 2, "title": "Matloub Aaeleyan", "rating": 4.5, "runtimeMinutes": 135, "ageRating": "12+", ...},
  "showtimes": [
    {"startsAt": "2026-11-14T12:30:00+02:00", "hall": {"id": 1, "name": "Hall 1"}, "format": "max",
     "fromPrice": {"amount": 18000, "currency": "EGP"}},
    {"startsAt": "2026-11-14T13:30:00+02:00", "hall": {"id": 3, "name": "Hall 3"}, "format": "vip", ...}]}]}]}
```

`format` values: `standard`, `vip`, `imax`, `dolby_atmos` (show "Atmos"), `4dx`, `screenx`,
`max`. Prices are in piastres: `18000` is EGP 180.

## Movie details

| # | You asked for | Where it is | Status |
|---|---|---|---|
| 12 | Showtimes matrix by date and theater, with formats | `GET /movies/{id}/showtimes` → `days[].theaters[]` with `formats` (the formats that day, e.g. `["standard", "vip", "max"]`) and `showtimes[]` (`startsAt`, `hall`, `format`, `prices`) | Route was already there; `formats` and `format` new; now filled every day on staging |
| 13 | MORE LIKE THIS (4 cards) | `GET /movies/{id}/similar` | Already there |
| 14 | Rating score (8.4 ★) | `rating` (0–10, one decimal, or `null`) on `GET /movies/{id}`, on every movie card (`GET /movies`, `/similar`, `/home`, theater showtimes), and `ratingSource` on the details | New. The real films carry their elCinema user rating (`"ratingSource": "elCinema users"`); Coming soon films have none |
| 15 | productionCompany, filmingLocations, budget | `productionCompany`, `filmingLocations`, `budgetLabel` on `GET /movies/{id}` | Already there; the data is what is missing (below) |

```json
GET /movies/8
{"id": 8, "title": "Naseeb", "rating": 4.3, "ratingSource": "elCinema users",
 "productionCompany": "Albatros Production", "budgetLabel": null, "filmingLocations": null, ...}

GET /movies/2/showtimes
{"days": [{"cinemaDate": "2026-11-14", "theaters": [{
  "theater": {"id": 1, "name": "VOX City Centre Almaza", ...},
  "formats": ["standard", "vip", "max"],
  "showtimes": [{"id": 1, "startsAt": "2026-11-14T12:30:00+02:00", "hall": {"id": 1, "name": "Hall 1"},
                 "format": "max", "prices": {...}, "hasStarted": false}, ...]}, ...]}, ...]}

GET /movies/8/similar     → 4 cards, each with "rating"
```

## Data only the cinemas (or distributors) can give us

The API has a place for all of these; admins can fill them in the dashboard once we have them.

- **Budget and filming locations** of the real films: elCinema does not publish them, so all 13
  are `null`; 5 have no production company either. Hide the row when it is `null`.
- **Gallery photos** for VOX City Centre Almaza, Cairo Festival Scene, Galaxy El Manyal, VOX Mall
  of Egypt, Galaxy Cineplex Mall of Arabia and Cairo Mall Cinema: there is no free photo of them
  we may use. Show the cover alone, or a placeholder, when `photos` is empty.
- **WhatsApp numbers**: no cinema publishes one of its own. Hide the button when `whatsapp` is
  `null`.
- **Screen sizes**: not published by any cinema. Hide the size when `screen` is `null`.
- **Hall formats** outside VOX: the other cinemas list only standard shows, so their halls are
  `standard`.
- **Prayer rooms**: confirmed only at Mall of Egypt; the other malls very likely have one, but no
  source we could cite says so.
- **Postal codes** of the three Giza cinemas: `null` until confirmed.
