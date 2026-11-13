---
title: "#29 P5 — Seed data for the new fields, staging freshness and the frontend answer"
owner: Mohamed Tarek
status: Built
last_verified: 2026-11-13
tags: [seed, datasets, staging, ci, frontend-gaps, docs]
---

# #29 P5 — Seed data for the new fields, staging freshness and the frontend answer

Issue: #29 (API Data Gaps Report, 2026-11-08), package P5. Docs folder:
`docs/gh-29-seed-staging-data/`. Migration range `0290_41` to `0290_49`: none used, no schema
change. Builds on P2 (movie rating score), P3 (prayer room, postal code, WhatsApp, total halls),
P4 (hall format and screen size), U8a/U8b (discovery and the development seed) and the
`egypt-2026` dataset. Design: `docs/system-design.md` §14 (the development seed) and §11
(delivery).

## Goal

P1 to P4 gave the API every field the frontend report asks for, but staging showed most of them
empty: the seed had no values for the new fields, and its week of showtimes ran out a week after
it last ran (2026-10-29), so the showtime lists, the movie matrix and the show-date counts were
empty too. This package:

1. fills the new fields in both seed datasets, with real, cited values in `egypt-2026` and
   invented example values in `demo`;
2. back-fills them on the rows a deployment already holds, idempotently;
3. keeps staging's showtimes current with a daily scheduled seed;
4. answers the frontend developer, item by item: where each piece of data is now.

## Scope

### `egypt-2026` dataset (`src/modules/seed/datasets/egypt-2026.ts`)

Only values a public source confirms; the rest stays empty. Sources are named in the file's
header comment and per entry.

- **Ratings**: each Now showing film's elCinema user rating out of 10 (its film page,
  `stars-rating-lg`, collected 2026-10-29), `ratingSource: 'elCinema users'`. The four Coming
  soon films have rating disabled on elCinema, so they have none.
- **Postal codes**: the 5-digit code of the Egypt Post office serving the cinema's street or
  district (Egypt Post's office list as published by egpostal.com; the Fifth Settlement code from
  two independent listings). Five of the eight cinemas; the three Giza cinemas stay `null`
  because no office could be matched to their address with confidence.
- **Prayer room**: VOX Mall of Egypt only. The mall's own facilities page says "Male and female
  prayer rooms are located at the G1 and C1 entrances". No source confirmed one for the other
  malls, so they are left without.
