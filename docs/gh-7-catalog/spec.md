---
title: U6 — Catalog - genres, movies, people, credits, photos, YouTube videos, featured
owner: Mohamed Tarek
status: In progress
last_verified: 2026-10-20
tags: [catalog, movies, people, credits, genres, youtube, photos, featured, publishing, admin]
---

# U6 — Catalog: genres, movies, people, credits, photos, YouTube videos, featured

Issue: #7. Docs folder: `docs/gh-7-catalog/`. Migration prefix `0070`. Depends on U2a
(`staff_users`, `StaffService`, the staff resolver, `test/support/staff-auth.ts`,
`test/support/routes.ts`) and U4a (`images`, `MediaModule`, `MediaService`, `@ImageUpload()`).
Design: `docs/system-design.md` §5, §6.1, §6.2 (catalog), §9 (catalog, YouTube, image pipeline),
§11 (admin movie and people routes), §13.2 (trigram indexes), §14, §15; PRD v2 "Theaters and
movies", "Media", C1–C3, A2, A3, calls 2, 5, 7, 8, 10, 11. Response shapes U8 reuses:
`contracts/drafts/home-page.openapi.yaml` (`GenreRef`, `Video`, `VideoKind`, `AgeRating`, `Image`).

## Goal

An admin builds the catalog: creates a movie as a draft, fills its details, genres, poster,
photos, YouTube videos and cast and crew, publishes it as Coming soon or Now showing, features it
in the home carousel with a hero video, and archives it when it leaves cinemas. People are
managed once and credited on many movies. U7 and U8 read the catalog through one exported read
service, so no other module touches catalog tables.

## Scope

- Migrations `0070_01`–`0070_09`: `genres` (seeded), `movies`, `movie_genres`, `people`,
  `person_roles`, `movie_credits`, `movie_photos`, `movie_videos`, and the movie → backdrop photo
  and movie → hero video foreign keys.
- `src/modules/catalog/` (`CatalogModule`): repositories, admin services, three admin
  controllers, the exported `CatalogReadService` and `MovieLifecycleRegistry`, the pure
  `youtube.ts` and `movie-rules.ts`.
- 23 admin routes (table below), audit events for every write, complete Swagger.
- Error codes `MOVIE_NOT_PUBLISHABLE`, `MOVIE_NOT_FEATURABLE`, `FEATURED_POSITION_TAKEN`,
  `MOVIE_NOT_DELETABLE`.
- `docs/system-design.md` §6.2, §11 and §14.3 updated (Decisions below); `docs/INDEX.md`.

## Out of scope

- Every public route (`GET /home`, `/genres`, `/movies`, `/movies/{id}`, `/movies/{id}/similar`,
  `/people`): U8, from `CatalogReadService`. Public response DTOs other than `GenreRef` and
  `Video` (`MovieCard`, `FeaturedMovie`, …) are U8's.
- Showtimes, the "Showtimes" tab and SHOWS column of the admin movie list (U7); REVENUE 30D
  (U17); customer and admin search routes (U18, which reuses this unit's trigram indexes).
- The "ever had a booking" delete rule's data: bookings arrive in U10. This unit ships the seam
  (`MovieLifecycleRegistry.addDeletionBlocker`); follow-ups are recorded on #8 (U7 registers
  `has_showtimes`) and the U10 issue (`has_bookings`).
- Arabic titles and names (PRD out of scope), uploaded video files (YouTube links only), a
  YouTube API key, person pages.

## Decisions taken here

