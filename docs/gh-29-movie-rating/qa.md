---
title: "#29 P2 — Movie rating score: manual QA"
owner: Mohamed Tarek
status: Done
last_verified: 2026-11-13
tags: [qa, catalog, discovery, rating, curl]
---

# #29 P2 — Movie rating score: manual QA

QA mode `curl` (CLAUDE.md). Evidence for every changed route of `docs/gh-29-movie-rating/spec.md`.

## Setup

- Worktree `unit/gh-29-movie-rating`, a fresh database `maqady_p2_dev` (local Postgres 16), the
  demo dataset seeded with `node dist/cli/seed.js` (migrations ran at boot, `0290_11` included;
  the demo dataset has no scores yet, so every movie starts unrated):

  ```text
  Created the seed admin seed-admin@maqady.local.
  Dataset: demo
  movies: 12 created, 0 already there
  showtimes: 139 created, 0 already there
  Done. Sign in to the dashboard as seed-admin@maqady.local.
  ```

- The built app (`node dist/main.js`) on port 3131. `B=http://localhost:3131/api/v1`; `$T` is the
  seed admin's access token from `POST $B/admin/auth/sessions`. Every write carries a fresh
  `Idempotency-Key`. Responses are trimmed to the fields under test.

## Admin: set, read, audit

1. Set a score and a source (the source is sent padded):

   ```bash
   curl -X PATCH $B/admin/movies/3 -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
     -H "Idempotency-Key: $(uuid)" -d '{"rating":8.4,"ratingSource":"  elCinema users "}'
   ```

   ```text
   {'id': 3, 'title': 'Sandstorm Protocol', 'rating': 8.4, 'ratingSource': 'elCinema users'} HTTP200
   ```

2. `GET $B/admin/movies/3`: `{'id': 3, 'rating': 8.4, 'ratingSource': 'elCinema users'}`.

3. The audit row names the fields, never the values:

   ```text
   $ psql … -c "select action, changed_fields, metadata from maqady.audit_events
                where entity_type='movie' and entity_id=3 and action='movie.updated' order by id desc limit 1"
   movie.updated|{rating,ratingSource}|{}
   ```

4. A score without a source: `PATCH /admin/movies/2 {"rating":6}` → `HTTP 200`.

5. Create with a score and a source:
   `POST /admin/movies {"title":"QA rated draft","rating":7.3,"ratingSource":"IMDb users"}` →

   ```text
   {'id': 13, 'title': 'QA rated draft', 'status': 'draft', 'rating': 7.3, 'ratingSource': 'IMDb users'} HTTP201
   ```

## Public: details and cards

6. `GET $B/movies/3` (details hero):

   ```text
   HTTP/1.1 200 OK
   Cache-Control: public, max-age=60
   {'id': 3, 'title': 'Sandstorm Protocol', 'rating': 8.4, 'ratingSource': 'elCinema users'}
   ```

   `GET $B/movies/2`: `{'id': 2, 'rating': 6, 'ratingSource': None}` (score shown alone).

7. `GET $B/movies?limit=4` (Movies page cards):

   ```text
   7 Garden City Romance rating= None
   3 Sandstorm Protocol rating= 8.4
   2 Nile After Midnight rating= 6
   1 The Last Lighthouse rating= None
   ```

8. `GET $B/movies/3/similar` ("More like this"): `5 Red Sea Rising rating= None` (every card
   carries the key).

9. `GET $B/home` (`nowShowing` cards; the carousel's `FeaturedMovieDetails` is unchanged):

   ```text
   7 Garden City Romance rating= None
   3 Sandstorm Protocol rating= 8.4
   2 Nile After Midnight rating= 6
   1 The Last Lighthouse rating= None
   featured movie keys: ['ageRating', 'genres', 'id', 'releaseDate', 'runtimeMinutes', 'status', 'synopsis', 'title']
   ```

10. `GET $B/theaters/1/showtimes` (its movies are `MovieCard`s):

    ```text
    6 Little Falafel Detectives rating= None
    2 Nile After Midnight rating= 6
    3 Sandstorm Protocol rating= 8.4
    1 The Last Lighthouse rating= None
    ```

11. The served document (`GET /api/docs/openapi.json`):

    ```text
    MovieCard.rating {'type': 'number', 'nullable': True, 'minimum': 0, 'maximum': 10, 'example': 8.4} required: False
    MovieDetails required rating/ratingSource: True True
    ```

## Refusals

12. `PATCH /admin/movies/2` with a bad score or source, each `HTTP 400 VALIDATION_FAILED`:

    ```text
    {"rating":10.1}  [{'field': 'rating', 'messages': ['rating must not be greater than 10']}]
    {"rating":-0.5}  [{'field': 'rating', 'messages': ['rating must not be less than 0']}]
    {"rating":8.45}  [{'field': 'rating', 'messages': ['rating must be a number with at most one decimal place']}]
    {"rating":"8.4"} [{'field': 'rating', 'messages': ['rating must not be greater than 10', 'rating must not be less than 0', 'rating must be a number …']}]
    {"rating":8,"ratingSource":"a"×81} [{'field': 'ratingSource', 'messages': ['ratingSource must be shorter than or equal to 80 characters']}]
    ```

    (The `8.45` line is from the build with the clearer message, commit "fix(catalog): say why a
    score with more than one decimal is refused"; before it the message was class-validator's
    default "rating must be a number conforming to the specified constraints". Movie 2 kept
    `rating: 6` throughout.)

13. A source without a score, each `HTTP 400`:

    ```text
    PATCH /admin/movies/5 {"ratingSource":"elCinema users"}   (movie 5 has no score)
    POST  /admin/movies   {"title":"QA source only","ratingSource":"elCinema users"}
    PATCH /admin/movies/3 {"rating":null}                     (movie 3 has a source)
    → VALIDATION_FAILED [{'field': 'ratingSource', 'messages': ['ratingSource needs a rating: set rating too, or send ratingSource: null']}]
    ```

    Movie 3 after the refused clear: `{'id': 3, 'rating': 8.4, 'ratingSource': 'elCinema users'}`.

14. Clearing both together: `PATCH /admin/movies/3 {"rating":null,"ratingSource":null}` →
    `{'id': 3, 'rating': None, 'ratingSource': None} HTTP200`; `GET /movies/3` answers the same
    nulls. The movie's `movie.updated` rows:

    ```text
    movie.updated|{backdropPhotoId,heroVideoId}     (the seed)
    movie.updated|{rating,ratingSource}             (step 1)
    movie.updated|{rating,ratingSource}             (step 14)
    ```

## Database

15. After restoring movie 3's score:

    ```text
    $ psql … -c "select id, title, rating, rating_source from maqady.movies where rating is not null order by id"
    2|Nile After Midnight|6.0|
    3|Sandstorm Protocol|8.4|elCinema users
    13|QA rated draft|7.3|IMDb users

    $ psql … -c "update maqady.movies set rating_source='x' where id=5"
    ERROR:  new row for relation "movies" violates check constraint "chk_movies_rating_source_needs_rating"
    ```

16. Log hygiene: `grep -c "elCinema\|IMDb users\|8.4"` over both server logs of the session → `0`.

## Seed

The `movies` step's set and back-fill are proven against the real app over HTTP in
`test/integration/modules/seed/seed.steps.test.ts` (both datasets carry no scores until P5 fills
them, so a manual re-seed here changes nothing): created with `8.4 / elCinema users`, `6 / none`
and no score; after the scores were emptied in the database, a second run set them again with one
`PATCH` (`movie.updated` naming `rating` and `ratingSource`) and left alone a score an admin had
set (5.5).