- **Hall formats**: elCinema lists each showtime's experience at the two VOX cinemas (MAX, Gold,
  VIP, Kids, Standard). Their slots are re-packed into halls by experience: MAX is `max`, Gold
  and VIP are `vip`, Standard and Kids are `standard`. VOX City Centre Almaza has one MAX screen
  (VOX's 2019 opening release lists its 16 screens and their experiences) and ran three Gold
  shows at once, so at most one `max` and three `vip` halls there; a show the estimated runtime
  keeps out of them plays in a standard hall. Same-time shows of one film in two experiences,
  which the dataset had merged, are separate slots again. The other six cinemas list only
  Standard, so their halls stay `standard`. **Screen sizes**: no public source gives one for any
  of these halls, so all stay `null`.
- **Gallery photos**: Wikimedia Commons photos under a free licence, each caption naming the
  author and the licence: four of the Citystars mall (CC BY-SA 3.0 and 4.0) for City Stars
  Cinema and two of the Cosmos Cinema building (CC BY-SA 4.0). Commons has no usable free photo
  of the other six (the Mall of Egypt and Mall of Arabia files are promotional renderings
  uploaded as own work, so they are not used). Downloaded through Wikimedia's standard 1920 px
  thumbnails, as the other pictures are.
- **WhatsApp**: none. No cinema of the dataset publishes a WhatsApp number of its own (the
  malls' WhatsApp lines are not the cinemas'), so every one stays `null`.

### `demo` dataset (`src/modules/seed/seed-data.ts`)

Invented example data so every new field has a value to render:

- a postal code on five theaters and a WhatsApp number on four (Sheikh Zayed has neither);
- `prayer_room` on Maqady New Cairo and Maqady Sheikh Zayed;
- `Hall 1` of each published theater gets a format and screen size (`vip`, `standard`, `imax`
  22.1 m × 12.3 m, `dolby_atmos`, `max`), and Zamalek and New Cairo get a `Hall 2` (`standard`
  and `4dx`) with two daily slots each, so their movie matrix days show two formats;
- a `rating` (with `ratingSource: 'Demo audience'`) on the seven Now showing movies;
- at least three gallery photos (generated) on every published theater.

### Seed (`src/modules/seed/`)

- `SeedTheater.galleryCaptions` becomes `gallery: readonly SeedGalleryPhoto[]`, each a
  `caption` and an optional `url` (left out, a generated picture, as before). The `theaters`
  step uploads them on a theater whose gallery is empty, as before.
- Facilities back-fill: a theater whose stored facilities are exactly the dataset's minus the
  facilities #29 added (`prayer_room`, `SEED_BACKFILL_FACILITIES`) gets the dataset's list. A
  theater whose facilities an admin changed otherwise is left alone, like the other back-fills.
- `downloadedImage` retries a picture that answers `429` or `5xx` (up to
  `SEED_IMAGE_ATTEMPTS`, waiting `Retry-After` capped at 30 s, else 5 s per attempt):
  Wikimedia rate-limits bursts of thumbnail requests.
- The postal code, WhatsApp, rating and hall back-fills of P2 to P4 are unchanged; this package
  supplies their values.

### Staging freshness (`.github/workflows/seed-staging.yml`)

- A daily `schedule` (`17 5 * * *`: 05:17 UTC, 07:17 Cairo time in winter and 08:17 in summer,
  after the 06:00 turnover of the cinema day) runs `npm run seed:remote` with
  `SEED_DATASET=egypt-2026`. The seed schedules the server's cinema date and the 6 after, so
  each morning the showtimes cover the next 7 cinema days. Manual runs keep the `dataset` input
  (default `demo`); a scheduled run always uses `egypt-2026`.
- README: the schedule, that staging also holds the demo dataset, and how to reset it to one
  dataset.

### Frontend answer

`docs/frontend/api-data-gaps-2026-11-08.md`: for each of the 15 items of the report, the route
and field that carries it, an example from local QA, which items were already available, and
which data only the cinemas can provide.

## Out of scope

- Any schema, endpoint or DTO change (P1 to P4 own them). No migration.
- Per-format ticket prices: a theater has one zone price list; the VOX Gold and MAX prices on
  elCinema are not modelled. Follow-up.
- Renaming or removing halls already on staging: re-packed slots go to halls by name; a hall that
  no slot uses any more stays active with no showtimes.
- Clearing staging's demo dataset: the README says how; doing it is a manual decision.
- Runtimes: still the dataset's estimates; the estimate rule (repeat interval minus 15 minutes)
  is why two MAX and two Gold shows at Almaza do not fit one hall with the 20-minute gap.

## Migrations

None.

## Endpoints and fields

No route or DTO changes. The routes whose answers now carry seed values for fields P1 to P4
added:

| Route | Fields now filled by the seed |
|---|---|
| `GET /movies`, `GET /movies/{id}`, `GET /movies/{id}/similar`, `GET /home` (cards) | `rating`, `ratingSource` (details) |
| `GET /theaters` | `items[].postalCode`, `items[].facilities` with `prayer_room`, `totalHalls` |
| `GET /theaters/{id}` | `postalCode`, `whatsapp`, `whatsappUrl`, `facilities`, `photos` (gallery), `halls[].format`, `halls[].screenWidthMeters`, `halls[].screenHeightMeters` |
| `GET /theaters/{id}/showtimes` | `days[].movies[].showtimes[].format`, `.hall`, `.price`; `movies[].rating` |
| `GET /movies/{id}/showtimes` | `days[].theaters[].formats`, `.showtimes[].format` |

## Tests

- `test/unit/modules/seed/datasets/index.test.ts`, for every dataset: ratings within 0 to 10
  with one decimal, a source only with a rating; postal codes 5 digits; WhatsApp numbers E.164;
  every picture URL (gallery included) `https://`; gallery captions within 120 characters; hall
  formats from `HALL_FORMATS`, screen sizes in range with two decimals and both sides or none.
  For `egypt-2026`: the ratings and ratingSource match the elCinema values; only VOX Mall of
  Egypt has a prayer room; gallery photos come from Wikimedia standard thumbnails and credit a
  free licence; no WhatsApp; at most one MAX hall at Almaza.
- `test/unit/modules/seed/seed.steps.test.ts`: gallery photos with a URL are downloaded (and
  without, generated); the facilities back-fill adds `prayer_room` to a theater seeded before
  #29 and leaves one an admin changed.
- `test/unit/modules/seed/seed-images.test.ts`: a `429` then `200` succeeds after one retry,
  honouring `Retry-After`; a persistent `429` fails naming the URL; a `404` is not retried.
- Existing seed integration tests (both datasets' shapes, the remote seed) stay green.

## Acceptance

- The gates pass (typecheck, lint, tests, build, contract unchanged).
- `SEED_DATASET=egypt-2026 npm run seed` on a fresh database succeeds, and a second run creates
  nothing.
- On a database seeded with `egypt-2026` before this change, a run back-fills ratings, postal
  codes, the prayer room, the gallery photos and the VOX hall formats.
- The workflow YAML parses and has the schedule and the dataset rule.
- `docs/frontend/api-data-gaps-2026-11-08.md` exists with its `docs/INDEX.md` row.