| Decision | Why |
|---|---|
| Genres are the fixed list of the design inventory, seeded by `0070_01` with a stable slug: Action, Adventure, Animation, Comedy, Drama, Family, Mystery, Romance, Sci-fi (`sci-fi`), Thriller. No admin route edits them | §6.2 "fixed genre list, seeded by migration"; the PRD names no other list; the contract's `GenreRef` needs `slug`. |
| A movie keeps 0–5 genres **in display order** (`movie_genres.sort_order`); `genreIds` in a request is that order | The contract: "In display order; the first one is the 'first genre' shown on Now showing cards". |
| `POST /admin/movies` needs only `title`; it always creates a `draft`; `ageRating` defaults to `12+` in the service | Design inventory: "Add movie" opens a blank editor with `12+`; "A title is required". |
| Leaving draft for `coming_soon` or `now_showing` requires `synopsis`, `runtimeMinutes`, `releaseDate` and at least one genre; refused with `409 MOVIE_NOT_PUBLISHABLE`, `details.missing` = the unmet keys in that order. The same check runs on any write whose resulting status is public, so clearing a required field of a public movie is refused too. A poster is not required | The contract marks those fields required on public movies and `poster` nullable. A CHECK backs the three columns. |
| Status transitions: `draft → coming_soon, now_showing, archived`; `coming_soon → draft, now_showing, archived`; `now_showing → archived`; `archived → coming_soon, now_showing`. Anything else is `409 CONFLICT` with `details: { from, to }` | A Now showing movie may have showtimes and sold tickets, so it never goes back to draft or Coming soon; archived keeps history (PRD 3–4). Same treatment as U4b's transitions. |
| Archiving does not touch showtimes or tickets | PRD "Archived (hidden, history kept)". U7 refuses new showtimes for non-Now-showing movies (call 11). See open questions. |
| A movie can be featured only when its status is public and it has a hero video; otherwise `409 MOVIE_NOT_FEATURABLE`, `details.reasons` ⊆ `['not_public', 'no_hero_video']`. Removing the hero video of a featured movie (`heroVideoId: null`, or deleting that video) is refused the same way | §9 "a featured movie must have a hero video"; PRD rule 5. A CHECK backs it. |
| Moving a featured movie to `draft` or `archived` (one or bulk) clears `featured_position` in the same write, audited as `movie.unfeatured` | Bulk archive must not fail because one movie was featured; the carousel only shows public movies. |
| Featured positions are 1–5, gaps allowed. A position held by another movie is `409 FEATURED_POSITION_TAKEN` `details: { position, movieId }`; the admin unfeatures that movie first. A race that slips past the check hits `uq_movies_featured_position` and answers the generic `409 CONFLICT` | Call 10: "up to 5". Refusing beats silently reshuffling another movie. |
| The hero video may be any of the movie's own videos, any kind | The admin editor offers the "Home hero trailer" radio on every video. See open questions. |
| The hero video and the backdrop must belong to the movie, enforced by composite FKs (`(hero_video_id, id) → movie_videos (id, movie_id)`, `(backdrop_photo_id, id) → movie_photos (id, movie_id)`); a foreign id is `VALIDATION_FAILED` on `heroVideoId` / `backdropPhotoId` | The database is the backstop, the service gives the readable error. |
| The backdrop is one of the movie's photos (PRD A2 "picked from the photos"), and must be 16:9 within U4a's ±2 % and at least 1280 × 720 by its stored source size; otherwise `422 IMAGE_WRONG_SHAPE` with U4a's details (`kind: 'backdrop'`) | The carousel and the contract expect a 16:9 backdrop; gallery photos are any shape. U4a's `KIND_RULES.backdrop` and `ASPECT_TOLERANCE` are reused, not copied. |
| The poster gets its own upload routes, `PUT` and `DELETE /admin/movies/{id}/poster` (U4a kind `poster`, 2:3, ≥ 400 × 600); added to §11 | PRD A2 "poster upload (2:3)", but §11 lists no poster route. Mirrors the person photo routes; `PUT` replaces. |
| Person-side filmography is `PUT /admin/people/{id}/credits` (added to §11). Kept credits keep their place; new ones are appended to each movie's list; each affected movie's list is renumbered `0…n-1` | PRD A3 "Filmography can be edited from the person or from the movie". |
| `PUT /admin/movies/{id}/credits` replaces the whole list in request order (`sort_order` = index). `(personId, role)` unique in the request; `characterName` only for `actor` and `voice`; unknown person → `VALIDATION_FAILED` on `credits.<i>.personId`; at most 200 | §6.2 UNIQUE and CHECK; one replace is simpler than per-credit routes and matches the editor's ordered list. |
| A person's `roles` are the ones an admin set (`person_roles`); responses also return `creditedRoles` (from credits). The A3 role filter matches either. Nothing syncs the two | §6.2 "roles shown on a person, even without credits" without a second source of truth to keep in step. |
| Role groups for the people filter: `actors` (actor, voice), `directors`, `writers`, `crew` (producer, cinematographer, composer) | PRD A3. |
| YouTube URLs are parsed with `new URL()`: scheme `http`/`https`, no user info, host (case-insensitive) in `youtube.com`, `www.`, `m.`, `music.youtube.com` (`/watch?v=`, `/shorts/<id>`, `/embed/<id>`), `youtu.be` (`/<id>`), `youtube-nocookie.com`, `www.` (`/embed/<id>`); the id must match `^[A-Za-z0-9_-]{11}$` exactly; extra query parameters are ignored; input trimmed, at most 2048 characters. Anything else, including a bare id, is `VALIDATION_FAILED` on `url` with "That doesn't look like a YouTube video link." | §9 and PRD "watch, youtu.be, shorts and embed URLs". A host allow-list refuses `youtube.com.evil.example`. |
| Only the id is stored. Derived: `embedUrl = https://www.youtube-nocookie.com/embed/<id>`, `thumbnailUrl = https://i.ytimg.com/vi/<id>/hqdefault.jpg`, admin-only `watchUrl = https://www.youtube.com/watch?v=<id>` | §9; the contract's `Video` example. |
| A video's URL is not editable; delete and re-add. The same YouTube id twice on one movie is `409 CONFLICT` (`uq_movie_videos_movie_id_youtube_id`) | Keeps `PATCH` to admin-typed fields. |
| Limits: 30 photos and 20 videos per movie (`409 CONFLICT { limit }`, the photo's uploaded files are deleted by `MediaService`); `durationSeconds` 1–36,000; `runtimeMinutes` 1–600 | Free-tier storage (PRD); U4b uses the same pattern. |
| Photo and video order is `sort_order`, kept contiguous `0…n-1`; `PATCH` with `position` moves one (clamped to the last place) and renumbers in one statement | Same rule as U4b. |
| Alt text: poster `"<title> poster"`, backdrop `<title>`, photo `caption ?? title`, person photo `<fullName>` | U4a: owners pass `alt`; the contract example uses "… poster". |
| `budgetLabel` (≤ 40) and `filmingLocations` (≤ 200) are optional free text, never parsed | §6.1, call 5. |
| Every movie write, including its genres, media and credits, sets `movies.updated_at` and `updated_by_staff_id`; a person-side credit change or a person delete touches every affected movie in one `whereIn` update. The admin response's `updatedBy` comes from `StaffService.findById` | PRD A2 "real Last edited by". |
| Lock order: movies `FOR UPDATE` in ascending id, then people (`FOR UPDATE` when the person itself changes, `FOR SHARE` when only credited) in ascending id. Person delete and person-side credits first read the affected movie ids, lock those movies, then the person | Movie and person writes meet on `movie_credits`; one order avoids deadlocks (U1 retries a `40P01` once anyway). |
| Movies, people, photos and videos are hard-deleted; children `ON DELETE CASCADE`; images through `MediaService.deleteMany` (files after commit). No `deleted_at` | Retraction is `archived`; deletion is only for movies that never sold, and people's credits go with them (§9). |
| Movie delete: lock the movie, run every registered `MovieDeletionBlocker`, refuse with `409 MOVIE_NOT_DELETABLE` `details.reasons` (blocker keys); nothing blocks until U7/U10 register theirs | §9 "a movie that ever had a booking can't be deleted"; the U4b seam pattern. |
| `PATCH /admin/movies` (bulk archive) is all-or-nothing: `movieIds` 1–100 unique, `status` must be `archived`; any unknown id → `404 NOT_FOUND` `details.missingIds`, nothing changed; already archived ids are reported, not refused | One request, one transaction; the list's checkbox selection may include archived rows. |
| Admin movie list: `ORDER BY created_at DESC, id DESC` (newest first, stable cursor); `q` (2–100 characters) matches a title or a credited person's name, case-insensitive substring (`ILIKE` with `%`, `_`, `\` escaped, served by trigram indexes); the response adds `statusCounts` (same `q`, every status) | PRD A2 "search by title or cast, status filter with counts". |
| Admin people list: `ORDER BY full_name, id`; `q` matches the name; `roleGroup` filter | PRD A3. |
| Social links: `https` URLs ≤ 500; `instagramUrl` host `instagram.com` or `www.instagram.com`, `imdbUrl` host `imdb.com`, `www.imdb.com` or `m.imdb.com`, `websiteUrl` any host | PRD A3 "Social links (Instagram, IMDb, website) are saved"; host checks catch a pasted link in the wrong box. |
| `birthDate` is a calendar date, not after today's Cairo date | §6.2 `birth_date`; the design inventory's free text is display formatting. |
| A `PATCH` that changes nothing answers `200` and writes no audit row; writes answer the full admin object; deletes answer `204` | Same rules as U2a and U4b. |
| Swagger names: `GenreRef` (`GenreRefResponse`), `Video` (`VideoResponse`), enums `AgeRating`, `VideoKind`, `CreditRole`, `MoviePhotoKind`, `RoleGroup`, and `CatalogMovieStatus` for the admin status enum | `MovieStatus` is the contract's **public** enum (`coming_soon`, `now_showing`), which U8 owns; a second `MovieStatus` with more values would clash. |

## Open questions, decided

These were open when the draft was written; each is decided here from the PRD and the design.

| Question | Decision | Why |
|---|---|---|
| Can a movie that has showtimes but no bookings be deleted, its showtimes going too? | **No.** U7 registers a `has_showtimes` deletion blocker; the admin archives the movie instead. This unit only provides the seam | Removing showtimes is U7's business (cancellation, notifications), not the catalog's. A movie with showtimes is already in cinemas, so archiving is the honest action (PRD 3–4: "Archived (hidden, history kept)"). The blocker also lets `showtimes.movie_id` keep no cascade. |
| Is archiving a Now showing movie refused while it has future scheduled showtimes? | **Allowed.** Sold tickets stay valid, U8 hides archived movies, and U7 refuses new showtimes for a movie that isn't Now showing (call 11) | The PRD describes archiving only as "hidden, history kept"; refusing it would need showtimes data this unit does not own. Follow-up for U7: show the remaining showtimes of an archived movie in the admin timeline. |
| Must the hero video be a trailer, or any of the movie's videos? | **Any of the movie's own videos**, any kind | The admin editor offers the "Home hero trailer" radio on every video (design inventory A2); "trailer" in the PRD names the slot, not the kind. |
| Is a poster required to publish? | **No.** Publishing needs a synopsis, runtime, release date and at least one genre | The home-page contract marks `poster` nullable on public cards. `publishBlockers` lists only the four requirements, and the editor shows the missing poster. |
| A carousel position held by another movie: refuse, swap or shift? | **Refuse** with `409 FEATURED_POSITION_TAKEN { position, movieId }` | Silently moving another movie surprises the admin; one rule and one error, and the race backstop (`uq_movies_featured_position`) refuses the same way. |

## Modules and files

**`src/modules/catalog/`** — `CatalogModule`, imports `MediaModule` and `StaffModule`.
Providers: the five repositories, `MoviesService`, `MovieMediaService`, `CreditsService`,
`PeopleService`, `CatalogReadService`, `MovieLifecycleRegistry`. Exports: `CatalogReadService`,
`MovieLifecycleRegistry`. `AppModule` imports `CatalogModule`.

| File | Holds |
|---|---|
| `enums.ts` | `MOVIE_STATUSES = ['draft','coming_soon','now_showing','archived']`, `PUBLIC_MOVIE_STATUSES = ['coming_soon','now_showing']`, `AGE_RATINGS = ['G','PG','12+','16+','18+']`, `CREDIT_ROLES = ['actor','voice','director','writer','producer','cinematographer','composer']`, `CHARACTER_ROLES = ['actor','voice']`, `ROLE_GROUPS = ['actors','directors','writers','crew']`, `VIDEO_KINDS = ['trailer','teaser','clip','featurette']`, `MOVIE_PHOTO_KINDS = ['still','behind_the_scenes']`, `PUBLISH_REQUIREMENTS = ['synopsis','runtimeMinutes','releaseDate','genres']`, `FEATURE_BLOCKERS = ['not_public','no_hero_video']` |
| `types.ts` | `MovieStatus`, `PublicMovieStatus`, `AgeRating`, `CreditRole`, `RoleGroup`, `VideoKind`, `MoviePhotoKind`, `PublishRequirement`, `FeatureBlocker`, row types (`GenreRow`, `MovieRow`, `NewMovieRow`, `PersonRow`, `MovieCreditRow`, `MoviePhotoRow`, `MovieVideoRow`), domain types (`GenreRef`, `MovieRef`, `MovieSummary`, `MovieDetails`, `MovieVideo`, `MoviePhoto`, `MovieCredit`, `CreditedPerson`, `FeaturedMovie`, `PublicMovieFilter`, `PublicPersonFilter`, `PublicPerson`, `MovieSchedulingInfo`, `AdminMovie`, `AdminMovieListItem`, `AdminMovieListFilter`, `StatusCounts`, `MovieChanges`, `AdminPerson`, `AdminPersonListItem`, `AdminPersonListFilter`, `PersonChanges`, `PersonCredit`, `CreditInput`, `PersonCreditInput`, `BulkArchiveResult`, `MovieDeletionBlocker`) |
| `catalog.constants.ts` | `MAX_GENRES_PER_MOVIE = 5`, `MAX_MOVIE_PHOTOS = 30`, `MAX_MOVIE_VIDEOS = 20`, `MAX_CREDITS = 200`, `MAX_BULK_ARCHIVE = 100`, `FEATURED_POSITION_MIN = 1`, `FEATURED_POSITION_MAX = 5`, `MAX_RUNTIME_MINUTES = 600`, `MAX_VIDEO_DURATION_SECONDS = 36_000`, `DEFAULT_AGE_RATING = '12+'`, `MOVIE_STATUS_TRANSITIONS`, `ROLE_GROUP_ROLES`, `YOUTUBE_ID_PATTERN`, `YOUTUBE_HOSTS`, `YOUTUBE_URL_MESSAGE`, `MAX_YOUTUBE_URL_LENGTH = 2048`, `SIMILAR_MOVIES_LIMIT = 4`, `MIN_SEARCH_LENGTH = 2` |
| `youtube.ts` | pure: `parseYoutubeUrl(input): string \| null`, `youtubeEmbedUrl(id)`, `youtubeThumbnailUrl(id)`, `youtubeWatchUrl(id)` |
| `movie-rules.ts` | pure: `canTransition(from, to)`, `missingPublishRequirements(state)`, `featureBlockers(state)`, `isBackdropShaped(image: StoredImage)` |
| `genres.repository.ts` | `listAll`, `findByIds`, `genresOf(movieIds)`, `replaceMovieGenres(movieId, genreIds)`, `countPublicByGenre(filter)` |
| `movies.repository.ts` | `insert`, `findById`, `findByIdForUpdate`, `findByIdForShare`, `findByIdsForUpdate` (ascending id), `findByIds`, `update`, `touch(ids, at, staffId)`, `deleteById`, `findByFeaturedPosition`, `clearFeatured(ids)`, `adminList`, `adminCount`, `adminStatusCounts`, `publicList`, `publicCount`, `publicCountsByStatus`, `findPublicById`, `listFeatured`, `listSimilar`, `mediaCountsOf(ids)` |
| `movie-media.repository.ts` | photos: `photosOf(movieIds)`, `countPhotos`, `insertPhoto`, `findPhoto(movieId, id)`, `updatePhoto`, `deletePhoto`, `reorderPhotos`, `renumberPhotos`; videos: the same set for videos |
| `people.repository.ts` | `insert`, `findById`, `findByIdForUpdate`, `findByIdsForShare`, `findByIds`, `update`, `deleteById`, `replaceRoles`, `rolesOf(ids)`, `adminList`, `adminCount`, `publicList`, `publicCount` |
| `credits.repository.ts` | `creditsOfMovies(movieIds)`, `creditsOfPeople(personIds)` (with movie title, release date, status, poster id), `replaceForMovie(movieId, credits)`, `movieIdsOfPerson(personId)`, `replaceForPerson(personId, credits)`, `renumber(movieIds)`, `countsOf(personIds)`, `creditedRolesOf(personIds)` |
| `movie-lifecycle.registry.ts` | `MovieLifecycleRegistry` |
| `movies.service.ts` | `MoviesService`: list, create, get, update (fields, genres, status, featured, hero, backdrop), bulk archive, delete |
| `movie-media.service.ts` | `MovieMediaService`: poster `link` and remove, photo `link`/patch/delete, video create/patch/delete |
| `credits.service.ts` | `CreditsService`: movie-side and person-side replace |
| `people.service.ts` | `PeopleService`: list, create, get, update, delete, photo `link` and remove |
| `catalog-read.service.ts` | the exported read service |
| `movie-response.mapper.ts`, `person-response.mapper.ts` | `toAdminMovieResponse`, `toAdminMovieListItem`, `toVideoResponse`, `toGenreRefResponse`, `toAdminPersonResponse`, `toAdminPersonListItem` |
| `admin-movies.controller.ts` | `@Controller('admin/movies')`: list, create, bulk archive, get, patch, delete, credits |
| `admin-movie-media.controller.ts` | `@Controller('admin/movies/:id')`: `poster`, `photos`, `photos/:photoId`, `videos`, `videos/:videoId` |
| `admin-people.controller.ts` | `@Controller('admin/people')`: list, create, get, patch, delete, `:id/photo`, `:id/credits` |
| `dto/` | requests: `create-movie.request.ts`, `update-movie.request.ts`, `bulk-archive-movies.request.ts`, `admin-movie-list.query.ts`, `movie-id.params.ts` (`MovieIdParams`, `MoviePhotoParams`, `MovieVideoParams`), `replace-movie-credits.request.ts` (`ReplaceMovieCreditsRequest`, `MovieCreditRequest`), `movie-photo-fields.request.ts`, `update-movie-photo.request.ts`, `create-movie-video.request.ts`, `update-movie-video.request.ts`, `create-person.request.ts`, `update-person.request.ts`, `admin-person-list.query.ts`, `person-id.params.ts`, `replace-person-credits.request.ts` (`ReplacePersonCreditsRequest`, `PersonCreditRequest`), `is-youtube-url.validator.ts` (`@IsYoutubeUrl()`, calls `parseYoutubeUrl`); responses: `genre-ref.response.ts`, `video.response.ts`, `admin-movie.response.ts`, `admin-movie-list-item.response.ts`, `admin-movie-page.response.ts`, `status-counts.response.ts`, `admin-movie-photo.response.ts`, `admin-movie-video.response.ts`, `movie-credit.response.ts`, `staff-ref.response.ts`, `bulk-archive-movies.response.ts`, `admin-person.response.ts`, `admin-person-list-item.response.ts`, `admin-person-page.response.ts`, `person-credit.response.ts` |
| `catalog.module.ts` | the module |

Path params (`id`, `photoId`, `videoId`): positive integers (`@Type(() => Number)`, `IsInt`,
`Min(1)`), else `VALIDATION_FAILED`. Text inputs are trimmed (`@Transform`) before length checks;
an optional text field sent as `""` after trimming is stored as `NULL`.

## Migrations (prefix `0070`)

Every table: `ALTER TABLE … ENABLE ROW LEVEL SECURITY`; no defaults; times from the `Clock`;
every index commented with its query; enum CHECKs mirror `enums.ts`; trimmed-text CHECKs are
`btrim(x) = x AND length(x) >= 1`. `gin_trgm_ops` resolves through the `search_path`
(`maqady, extensions, public`, §6.1).

**`0070_01_create_genres`** — `id BIGSERIAL`, `name VARCHAR(40) NOT NULL`, `slug VARCHAR(40)
NOT NULL` (CHECK `~ '^[a-z0-9]+(-[a-z0-9]+)*$'`), `uq_genres_name UNIQUE (name)` ("genres
alphabetical", `ORDER BY name`), `uq_genres_slug UNIQUE (slug)` (U8 `?genres=sci-fi`). Then
`INSERT` the ten genres of the Decisions table, in alphabetical order.

**`0070_02_create_movies`**

```sql
CREATE TABLE movies (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  status VARCHAR(16) NOT NULL,
  synopsis VARCHAR(600) NULL,
  runtime_minutes SMALLINT NULL,
  release_date DATE NULL,
  age_rating VARCHAR(4) NOT NULL,
  language VARCHAR(80) NULL,
  country VARCHAR(80) NULL,
  production_company VARCHAR(120) NULL,
  budget_label VARCHAR(40) NULL,
  filming_locations VARCHAR(200) NULL,
  poster_image_id BIGINT NULL,
  backdrop_photo_id BIGINT NULL,          -- FK added by 0070_09
  hero_video_id BIGINT NULL,              -- FK added by 0070_09
  featured_position SMALLINT NULL,
  updated_by_staff_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_movies_poster_image_id FOREIGN KEY (poster_image_id) REFERENCES images (id),
  CONSTRAINT fk_movies_updated_by_staff_id FOREIGN KEY (updated_by_staff_id) REFERENCES staff_users (id),
  CONSTRAINT chk_movies_title CHECK (btrim(title) = title AND length(title) >= 1),
  CONSTRAINT chk_movies_status CHECK (status IN ('draft', 'coming_soon', 'now_showing', 'archived')),
  CONSTRAINT chk_movies_age_rating CHECK (age_rating IN ('G', 'PG', '12+', '16+', '18+')),
  CONSTRAINT chk_movies_runtime_minutes CHECK (runtime_minutes BETWEEN 1 AND 600),
  CONSTRAINT chk_movies_featured_position CHECK (featured_position BETWEEN 1 AND 5),
  CONSTRAINT chk_movies_public_fields CHECK (
    status NOT IN ('coming_soon', 'now_showing')
    OR (synopsis IS NOT NULL AND runtime_minutes IS NOT NULL AND release_date IS NOT NULL)),
  CONSTRAINT chk_movies_featured CHECK (
    featured_position IS NULL
    OR (hero_video_id IS NOT NULL AND status IN ('coming_soon', 'now_showing')))
);
```

(Each optional text column also has its trimmed-text CHECK.)

| Index | Columns | Query it serves |
|---|---|---|
| `idx_movies_created_at` | `(created_at DESC, id DESC)` | Admin list unfiltered, cursor `(created_at, id) < (?, ?)` |
| `idx_movies_status_created_at` | `(status, created_at DESC, id DESC)` | Admin list with `status`; `statusCounts` (`GROUP BY status`) |
| `idx_movies_status_release_date` | `(status, release_date, id)` | U8 public lists `WHERE status = ? ORDER BY release_date [DESC], id`; similar movies |
| `uq_movies_featured_position` | `(featured_position) WHERE featured_position IS NOT NULL`, UNIQUE | One movie per carousel slot (§6.3); `listFeatured()` `ORDER BY featured_position` |
| `uq_movies_poster_image_id` | `(poster_image_id)`, UNIQUE | Covers `fk_movies_poster_image_id`; an image is one movie's poster |
| `idx_movies_updated_by_staff_id` | `(updated_by_staff_id)` | Covers `fk_movies_updated_by_staff_id` |
| `idx_movies_title_trgm` | GIN `(title gin_trgm_ops)` | Admin `q` and U8/U18 title search, `title ILIKE ?` |

**`0070_03_create_movie_genres`** — `movie_id BIGINT NOT NULL` (`fk_movie_genres_movie_id` →
`movies ON DELETE CASCADE`), `genre_id BIGINT NOT NULL` (`fk_movie_genres_genre_id` → `genres`),
`sort_order SMALLINT NOT NULL` (CHECK `BETWEEN 0 AND 4`), `pk_movie_genres PRIMARY KEY (movie_id,
genre_id)` (covers the movie FK; "genres of movies `WHERE movie_id IN (…)`"),
`uq_movie_genres_movie_id_sort_order UNIQUE (movie_id, sort_order)` (display order),
`idx_movie_genres_genre_id_movie_id (genre_id, movie_id)` (covers the genre FK; U8 "movies in
genres `WHERE genre_id IN (…)`" and genre counts).

**`0070_04_create_people`** — `id BIGSERIAL`, `full_name VARCHAR(120) NOT NULL`, `birth_date
DATE NULL`, `birth_place VARCHAR(120) NULL`, `nationality VARCHAR(80) NULL`, `bio VARCHAR(400)
NULL`, `photo_image_id BIGINT NULL` (`fk_people_photo_image_id` → `images`), `instagram_url`,
`imdb_url`, `website_url VARCHAR(500) NULL` (CHECK `~ '^https://'`), `created_at`, `updated_at`;
trimmed-text CHECKs. Indexes: `idx_people_full_name (full_name, id)` (admin and public people
lists, cursor `(full_name, id) > (?, ?)`); `idx_people_full_name_trgm` GIN `(full_name
gin_trgm_ops)` (`q` on names, cast search in movie lists, U18); `uq_people_photo_image_id
UNIQUE (photo_image_id)` (covers the FK).

**`0070_05_create_person_roles`** — `person_id BIGINT NOT NULL` (`fk_person_roles_person_id`,
`ON DELETE CASCADE`), `role VARCHAR(20) NOT NULL` (CHECK in `CREDIT_ROLES`), `pk_person_roles
PRIMARY KEY (person_id, role)` (covers the FK; "roles of people `WHERE person_id IN (…)`"),
`idx_person_roles_role_person_id (role, person_id)` (role-group filter `WHERE role IN (…)`).

**`0070_06_create_movie_credits`** — `id BIGSERIAL`, `movie_id BIGINT NOT NULL`
(`fk_movie_credits_movie_id`, `ON DELETE CASCADE`), `person_id BIGINT NOT NULL`
(`fk_movie_credits_person_id` → `people ON DELETE CASCADE`), `role VARCHAR(20) NOT NULL` (CHECK
in `CREDIT_ROLES`), `character_name VARCHAR(120) NULL`, `sort_order SMALLINT NOT NULL` (CHECK
`BETWEEN 0 AND 199`), `created_at`; `chk_movie_credits_character_name CHECK (character_name IS
NULL OR (role IN ('actor', 'voice') AND btrim(character_name) = character_name AND
length(character_name) >= 1))`. Indexes: `uq_movie_credits_movie_id_person_id_role UNIQUE
(movie_id, person_id, role)` (§6.2; covers the movie FK); `idx_movie_credits_movie_id_sort_order
(movie_id, sort_order, id)` ("credits of movies `WHERE movie_id IN (…) ORDER BY movie_id,
sort_order`"); `idx_movie_credits_person_id_movie_id (person_id, movie_id)` (covers the person
FK; filmography, cast filter, `movieIdsOfPerson`).

**`0070_07_create_movie_photos`** — `id BIGSERIAL`, `movie_id BIGINT NOT NULL`
(`fk_movie_photos_movie_id`, `ON DELETE CASCADE`), `image_id BIGINT NOT NULL`
(`fk_movie_photos_image_id` → `images`), `kind VARCHAR(20) NOT NULL` (CHECK in
`MOVIE_PHOTO_KINDS`), `caption VARCHAR(200) NULL`, `sort_order SMALLINT NOT NULL` (CHECK `>= 0`),
`created_at`, `updated_at`. Indexes: `uq_movie_photos_image_id UNIQUE (image_id)` (covers the
image FK); `uq_movie_photos_id_movie_id UNIQUE (id, movie_id)` (target of the backdrop composite
FK); `idx_movie_photos_movie_id_sort_order (movie_id, sort_order, id)` (covers the movie FK;
"photos of movies `WHERE movie_id IN (…) ORDER BY movie_id, sort_order, id`").

**`0070_08_create_movie_videos`** — `id BIGSERIAL`, `movie_id BIGINT NOT NULL`
(`fk_movie_videos_movie_id`, `ON DELETE CASCADE`), `youtube_id VARCHAR(11) NOT NULL` (CHECK `~
'^[A-Za-z0-9_-]{11}$'`), `kind VARCHAR(16) NOT NULL` (CHECK in `VIDEO_KINDS`), `title
VARCHAR(120) NOT NULL`, `duration_seconds INT NULL` (CHECK `BETWEEN 1 AND 36000`), `sort_order
SMALLINT NOT NULL` (CHECK `>= 0`), `created_at`, `updated_at`. Indexes:
`uq_movie_videos_movie_id_youtube_id UNIQUE (movie_id, youtube_id)` (no duplicate link per
movie); `uq_movie_videos_id_movie_id UNIQUE (id, movie_id)` (target of the hero composite FK);
`idx_movie_videos_movie_id_sort_order (movie_id, sort_order, id)` (covers the movie FK; "videos of
movies `WHERE movie_id IN (…)` in order").

**`0070_09_add_movies_media_fks`**

```sql
ALTER TABLE movies
  ADD CONSTRAINT fk_movies_backdrop_photo FOREIGN KEY (backdrop_photo_id, id)
    REFERENCES movie_photos (id, movie_id),
  ADD CONSTRAINT fk_movies_hero_video FOREIGN KEY (hero_video_id, id)
    REFERENCES movie_videos (id, movie_id);
-- Covers fk_movies_backdrop_photo: deleting a photo checks movies WHERE backdrop_photo_id = ? AND id = ?
CREATE INDEX idx_movies_backdrop_photo_id_id ON movies (backdrop_photo_id, id) WHERE backdrop_photo_id IS NOT NULL;
-- Covers fk_movies_hero_video; also "is this video a hero?"
CREATE INDEX idx_movies_hero_video_id_id ON movies (hero_video_id, id) WHERE hero_video_id IS NOT NULL;
```

`MATCH SIMPLE` leaves the FK unchecked while the column is NULL. Both FKs are `NO ACTION`
(checked at the end of the statement), so deleting a movie, which cascades to its photos and
videos, passes; deleting a photo or video that is still the backdrop or hero fails, so the
service clears the column first.

Follow-ups written into U7 and U10: `showtimes.movie_id` FK with no action (the database
backstop for deletion); U7 registers the `has_showtimes` blocker, U10 `has_bookings`.

## Behaviour

**Movie update** (`MoviesService.update`, request transaction): lock movie `FOR UPDATE` → merge
the request into the current state (fields, `genreIds`, `heroVideoId`, `backdropPhotoId`,
`status`, `featuredPosition`) → validate the merged state:
1. genre ids exist (else `VALIDATION_FAILED` on `genreIds`); hero and backdrop belong to the movie
   (else `VALIDATION_FAILED`); a new backdrop passes `isBackdropShaped` (else `IMAGE_WRONG_SHAPE`);
2. a status change passes `canTransition` (else `CONFLICT { from, to }`); moving to `draft` or
   `archived` clears `featuredPosition`;
3. resulting status public → `missingPublishRequirements` empty (else `MOVIE_NOT_PUBLISHABLE`);
4. resulting `featuredPosition` not null → `featureBlockers` empty (else `MOVIE_NOT_FEATURABLE`),
   and no other movie holds it (else `FEATURED_POSITION_TAKEN`);

→ write the row and the genres → audit → read back → `AdminMovieResponse`.

**Uploads** (poster, photos, person photo; `@NoRequestTransaction()` routes): the controller
checks the owner exists (fast `404` before image work), then `MediaService.upload({ kind, upload,
actor, link })`. `link(image)` runs in the media transaction: lock the owner `FOR UPDATE`
(`NOT_FOUND` if deleted meanwhile); poster/person photo → set the column, `MediaService.delete(old)`
if one existed; movie photo → `CONFLICT { limit: 30 }` when full, else insert at `sort_order =
count`; touch the movie; audit; return the admin response.

**Deletes.** Photo: lock movie → clear `backdrop_photo_id` if it is the backdrop → delete row,
renumber → `MediaService.delete(imageId)` → audit. Video: lock movie → hero of a featured movie
→ `MOVIE_NOT_FEATURABLE ['no_hero_video']`; hero otherwise → clear `hero_video_id` → delete,
renumber → audit. Movie: lock → blockers → collect poster and photo image ids → delete (children
cascade) → `MediaService.deleteMany(ids)` → audit. Person: lock affected movies, then the person →
collect the photo id → delete (roles and credits cascade) → renumber and touch the affected
movies → `MediaService.delete` → audit with `creditCount`.

**Audit events** (`AuditService.record`, inside the write's transaction; actor = the staff
principal; changed fields are API field names, never values; no metadata key contains "name"):

| Action | Entity | Changed fields / metadata |
|---|---|---|
| `movie.created` | `movie` | — |
| `movie.updated` | `movie` | changed field names (not `status`, `featuredPosition`) |
| `movie.status_changed` | `movie` | `{ from, to }` |
| `movie.featured` / `movie.unfeatured` | `movie` | `{ position }` / `{ previousPosition }` |
| `movie.archived` (bulk) | `movie` | `{ from, bulk: true }`, one row per changed movie |
| `movie.deleted` | `movie` | `{ photoCount, videoCount, creditCount }` |
| `movie.credits_replaced` | `movie` | `{ count }` |
| `movie.poster_replaced` / `movie.poster_removed` | `movie` | — |
| `movie_photo.created` / `.updated` / `.deleted` | `movie_photo` | `{ movieId }`; `.updated` adds changed field names |
| `movie_video.created` / `.updated` / `.deleted` | `movie_video` | `{ movieId, youtubeId }`; `.updated` adds changed field names |
| `person.created` / `person.updated` | `person` | `.updated`: changed field names |
| `person.deleted` | `person` | `{ creditCount }` |
| `person.photo_replaced` / `person.photo_removed` | `person` | — |
| `person.credits_replaced` | `person` | `{ count, movieCount }` |

## Endpoints

All under `/api/v1`, `@Admin()`, `@ApiTags('Admin: movies')` or `('Admin: people')`, each with
summary, description and `@ApiErrorResponses(...)` for its codes (U1 adds access, idempotency and
`429`). "Key" = the optional `Idempotency-Key` is claimed and stored by the write interceptor (by
`MediaService` on upload routes); **S** = `@Strict()`. "+ image codes" = U4a's `IMAGE_TOO_LARGE`,
`UNSUPPORTED_IMAGE_TYPE`, `IMAGE_TOO_MANY_PIXELS`, `IMAGE_WRONG_SHAPE`, `STORAGE_UNAVAILABLE`.

| Route | Idem. | Request | Response | Errors |
|---|---|---|---|---|
| `GET /admin/movies` | — | `AdminMovieListQuery` | `200 AdminMoviePage` | `VALIDATION_FAILED` |
| `POST /admin/movies` | **S** | `CreateMovieRequest` | `201 AdminMovieResponse` | `VALIDATION_FAILED` |
| `PATCH /admin/movies` (bulk archive) | key | `BulkArchiveMoviesRequest` | `200 BulkArchiveMoviesResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `GET /admin/movies/{id}` | — | `MovieIdParams` | `200 AdminMovieResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PATCH /admin/movies/{id}` | key | `UpdateMovieRequest` | `200 AdminMovieResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT`, `MOVIE_NOT_PUBLISHABLE`, `MOVIE_NOT_FEATURABLE`, `FEATURED_POSITION_TAKEN`, `IMAGE_WRONG_SHAPE` |
| `DELETE /admin/movies/{id}` | key | — | `204` | `VALIDATION_FAILED`, `NOT_FOUND`, `MOVIE_NOT_DELETABLE` |
| `PUT /admin/movies/{id}/credits` | key | `ReplaceMovieCreditsRequest` | `200 AdminMovieResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PUT /admin/movies/{id}/poster` (added) | key, `@ImageUpload()` | multipart `file` | `200 AdminMovieResponse` | `VALIDATION_FAILED`, `NOT_FOUND` + image codes |
| `DELETE /admin/movies/{id}/poster` (added) | key | — | `204` (also with no poster) | `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /admin/movies/{id}/photos` | **S**, `@ImageUpload({ fields: MoviePhotoFieldsRequest })` | multipart `file` + fields | `201 AdminMovieResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT` + image codes |
| `PATCH /admin/movies/{id}/photos/{photoId}` | key | `UpdateMoviePhotoRequest` | `200 AdminMovieResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `DELETE /admin/movies/{id}/photos/{photoId}` | key | — | `204` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /admin/movies/{id}/videos` | **S** | `CreateMovieVideoRequest` | `201 AdminMovieResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT` |
| `PATCH /admin/movies/{id}/videos/{videoId}` | key | `UpdateMovieVideoRequest` | `200 AdminMovieResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `DELETE /admin/movies/{id}/videos/{videoId}` | key | — | `204` | `VALIDATION_FAILED`, `NOT_FOUND`, `MOVIE_NOT_FEATURABLE` |
| `GET /admin/people` | — | `AdminPersonListQuery` | `200 AdminPersonPage` | `VALIDATION_FAILED` |
| `POST /admin/people` | **S** | `CreatePersonRequest` | `201 AdminPersonResponse` | `VALIDATION_FAILED` |
| `GET /admin/people/{id}` | — | `PersonIdParams` | `200 AdminPersonResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PATCH /admin/people/{id}` | key | `UpdatePersonRequest` | `200 AdminPersonResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `DELETE /admin/people/{id}` | key | — | `204` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PUT /admin/people/{id}/photo` | key, `@ImageUpload()` | multipart `file` | `200 AdminPersonResponse` | `VALIDATION_FAILED`, `NOT_FOUND` + image codes |
| `DELETE /admin/people/{id}/photo` | key | — | `204` (also with no photo) | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PUT /admin/people/{id}/credits` (added) | key | `ReplacePersonCreditsRequest` | `200 AdminPersonResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |

A photo or video that belongs to another movie is `NOT_FOUND`.

**Request DTOs**

- `CreateMovieRequest`: `title` (1–200, required); optional nullable `synopsis` (≤ 600),
  `runtimeMinutes` (integer 1–600), `releaseDate` (`isCalendarDate`), `language`, `country`
  (≤ 80), `productionCompany` (≤ 120), `budgetLabel` (≤ 40), `filmingLocations` (≤ 200); optional
  `ageRating` (`IsIn(AGE_RATINGS)`), `genreIds` (positive integers, `ArrayUnique`, 0–5).
- `UpdateMovieRequest`: every field above optional (`title` not nullable), plus `status`
  (`IsIn(MOVIE_STATUSES)`), nullable `featuredPosition` (integer 1–5), nullable `heroVideoId`,
  nullable `backdropPhotoId` (positive integers); at least one present, else `VALIDATION_FAILED`.
- `BulkArchiveMoviesRequest`: `movieIds` (1–100 positive integers, `ArrayUnique`), `status`
  (`IsIn(['archived'])`).
- `AdminMovieListQuery` extends `PageQuery`: optional `q` (2–100 after trim), `status`.
- `ReplaceMovieCreditsRequest`: `credits: MovieCreditRequest[]` (0–200, `(personId, role)`
  unique). `MovieCreditRequest`: `personId`, `role` (`IsIn(CREDIT_ROLES)`), optional nullable
  `characterName` (1–120; forbidden unless `actor`/`voice`, `VALIDATION_FAILED` on
  `credits.<i>.characterName`).
- `MoviePhotoFieldsRequest` (multipart text fields): `kind` (`IsIn(MOVIE_PHOTO_KINDS)`,
  required), optional `caption` (1–200).
- `UpdateMoviePhotoRequest`: optional `kind`, nullable `caption`, `position` (integer ≥ 0); at
  least one.
- `CreateMovieVideoRequest`: `url` (`@IsYoutubeUrl()`), `title` (1–120), `kind`
  (`IsIn(VIDEO_KINDS)`), optional nullable `durationSeconds` (integer 1–36,000).
- `UpdateMovieVideoRequest`: optional `title`, `kind`, nullable `durationSeconds`, `position`;
  at least one.
- `CreatePersonRequest`: `fullName` (1–120, required); optional nullable `birthDate`
  (`isCalendarDate`, not after today's Cairo date, checked in the service), `birthPlace` (≤ 120),
  `nationality` (≤ 80), `bio` (≤ 400), `instagramUrl`, `imdbUrl`, `websiteUrl` (Decisions rule);
  optional `roles` (`IsIn(CREDIT_ROLES)` each, `ArrayUnique`, 0–7; default `[]`).
- `UpdatePersonRequest`: every field above optional (`fullName` not nullable); at least one.
- `AdminPersonListQuery` extends `PageQuery`: optional `q` (2–100), `roleGroup`
  (`IsIn(ROLE_GROUPS)`).
- `ReplacePersonCreditsRequest`: `credits: PersonCreditRequest[]` (0–200, `(movieId, role)`
  unique); `PersonCreditRequest`: `movieId`, `role`, `characterName` (as above); unknown movie →
  `VALIDATION_FAILED` on `credits.<i>.movieId`.

**Response DTOs**

- `GenreRefResponse` (`GenreRef`): `id`, `name`, `slug`.
- `VideoResponse` (`Video`): `id`, `youtubeId`, `title`, `kind`, `durationSeconds` (nullable),
  `embedUrl`, `thumbnailUrl`, exactly as the home-page draft. Registered with `ApiExtraModels`
  (U8 uses it).
- `AdminMovieResponse`: `id`, `title`, `status` (`CatalogMovieStatus`), `synopsis`,
  `runtimeMinutes`, `releaseDate`, `ageRating`, `language`, `country`, `productionCompany`,
  `budgetLabel`, `filmingLocations` (each nullable where the column is), `genres`
  (`GenreRefResponse[]`, display order), `poster` (`ImageResponse` or null), `backdropPhotoId`,
  `heroVideoId`, `featuredPosition` (nullable), `photos` (`AdminMoviePhotoResponse[]` = `{ id,
  kind, caption, position, isBackdrop, image: ImageResponse }`), `videos`
  (`AdminMovieVideoResponse[]` = `VideoResponse` fields + `watchUrl`, `position`, `isHero`),
  `credits` (`MovieCreditResponse[]` = `{ id, role, characterName, position, person: { id,
  fullName, photo } }`), `publishBlockers` (`missingPublishRequirements` of the current state,
  any status), `createdAt`, `updatedAt`, `updatedBy` (`StaffRefResponse` = `{ id, fullName }`).
  One response costs a fixed number of queries.
- `AdminMovieListItemResponse`: `id`, `title`, `status`, `ageRating`, `runtimeMinutes`,
  `releaseDate`, `genres`, `poster`, `featuredPosition`, `photoCount`, `videoCount`,
  `creditCount`, `updatedAt`. `AdminMoviePage` = `{ items, nextCursor, total, statusCounts }`,
  `StatusCountsResponse` = `{ draft, comingSoon, nowShowing, archived }`.
- `BulkArchiveMoviesResponse`: `archivedIds`, `alreadyArchivedIds` (ascending).
- `AdminPersonResponse`: `id`, `fullName`, `birthDate`, `birthPlace`, `nationality`, `bio`,
  `photo` (`ImageResponse` or null), `instagramUrl`, `imdbUrl`, `websiteUrl`, `roles`,
  `creditedRoles` (`CreditRole[]` in `CREDIT_ROLES` order), `credits` (`PersonCreditResponse[]`
  = `{ id, role, characterName, movie: { id, title, status, releaseDate, poster } }`, newest
  release first, undated last, then title), `createdAt`, `updatedAt`.
- `AdminPersonListItemResponse`: `id`, `fullName`, `photo`, `roles` (union of set and credited),
  `birthYear` (nullable), `birthPlace`, `creditCount`, `knownFor` (up to 2 `{ id, title }`,
  newest release first). `AdminPersonPage = PageResponseOf(AdminPersonListItemResponse)`.

## Error codes added

| Code | HTTP | Details |
|---|---|---|
| `MOVIE_NOT_PUBLISHABLE` | 409 | `{ missing: string[] }`, e.g. `['synopsis', 'genres']` |
| `MOVIE_NOT_FEATURABLE` | 409 | `{ reasons: string[] }`, ⊆ `['not_public', 'no_hero_video']` |
| `FEATURED_POSITION_TAKEN` | 409 | `{ position: number, movieId: number }` |
| `MOVIE_NOT_DELETABLE` | 409 | `{ reasons: string[] }`, e.g. `['has_bookings']` |

Catalogue descriptions: "Add a synopsis, runtime, release date and at least one genre before
publishing." / "Only Coming soon or Now showing movies with a hero video can be featured." /
"Another movie holds this carousel position; unfeature it first." / "A movie that has had
bookings can't be deleted; archive it instead."

## Services

**Exported by `CatalogModule`** (for U7 and U8):

```ts
class CatalogReadService {
  // U8 discovery. Public = status coming_soon or now_showing. Fixed query count per call.
  listGenres(): Promise<readonly GenreRef[]>;                                  // by name
  countPublicMoviesByGenre(filter?: Omit<PublicMovieFilter, 'status'> & { status?: PublicMovieStatus }):
    Promise<ReadonlyMap<number, number>>;                                       // genreId → count
  countPublicMovies(filter?: Omit<PublicMovieFilter, 'status'>):
    Promise<Readonly<Record<PublicMovieStatus, number>>>;                       // tab counts
  listPublicMovies(filter: PublicMovieFilter, page: PageRequest): Promise<Page<MovieSummary>>;
    // now_showing: release_date DESC, id DESC; coming_soon: release_date ASC, id ASC
  findPublicMoviesByIds(ids: readonly number[]): Promise<ReadonlyMap<number, MovieSummary>>;
  findPublicMovie(id: number): Promise<MovieDetails | null>;
  listFeatured(): Promise<readonly FeaturedMovie[]>;                            // by position, ≤ 5
  listSimilar(movieId: number, limit?: number): Promise<readonly MovieSummary[]>;
    // now_showing, ≥ 1 shared genre, most shared first, then release_date DESC, id; default 4
  listPublicPeople(filter: PublicPersonFilter, page: PageRequest): Promise<Page<PublicPerson>>;
    // people credited on a public movie; by full_name, id

  // U7 scheduling and the admin timeline.
  lockMovieForShare(id: number): Promise<MovieSchedulingInfo | null>;  // FOR SHARE in the open
                                                                        // transaction; any status
  findMoviesByIds(ids: readonly number[]): Promise<ReadonlyMap<number, MovieRef>>; // any status
}
// PublicMovieFilter = { status: PublicMovieStatus; q?: string /* title or credited name */;
//   genreIds?: readonly number[] /* any-of */; personIds?: readonly number[] /* any-of */;
//   movieIds?: readonly number[] /* restrict, e.g. U8's "has a showtime on date" set */ }
// PublicPersonFilter = { q?: string; roleGroup?: RoleGroup }
// GenreRef = { id; name; slug }
// MovieSummary = { id; title; status: PublicMovieStatus; synopsis: string; runtimeMinutes: number;
//   releaseDate: CalendarDate; ageRating: AgeRating; genres: readonly GenreRef[]; poster: StoredImage | null }
// MovieDetails = MovieSummary & { language; country; productionCompany; budgetLabel;
//   filmingLocations /* string | null each */; backdrop: StoredImage | null;
//   heroVideo: MovieVideo | null; photos: readonly MoviePhoto[]; videos: readonly MovieVideo[];
//   credits: readonly MovieCredit[] }
// MovieVideo = { id; youtubeId; title; kind: VideoKind; durationSeconds: number | null; position }
// MoviePhoto = { id; kind: MoviePhotoKind; caption: string | null; position; image: StoredImage }
// MovieCredit = { id; role: CreditRole; characterName: string | null; position;
//   person: CreditedPerson /* { id; fullName; photo: StoredImage | null } */ }
// FeaturedMovie = { position: number; movie: MovieSummary; heroVideo: MovieVideo; backdrop: StoredImage | null }
// PublicPerson = { id; fullName; photo: StoredImage | null; roles: readonly CreditRole[] /* union */ }
// MovieSchedulingInfo = { id; title; status: MovieStatus; runtimeMinutes: number | null }
// MovieRef = { id; title; status: MovieStatus; runtimeMinutes: number | null; ageRating: AgeRating;
//   poster: StoredImage | null }

class MovieLifecycleRegistry {
  addDeletionBlocker(blocker: MovieDeletionBlocker): void; // duplicate key → throws
}
// MovieDeletionBlocker = { key: string; blocks(movieId: number): Promise<boolean> }
//   (runs in the delete transaction with the movie locked FOR UPDATE; U7 adds 'has_showtimes',
//   U10 adds 'has_bookings')
```

Every movie status change locks the movie `FOR UPDATE`, so U7's `lockMovieForShare` serialises
scheduling against archiving.

Also exported by path: `VideoResponse`, `GenreRefResponse`, `toVideoResponse()`,
`toGenreRefResponse()`, `youtubeEmbedUrl()`, `youtubeThumbnailUrl()`, `AGE_RATINGS`,
`VIDEO_KINDS`, `PUBLIC_MOVIE_STATUSES`, `CREDIT_ROLES`, `ROLE_GROUPS`, and the enum names
`AgeRating`, `VideoKind`, `CreditRole`, `RoleGroup` for U8's DTOs.

**Consumed from U4a** (exact names): `MediaModule`, `MediaService.upload()`, `.findByIds()`,
`.delete()`, `.deleteMany()`, `.toImageResponse()`, `ImageUpload()`, `UploadedImage()`,
`ImageUploadPayload`, `UploadOutcome`, `StoredImage`, `ImageResponse`, `KIND_RULES`,
`ASPECT_TOLERANCE`, image kinds `poster`, `person` and `gallery`, error code `IMAGE_WRONG_SHAPE`.

**Consumed from U2a**: `StaffModule`, `StaffService.findById()` (`StaffMember.fullName` for
`updatedBy`); tests use `createStaffMember()`, `staffToken()`, `listHttpRoutes()`, `samplePath()`.

**Consumed from U1** (exact names): `TransactionRepository.run()`, `.afterCommit()` (through
`MediaService`), `TransactionContext.executor()`, `Strict()`, `Admin()`, `CurrentPrincipal()`,
`StaffPrincipal`, `AuditService.record()`, `Clock`, `cinemaDateOf()`, `isCalendarDate()`,
`CalendarDate`, `PageQuery`, `toPageRequest()`, `toPage()`, `PageResponseOf()`, `Page`,
`PageRequest`, `AppError`, `ApiErrorResponses()`. Nothing from U3, U4b or U9.

## Tests

**Unit** (`test/unit/modules/catalog/`):

- `youtube.test.ts` (pure, table-driven; id `dQw4w9WgXcQ`):
  - accepted → the id: `https://www.youtube.com/watch?v=<id>`, `https://youtube.com/watch?v=<id>&t=42s`,
    `https://www.youtube.com/watch?feature=share&v=<id>`, `https://m.youtube.com/watch?v=<id>`,
    `https://music.youtube.com/watch?v=<id>`, `http://www.youtube.com/watch?v=<id>`,
    `https://youtu.be/<id>`, `https://youtu.be/<id>?si=abc&t=10`,
    `https://www.youtube.com/shorts/<id>`, `https://youtube.com/shorts/<id>?feature=share`,
    `https://www.youtube.com/embed/<id>`, `https://www.youtube-nocookie.com/embed/<id>?rel=0`,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=<id>`, the same with surrounding spaces; an id with `-` and `_`.
  - refused → `null`: a bare id, empty string, `https://vimeo.com/123`,
    `https://youtube.com.evil.example/watch?v=<id>`, `https://evil.example/watch?v=<id>`,
    `https://www.youtube.com/watch?v=short`, a 12-character id, an id with `!`,
    `https://www.youtube.com/watch?list=PL123`, `https://www.youtube.com/@channel`,
    `https://youtu.be/`, `https://user:pass@www.youtube.com/watch?v=<id>`, `ftp://youtu.be/<id>`,
    `javascript:alert(1)`, a 2,049-character URL.
  - derived URLs: embed, thumbnail and watch URLs for the id.
- `movie-rules.test.ts` (pure): the full 4 × 4 transition table; `missingPublishRequirements` for
  each missing field and their order; `featureBlockers` for draft, archived, no hero, both;
  `isBackdropShaped` for 1920 × 1080, 1280 × 720, 1920 × 1100 (≈ 1.75, inside ±2 %), 1600 × 1200,
  1279 × 720.
- `movies.service.test.ts` (repositories, media, staff and audit mocked): a no-op `PATCH` writes
  no audit row; fields plus status write `movie.updated` and `movie.status_changed`; archiving a
  featured movie also writes `movie.unfeatured` and clears the position; a registered blocker
  produces `MOVIE_NOT_DELETABLE` with its key.
- `movie-lifecycle.registry.test.ts`: duplicate key throws; order kept.
- DTO validation (`ValidationPipe` with the global options): movie (empty title, runtime 0 and
  601, six genres, duplicate genre, `featuredPosition` 0 and 6, empty `PATCH`), credits
  (`characterName` on `director`, duplicate `(personId, role)`, 201 credits), video (each refused
  URL form answers `url` with the message), person (bio 401, `instagramUrl` on another host, `http`
  website, unknown role), bulk archive (status `draft`, 101 ids).

**Integration** (`test/integration/modules/catalog/`, real app and Postgres, `TestClock`,
`STORAGE_DRIVER=local`, admin and box-office tokens from `staffToken()`):

- Movie lifecycle: create with only a title → `201`, `draft`, `ageRating 12+`, `updatedBy` = the
  admin, audit `movie.created` → publish refused `MOVIE_NOT_PUBLISHABLE { missing: ['synopsis',
  'runtimeMinutes', 'releaseDate', 'genres'] }` → `PATCH` the fields and genres `[mystery, drama]`
  (order kept) → `now_showing` `200` → a second admin edits the title → `updatedBy` changes →
  clearing `synopsis` → `MOVIE_NOT_PUBLISHABLE` → `now_showing → coming_soon` and `→ draft` →
  `409 CONFLICT { from, to }` → archive → `archived` → `coming_soon` again; `coming_soon → draft`
  allowed; unknown genre id → `VALIDATION_FAILED` on `genreIds`.
- Featured and hero: feature a draft → `MOVIE_NOT_FEATURABLE ['not_public', 'no_hero_video']`;
  add a video, set it as hero, feature at 1 → `200`; a second movie at 1 →
  `FEATURED_POSITION_TAKEN { position: 1, movieId }`; at 2 → `200`; another movie's video as hero
  → `VALIDATION_FAILED`; `heroVideoId: null` and `DELETE` of the hero video while featured →
  `MOVIE_NOT_FEATURABLE ['no_hero_video']`; unfeature, then deleting the hero clears
  `heroVideoId`; archiving a featured movie frees its position; a direct SQL update giving two
  movies the same position fails on `uq_movies_featured_position`, and a featured row without a
  hero fails `chk_movies_featured`; two parallel `PATCH`es for position 3 on two movies → one
  `200`, one `409` (`FEATURED_POSITION_TAKEN` or `CONFLICT`), never two holders.
- Credits replace: `PUT` three credits (actor with character, director, voice) → order and
  `position` 0–2; `PUT` two others → only those two remain; `PUT []` → none; unknown person,
  `characterName` on `writer`, duplicate pair → `VALIDATION_FAILED` with field paths, nothing
  changed; audit `movie.credits_replaced { count }`.
- People: create with roles `['director']` → `201`; `PATCH` bio and links; `PUT
  /people/{id}/credits` adds an actor credit on two movies → each appended last in its movie's
  list, both movies' `updatedAt` touched, `creditedRoles: ['actor']`; the list's `roleGroup=actors`
  finds the person through the credit, `roleGroup=directors` through the set role.
- Person delete removes credits: a person credited on two movies, with a photo → `DELETE` `204`;
  no `movie_credits` or `person_roles` rows left, both movies' credit lists renumbered, their
  `updatedAt` touched, the photo's `images` row and files gone after commit, audit `person.deleted
  { creditCount: 2 }`.
- YouTube through HTTP: `POST /videos` with each accepted form (a parameterised subset: watch,
  youtu.be, shorts, embed, nocookie embed) stores the 11-character id and answers `embedUrl` and
  `thumbnailUrl`; vimeo, a look-alike host and a bare id → `VALIDATION_FAILED` on `url`, nothing
  stored; the same link twice → `409 CONFLICT`; `PATCH position` reorders contiguously; the
  21st video → `CONFLICT { limit: 20 }`.
- Photos through the real pipeline (local adapter): a 1600 × 900 JPEG with `kind still` and a
  caption → `201`, three WebP files, URLs served by `/media`; set it as backdrop → `200`; a
  1200 × 900 photo as backdrop → `IMAGE_WRONG_SHAPE`; deleting the backdrop photo clears
  `backdropPhotoId` and removes its files after commit; poster `PUT` 800 × 1200 PNG → set, a
  second `PUT` deletes the first prefix after commit, a square poster → `IMAGE_WRONG_SHAPE` with
  nothing stored; person photo 600 × 600 → set, 599 × 599 → `IMAGE_WRONG_SHAPE`; `POST /photos`
  without a key → `IDEMPOTENCY_KEY_REQUIRED`; same key and file → replay with
  `Idempotent-Replayed: true` and one row; unknown movie → `404` before any file is written; the
  31st photo → `CONFLICT { limit: 30 }` and no leftover prefix.
- Delete: a draft with genres, credits, poster, photos (one the backdrop) and videos (one the
  hero) → `204`, every child row and `images` row gone, files gone after commit; a test module
  registering a `has_bookings` blocker → `MOVIE_NOT_DELETABLE { reasons: ['has_bookings'] }`,
  nothing deleted.
- Bulk archive: four movies (draft, coming soon, featured now showing, already archived) →
  `archivedIds` three, `alreadyArchivedIds` one, the featured position freed, three
  `movie.archived` rows; an unknown id in the set → `404 { missingIds }`, nothing changed.
- Admin lists: 25 movies → pages of 20 and 5, `total`, `statusCounts`; `q` matches part of a title
  and part of a credited person's name, case-insensitive, and `%` matches literally; `status`
  filter. People: order by name, `q`, `roleGroup`, `knownFor`, `creditCount`.
- Reads for U7/U8: `listPublicMovies` excludes draft and archived and orders each status as
  specified, honours `genreIds`, `personIds`, `q` and `movieIds`; `countPublicMovies`,
  `countPublicMoviesByGenre`; `findPublicMovie` returns genres in order, credits, photos, videos
  and the hero and `null` for a draft; `listFeatured` by position; `listSimilar` ranks by shared
  genres and excludes the movie itself; `listPublicPeople` only people on public movies;
  `lockMovieForShare` blocks a concurrent status change until commit; the number of queries
  (Knex `query` event) is the same for 1 and 10 movies in `listPublicMovies` and `GET
  /admin/movies`.
- Access: every route from `listHttpRoutes()` under `/api/v1/admin/movies` and
  `/api/v1/admin/people` (asserted to be the 23 above) answers `403 FORBIDDEN` to a box-office
  token and `401 UNAUTHENTICATED` to none.
- Audit: each write leaves its row with field names only; no title, name, bio or URL value
  appears in `audit_events`.
- Contract: `npm run contract` regenerates `contracts/openapi.yaml` with the 23 operations, the
  four codes, and `GenreRef`, `Video`, `VideoKind`, `AgeRating` matching the home-page draft.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass, proving issue #7: movie create, edit, publish and archive with their
  rules; featured position uniqueness and the hero-video rule; credits replace; person delete
  removes credits; every accepted YouTube URL form parses to the id and bad URLs are refused;
  photo upload through the real pipeline with the local storage adapter; every catalog admin
  route refuses a box-office token with `FORBIDDEN`.
- `docs/system-design.md` §6.2 (genre slug, `movie_genres.sort_order`, movie detail columns,
  composite media FKs, photo and video columns), §11 (`PUT`/`DELETE /admin/movies/{id}/poster`,
  `PUT /admin/people/{id}/credits`) and §14.3 (four codes) updated; follow-ups for U7
  (`has_showtimes` blocker, `showtimes.movie_id` FK, `lockMovieForShare`) and U10 (`has_bookings`)
  recorded; `docs/gh-7-catalog/spec.md` is this draft.
