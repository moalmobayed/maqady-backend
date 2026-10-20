---
title: U4b — Theaters - hours, special dates, phones, facilities, photos, prices, publishing
owner: Mohamed Tarek
status: In progress
last_verified: 2026-10-20
tags: [theaters, opening-hours, special-dates, summer-time, zone-prices, publishing, photos, admin]
---

# U4b — Theaters: hours, special dates, phones, facilities, photos, prices, publishing

Issue: #5 (second half; U4a Media is the first). Docs folder: `docs/gh-5-theaters/`. Migration
prefix `0055`. Depends on U2a (`staff_users`, the staff resolver, `test/support/staff-auth.ts`,
`test/support/routes.ts`) and U4a (`images`, `MediaModule`, `MediaService`, `@ImageUpload()`).
Design: `docs/system-design.md` §5, §6.1, §6.2 (theaters and halls), §7.10, §8, §9 (theater
lifecycle, image pipeline), §11 (admin theater routes), §14, §15; PRD v2 "Theaters and movies",
"Time", "Prices", C4, C5, A4. Response shapes U8 reuses: `contracts/drafts/home-page.openapi.yaml`
(`TheaterCard`, `OpenState`, `Phone`, `Facility`, `Image`).

## Goal

An admin creates a theater as a draft, fills in its location, contacts, facilities, weekly
hours, holiday hours, zone prices and photos, publishes it, and toggles selling. Every later
unit asks one exported service whether a theater is open at an instant and what its opening
window is on a cinema date, judged by the Cairo wall clock with summer time handled once, in
`common/time`.

## Scope

- Migrations `0055_01`–`0055_07`: `theaters` (with the zone prices), `theater_phones`,
  `theater_facilities`, `theater_photos`, `theater_hours`, `theater_special_dates`, and the
  `images.created_by_staff_id → staff_users` FK that U4a hands over.
- `src/modules/theaters/` (`TheatersModule`): repositories, admin services, the three admin
  controllers, the exported `TheaterReadService`, `TheaterHoursService` and
  `TheaterLifecycleRegistry`, the pure `opening-hours.ts`.
- 16 admin routes (table below), audit events for every write, complete Swagger.
- `MoneyRequest` in `src/common/money/dto/money-request.dto.ts` (U7 reuses it for showtime prices).
- Error codes `THEATER_NOT_PUBLISHABLE` and `THEATER_NOT_DELETABLE`.
- `docs/system-design.md` §6.2, §11, §14.3 updated (Decisions below); `docs/INDEX.md`.

## Out of scope

- Halls, layouts and the "at least one active hall" publish condition (U5 registers it through
  `TheaterLifecycleRegistry`). `POST /admin/theaters/{id}/halls` is U5's.
- Showtimes and the "no showtimes" delete condition (U7 registers a deletion blocker; until then
  every draft is deletable). Follow-up recorded in this unit's `spec.md` and on issue #8.
- Every public route (`GET /theaters`, `/theaters/{id}`, `/home` cinemas): U8, from the exported
  read services. Hall counts and seat counts: U5/U8. Revenue columns of the admin list: U17.
- Sales-paused effects on holds and listings (U8, U10 read `status`).

## Decisions taken here

| Decision | Why |
|---|---|
| Weekly hours and special-date hours are sent as `opens`/`closes` `HH:mm`; `opens` must be 06:00–23:59; `closes` at or before 06:00 means the next calendar day (`00:00` → 1440, `06:00` → 1800), otherwise the same day; the result must satisfy `opens < closes` | Matches the stored minutes of §6.2 (`360 <= opens < closes <= 1800`) and the editor's "next day" tag, with no extra flag to get wrong. |
| `PUT /hours` always carries all 7 ISO weekdays (1 = Monday … 7 = Sunday, U1's numbering), each open or closed | "Hours are set" then means 7 rows exist; no partial weeks. |
| Publish requires: zone prices set (`prices`), 7 weekly rows with at least one open weekday (`hours`), plus every requirement other units register (`active_hall`, U5). Refused with `409 THEATER_NOT_PUBLISHABLE`, `details.missing` = the unmet keys: the two built-in ones first (fixed in `TheatersService`), then the registered ones in registration order | §9. A specific code lets the admin page show a checklist. Built-ins are not registered, so module start-up order cannot reorder them. |
| Status changes: `draft → active` (publish), `active ↔ sales_paused`. Anything else (back to `draft`, `draft → sales_paused`) is `409 CONFLICT` with `details: { from, to }` | PRD: published theaters are paused, never un-published. A catalogue code is not worth it for transitions the UI never offers (as U2b did). |
| Delete: only `draft`, and only when no registered deletion blocker objects; otherwise `409 THEATER_NOT_DELETABLE`, `details.reasons` (`not_draft`, or a blocker key such as `has_showtimes`) | PRD "Only a Draft theater with no showtimes can be deleted. Any other theater is paused instead." |
| Theaters are hard-deleted (children `ON DELETE CASCADE`, their images deleted through `MediaService.deleteMany`, files after commit); no `deleted_at` | Only an unpublished draft can go, so nothing ever referenced it. |
| Every theater write locks the theater row `FOR NO KEY UPDATE` first, then touches its children; deleting a theater locks it `FOR UPDATE`. U5 and U7 lock it `FOR SHARE` (`TheaterReadService.lockForShare`) before any hall or showtime row | Serialises publish against U5's hall retire and hours changes against U7's scheduling (`FOR SHARE` conflicts with both). `NO KEY UPDATE`, as U2a does for staff rows, lets other transactions' foreign-key checks (`FOR KEY SHARE`, a new hall or showtime row) proceed instead of queueing behind an unrelated edit. The theater row comes before step 2 of §7.1. |
| Theater names are unique, case-insensitive (`name CITEXT UNIQUE`); a clash is the generic `409 CONFLICT` with `details.constraint = 'uq_theaters_name'` | Two "Maqady Zamalek" cards would be ambiguous. The global filter already maps it. |
| Cover and gallery are separate: `theaters.cover_image_id` (kind `backdrop`, 16:9, at least 1280 × 720) and `theater_photos` (kind `gallery`). One upload route takes a `usage` field (`cover` or `gallery`); a cover upload replaces the old cover (old image deleted after commit). Removing a cover without replacing it: `DELETE /admin/theaters/{id}/cover` (added to §11) | §6.2 has both columns; U4a recommends `backdrop` for the cover; the TheaterCard shows a 16:9 cover. |
| At most 20 gallery photos per theater; the 21st is `409 CONFLICT` `details: { limit: 20 }` (its uploaded files are deleted by `MediaService`) | Free-tier storage (PRD); the designs show four. |
| Gallery order is `sort_order`, kept contiguous `0…n-1` by the service; `PATCH` a photo with `position` moves it (clamped to the last place) and renumbers the rest in one statement | No unique constraint to juggle during a reorder. |
| Photo alt text: the photo's `caption`, else the theater name; the cover's alt is the theater name | U4a: owners pass `alt` to `toImageResponse()`. |
| Phones are labelled numbers in E.164 (`^\+[1-9][0-9]{6,14}$`), 0–10, in array order; the first one is the "main phone". There are no separate manager columns: "Cinema manager" is just a label | One list covers Main line, Box office, WhatsApp, Group bookings and the manager (design inventory "Contacts"). |
| Zone prices are `{ amount, currency }` per zone, `amount` 1–1,000,000 piastres, `currency` `EGP`, all three the same currency; once set they can be replaced, never cleared | §6.1, §7.10; the CHECK requires them outside `draft`. A price change affects new showtimes only (U7 copies them). |
| Changing hours or special dates never touches existing showtimes and is not refused because of them | Sold tickets stay valid; only new scheduling and moves are checked (U7, §8). See Q1 below. |
| A special date must not be before today's cinema date (by the `Clock`), on create and as the result of a `PATCH` (`VALIDATION_FAILED` on `cinemaDate`); deleting a past one is allowed; a second special date on the same cinema date is `409 CONFLICT` (`uq_theater_special_dates_theater_id_cinema_date`) | Past hours change nothing that matters. |
| Open state (`isOpen`, `closesAt`, `nextOpensAt`) ignores `status`; callers filter by status | One computation for the admin list and U8. |
| `nextOpensAt` looks at the current cinema date and the next 7 (8 windows); none → `null` | The contract: "null if no opening is scheduled in the next 7 days". |
| `PATCH /admin/theaters/{id}` may change fields and `status` together; the fields are applied first, then the transition is checked | One request can fix a typo and publish. |
| Writes on the theater and its photos answer the full `TheaterResponse`; special-date writes answer `SpecialDateResponse`; deletes answer `204` | The admin page refreshes one object. |
| A `PATCH` that changes nothing answers `200`, writes no audit row | Same rule as U2a. |
| Response schema names `Phone` (`TheaterPhoneResponse`), `OpenState` (`OpenStateResponse`) and enum `Facility` via `@ApiSchema({ name })` / `enumName` | U8 reuses these DTOs to match the home-page draft exactly. |

### Open questions, decided

The draft of this spec left six questions open. Each is decided here from the PRD and the design;
an owner can reverse any of them in a later change.

| # | Question | Decision | Why |
|---|---|---|---|
| Q1 | When weekly hours or a special date change so that scheduled (possibly sold) showtimes fall outside them: refuse, warn, or allow? | **Allow, silently.** Existing showtimes are untouched; only new scheduling and moves are checked against the new hours (U7). | PRD "existing tickets stay valid" and §8 put the hours check on scheduling, not on the hours editor. Refusing would let one sold showtime block a holiday closure; a warning needs a showtime query this unit cannot make (U7 owns showtimes). Follow-up for U7: the admin timeline can flag showtimes outside the current hours. |
| Q2 | Is a manager contact that admins see but the public never sees needed? | **No.** "Cinema manager" is a labelled phone like any other, public only while `showContactsPublic` is on. | PRD C5 has one rule for every phone and the email ("only when show contacts is on"). Nothing in the PRD reads a private manager field; an admin who wants a number kept private does not add it. YAGNI. |
| Q3 | Can a published theater go back to Draft? | **No.** `active` and `sales_paused` toggle between each other only; `draft` is left once, by publishing. | PRD "Any other theater is paused instead"; the design has no un-publish control. |
| Q4 | Does "opening hours" for publishing mean at least one open weekday? | **Yes**: all 7 weekly rows exist and at least one is open. Special dates do not count. | A theater closed every week can never be scheduled (§8), so publishing it would show an empty theater. Special dates only adjust single days. |
| Q5 | Is a cap of 20 gallery photos acceptable? | **Yes, 20.** | The designs show 4; 20 leaves room while bounding free-tier storage (each photo is three WebP files). The constant is one line to change. |
| Q6 | Can two theaters share a name (in different cities)? | **No**: names are unique, case-insensitive. | The chain names its theaters by area ("Maqady Zamalek"), the cards, search results and ticket emails show the name alone, and two equal names would be ambiguous there. A clash is `409 CONFLICT` with `details.constraint = 'uq_theaters_name'`. |

## Modules and files

**`src/modules/theaters/`** — `TheatersModule`, imports `MediaModule`. Providers: the three
repositories, `TheatersService`, `TheaterSpecialDatesService`, `TheaterPhotosService`, `TheaterReadService`,
`TheaterHoursService`, `TheaterLifecycleRegistry`. Exports: `TheaterReadService`,
`TheaterHoursService`, `TheaterLifecycleRegistry`. `AppModule` imports `TheatersModule`.

| File | Holds |
|---|---|
| `enums.ts` | `THEATER_STATUSES = ['draft','active','sales_paused']`, `FACILITIES = ['wheelchair_access','free_parking','valet_parking','street_parking','cafe_bar','food_court','kids_room']`, `PHOTO_USAGES = ['cover','gallery']`, `HOURS_SOURCES = ['weekly','special','none']` |
| `types.ts` | `TheaterStatus`, `Facility`, `PhotoUsage`, `HoursSource`, `TheaterRow`, `NewTheaterRow`, `TheaterPhoneRow`, `TheaterPhotoRow`, `TheaterHoursRow`, `SpecialDateRow`, `TheaterPhone`, `TheaterPhoto`, `ZonePrices`, `DayHours`, `SpecialDate`, `TheaterDetails`, `TheaterSummary`, `TheaterListFilter`, `TheaterChanges`, `OpeningWindow`, `CinemaDateHours`, `OpenState`, `TheaterPublishRequirement`, `TheaterDeletionBlocker` |
| `theaters.constants.ts` | `MAX_PHONES = 10`, `MAX_GALLERY_PHOTOS = 20`, `MAX_PRICE_AMOUNT = 1_000_000`, `PHONE_NUMBER_PATTERN`, `OPEN_STATE_LOOKAHEAD_DAYS = 7`, `MAX_HOURS_RANGE_DAYS = 31`, `MIN_OPENS_MINUTE = 360`, `MAX_CLOSES_MINUTE = 1800` |
| `opening-hours.ts` | pure: `wallClockToOpeningMinute(time, 'opens' \| 'closes')`, `openingMinuteToWallClock(minute)` → `{ time, nextDay }`, `resolveCinemaDateHours(weekly, specials, cinemaDate)`, `openStateAt(hoursByDate, at)` |
| `theaters.repository.ts` | theaters, phones, facilities: `insert`, `findById`, `findByIdForUpdate`, `findByIdForShare`, `findByIds`, `list`, `count`, `listByStatus`, `update`, `deleteById`, `replacePhones`, `phonesOf(ids)`, `replaceFacilities`, `facilitiesOf(ids)` |
| `theater-hours.repository.ts` | `replaceWeekly`, `weeklyOf(ids)`, `specialDatesBetween(ids, from, to)`, `insertSpecialDate`, `findSpecialDate(theaterId, id)`, `updateSpecialDate`, `deleteSpecialDate` |
| `theater-photos.repository.ts` | `photosOf(ids)`, `countFor`, `insert`, `findPhoto(theaterId, id)`, `updateCaption`, `reorder(theaterId, orderedIds)` (one `UPDATE … FROM unnest(?::bigint[]) WITH ORDINALITY`), `delete`, `renumber` |
| `theater-lifecycle.registry.ts` | `TheaterLifecycleRegistry` |
| `theaters.service.ts` | `TheatersService` (admin CRUD, PUTs, status, delete; registers `prices` and `hours` in `onModuleInit`) |
| `theater-special-dates.service.ts` | `TheaterSpecialDatesService` |
| `theater-photos.service.ts` | `TheaterPhotosService` (the `link` callbacks, patch, delete, cover removal) |
| `theater-read.service.ts`, `theater-hours.service.ts` | the exported services |
| `theater-response.mapper.ts` | `toTheaterResponse`, `toTheaterListItem`, `toDayHoursResponse`, `toSpecialDateResponse`, `toOpenStateResponse` |
| `admin-theaters.controller.ts` | `@Controller('admin/theaters')`: list, create, get, patch, delete, the four PUTs |
| `admin-theater-special-dates.controller.ts` | `@Controller('admin/theaters/:id/special-dates')` |
| `admin-theater-photos.controller.ts` | `@Controller('admin/theaters/:id')`: `photos`, `photos/:photoId`, `cover` |
| `dto/` | requests: `create-theater.request.ts`, `update-theater.request.ts`, `theater-list.query.ts`, `theater-id.params.ts` (`TheaterIdParams`, `SpecialDateParams`, `TheaterPhotoParams`), `replace-hours.request.ts` (`ReplaceHoursRequest`, `DayHoursRequest`), `replace-phones.request.ts` (`ReplacePhonesRequest`, `PhoneRequest`), `replace-facilities.request.ts`, `replace-prices.request.ts`, `create-special-date.request.ts`, `update-special-date.request.ts`, `theater-photo-fields.request.ts`, `update-theater-photo.request.ts`; responses: `theater.response.ts`, `theater-list-item.response.ts`, `theater-page.response.ts`, `theater-phone.response.ts`, `day-hours.response.ts`, `special-date.response.ts`, `zone-prices.response.ts`, `theater-photo.response.ts`, `open-state.response.ts`, `today-hours.response.ts` |
| `theaters.module.ts` | the module |

Path params (`id`, `specialDateId`, `photoId`): positive integers (`@Type(() => Number)`, `IsInt`,
`Min(1)`), else `VALIDATION_FAILED`. Text inputs are trimmed (`@Transform`) before length checks.

## Migrations (prefix `0055`)

Every table: `ALTER TABLE … ENABLE ROW LEVEL SECURITY`; no defaults; times from the `Clock`;
every index commented with its query. Enum CHECKs mirror `enums.ts`.

**`0055_01_create_theaters`**

```sql
CREATE TABLE theaters (
  id BIGSERIAL PRIMARY KEY,
  name CITEXT NOT NULL,
  status VARCHAR(16) NOT NULL,
  address VARCHAR(200) NOT NULL,
  district VARCHAR(80) NOT NULL,
  city VARCHAR(80) NOT NULL,
  latitude NUMERIC(9,6) NOT NULL,
  longitude NUMERIC(9,6) NOT NULL,
  transit_info VARCHAR(500) NULL,
  parking_info VARCHAR(500) NULL,
  email CITEXT NULL,
  show_contacts_public BOOLEAN NOT NULL,
  cover_image_id BIGINT NULL,
  default_price_front INT NULL,
  default_price_middle INT NULL,
  default_price_back INT NULL,
  currency VARCHAR(3) NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_theaters_name UNIQUE (name),
  CONSTRAINT uq_theaters_cover_image_id UNIQUE (cover_image_id),
  CONSTRAINT fk_theaters_cover_image_id FOREIGN KEY (cover_image_id) REFERENCES images (id),
  CONSTRAINT chk_theaters_status CHECK (status IN ('draft', 'active', 'sales_paused')),
  CONSTRAINT chk_theaters_name CHECK (length(name) BETWEEN 2 AND 100 AND btrim(name) = name),
  CONSTRAINT chk_theaters_latitude CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_theaters_longitude CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT chk_theaters_email CHECK (email IS NULL OR (length(email) <= 320 AND email ~ '^[^\s@]+@[^\s@]+$')),
  CONSTRAINT chk_theaters_prices_positive CHECK (default_price_front > 0 AND default_price_middle > 0 AND default_price_back > 0),
  CONSTRAINT chk_theaters_prices_complete CHECK (num_nonnulls(default_price_front, default_price_middle, default_price_back, currency) IN (0, 4)),
  CONSTRAINT chk_theaters_currency CHECK (currency = 'EGP'),
  CONSTRAINT chk_theaters_prices_when_published CHECK (status = 'draft' OR currency IS NOT NULL)
);
```

| Index | Columns | Query it serves |
|---|---|---|
| `uq_theaters_name` | `(name)` | Admin list unfiltered, `ORDER BY name, id`, cursor `(name, id) > (?::citext, ?)`; name uniqueness |
| `idx_theaters_status_name` | `(status, name)` | Admin list with `status`; `listActive()` `WHERE status = 'active' ORDER BY name` |
| `uq_theaters_cover_image_id` | `(cover_image_id)` | Covers `fk_theaters_cover_image_id`; an image is the cover of at most one theater |

**`0055_02_create_theater_phones`** — `id BIGSERIAL`, `theater_id BIGINT NOT NULL`
(`fk_theater_phones_theater_id` → `theaters ON DELETE CASCADE`), `label VARCHAR(40) NOT NULL`
(CHECK trimmed, non-empty), `number VARCHAR(16) NOT NULL` (CHECK `~ '^\+[1-9][0-9]{6,14}$'`),
`sort_order SMALLINT NOT NULL` (CHECK `>= 0`), `created_at`. `uq_theater_phones_theater_id_sort_order
UNIQUE (theater_id, sort_order)`: covers the FK; "phones of theaters `WHERE theater_id IN (…)
ORDER BY theater_id, sort_order`" (the main phone is `sort_order = 0`).

**`0055_03_create_theater_facilities`** — `theater_id BIGINT NOT NULL`
(`fk_theater_facilities_theater_id`, `ON DELETE CASCADE`), `facility VARCHAR(32) NOT NULL` (CHECK
in `FACILITIES`), `PRIMARY KEY (theater_id, facility)`: covers the FK; "facilities of theaters
`WHERE theater_id IN (…)`".

**`0055_04_create_theater_photos`** — `id BIGSERIAL`, `theater_id BIGINT NOT NULL`
(`fk_theater_photos_theater_id`, `ON DELETE CASCADE`), `image_id BIGINT NOT NULL`
(`fk_theater_photos_image_id` → `images`, no action), `caption VARCHAR(120) NULL` (CHECK trimmed,
non-empty when present), `sort_order SMALLINT NOT NULL` (CHECK `>= 0`), `created_at`, `updated_at`.
Indexes: `uq_theater_photos_image_id UNIQUE (image_id)` (covers the image FK; an image belongs
to one photo); `idx_theater_photos_theater_id_sort_order (theater_id, sort_order, id)` (covers
the theater FK; "gallery of theaters `WHERE theater_id IN (…) ORDER BY theater_id, sort_order,
id`").

**`0055_05_create_theater_hours`**

```sql
CREATE TABLE theater_hours (
  theater_id BIGINT NOT NULL,
  weekday SMALLINT NOT NULL,
  is_closed BOOLEAN NOT NULL,
  opens_minute SMALLINT NULL,
  closes_minute SMALLINT NULL,
  CONSTRAINT pk_theater_hours PRIMARY KEY (theater_id, weekday),
  CONSTRAINT fk_theater_hours_theater_id FOREIGN KEY (theater_id) REFERENCES theaters (id) ON DELETE CASCADE,
  CONSTRAINT chk_theater_hours_weekday CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT chk_theater_hours_minutes CHECK (
    (is_closed AND opens_minute IS NULL AND closes_minute IS NULL)
    OR (NOT is_closed AND opens_minute >= 360 AND opens_minute < 1440
        AND opens_minute < closes_minute AND closes_minute <= 1800))
);
```

The PK covers the FK and serves "weekly hours of theaters `WHERE theater_id IN (…)`".

**`0055_06_create_theater_special_dates`** — `id BIGSERIAL`, `theater_id BIGINT NOT NULL`
(`fk_theater_special_dates_theater_id`, `ON DELETE CASCADE`), `cinema_date DATE NOT NULL`,
`label VARCHAR(80) NOT NULL` (CHECK trimmed, non-empty), `is_closed`, `opens_minute`,
`closes_minute` with `chk_theater_special_dates_minutes` exactly as above, `created_at`,
`updated_at`. `uq_theater_special_dates_theater_id_cinema_date UNIQUE (theater_id, cinema_date)`:
covers the FK; "special dates of theaters `WHERE theater_id IN (…) AND cinema_date BETWEEN ? AND
?`" (equality then range).

**`0055_07_add_images_created_by_staff_fk`** — `ALTER TABLE images ADD CONSTRAINT
fk_images_created_by_staff_id FOREIGN KEY (created_by_staff_id) REFERENCES staff_users (id)`
(U4a created `idx_images_created_by_staff_id`).

Follow-ups written into U5 and U7: `halls.theater_id` FK `ON DELETE CASCADE` (a draft's halls go
with it); `showtimes.theater_id` FK with no action (the database backstop for the blocker).

## Behaviour

**Opening hours** (`opening-hours.ts`, design §8). The hours of a cinema date are the special
date's row if one exists, else the weekday row (`weekdayOfCinemaDate`), else none. The window is
`[cinemaMinuteToInstant(date, opens), cinemaMinuteToInstant(date, closes))`, so a stored minute
in a skipped hour moves forward and an ambiguous one takes its first occurrence (U1). Windows of
different cinema dates never overlap (06:00 to 06:00 bounds), so:

- `d0 = cinemaDateOf(at)`. If `d0`'s window contains `at` → `{ isOpen: true, closesAt,
  nextOpensAt: null }`.
- Else `{ isOpen: false, closesAt: null, nextOpensAt }`: the first window opening after `at`
  among `d0 … d0 + 7`, or `null`.

Egypt's 2026 changes, which the tests pin: summer time starts Friday 24 April at 00:00 (00:00–00:59
does not exist) and ends at the end of Thursday 29 October (23:00–23:59 on 29 October happens
twice).

**Publish** (`TheatersService.update`, request transaction): lock theater `FOR UPDATE` → apply
field changes → if `status` changes, check the transition; for `draft → active` run every
`TheaterPublishRequirement.isMet(id)` (built-in `prices`: prices non-null; `hours`: 7 weekly rows
and at least one open) and refuse with the unmet keys → update → audit.

**Delete**: lock `FOR UPDATE` → `not_draft` if not draft → every `TheaterDeletionBlocker.blocks(id)`
→ collect cover and gallery image ids → delete the theater (children cascade) →
`MediaService.deleteMany(ids)` (rows now, files after commit) → audit.

**Photo upload** (`@NoRequestTransaction()` route): the controller checks the theater exists (one
read, fast `404` before image work), then `MediaService.upload({ kind: usage === 'cover' ?
'backdrop' : 'gallery', upload, actor, link })`. `link(image)` runs inside the media transaction:
lock theater `FOR UPDATE` (`NOT_FOUND` if deleted meanwhile); cover → set `cover_image_id`, then
`MediaService.delete(oldId)`; gallery → `CONFLICT { limit: 20 }` when full, else insert at
`sort_order = count`; audit; return `TheaterResponse`.

**Audit events** (`AuditService.record`, inside the write's transaction; actor = the staff
principal; changed fields are API field names, never values):

| Action | Entity | Changed fields / metadata |
|---|---|---|
| `theater.created` | `theater` | — |
| `theater.updated` | `theater` | changed field names (not `status`) |
| `theater.published` / `theater.sales_paused` / `theater.sales_resumed` | `theater` | `{ from, to }` |
| `theater.deleted` | `theater` | `{ photoCount }` |
| `theater.hours_replaced` | `theater` | `{ openDays }` |
| `theater.phones_replaced` | `theater` | `{ count }` |
| `theater.facilities_replaced` | `theater` | `{ count }` |
| `theater.prices_replaced` | `theater` | `{ front, middle, back, currency }` |
| `theater.cover_replaced` / `theater.cover_removed` | `theater` | — |
| `theater_special_date.created` / `.updated` / `.deleted` | `theater_special_date` | `{ theaterId, cinemaDate }`; `.updated` adds changed field names |
| `theater_photo.created` / `.updated` / `.deleted` | `theater_photo` | `{ theaterId }`; `.updated` adds changed field names |

## Endpoints

All under `/api/v1`, `@Admin()`, `@ApiTags('Admin: theaters')`, each with summary, description
and `@ApiErrorResponses(...)` for its codes (U1 adds access, idempotency and `429`). "Key" = the
optional `Idempotency-Key` is claimed and stored by the write interceptor; **S** = `@Strict()`.

| Route | Idem. | Request | Response | Errors |
|---|---|---|---|---|
| `GET /admin/theaters` | — | `TheaterListQuery` | `200 TheaterPage` | `VALIDATION_FAILED` |
| `POST /admin/theaters` | **S** | `CreateTheaterRequest` | `201 TheaterResponse` | `VALIDATION_FAILED`, `CONFLICT` |
| `GET /admin/theaters/{id}` | — | `TheaterIdParams` | `200 TheaterResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PATCH /admin/theaters/{id}` | key | `UpdateTheaterRequest` | `200 TheaterResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT`, `THEATER_NOT_PUBLISHABLE` |
| `DELETE /admin/theaters/{id}` | key | — | `204` | `VALIDATION_FAILED`, `NOT_FOUND`, `THEATER_NOT_DELETABLE` |
| `PUT /admin/theaters/{id}/hours` | key | `ReplaceHoursRequest` | `200 TheaterResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PUT /admin/theaters/{id}/phones` | key | `ReplacePhonesRequest` | `200 TheaterResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PUT /admin/theaters/{id}/facilities` | key | `ReplaceFacilitiesRequest` | `200 TheaterResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `PUT /admin/theaters/{id}/prices` | key | `ReplacePricesRequest` | `200 TheaterResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /admin/theaters/{id}/special-dates` | **S** | `CreateSpecialDateRequest` | `201 SpecialDateResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT` |
| `PATCH /admin/theaters/{id}/special-dates/{specialDateId}` | key | `UpdateSpecialDateRequest` | `200 SpecialDateResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT` |
| `DELETE /admin/theaters/{id}/special-dates/{specialDateId}` | key | — | `204` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /admin/theaters/{id}/photos` | **S**, `@ImageUpload({ fields: TheaterPhotoFieldsRequest })` | multipart `file` + fields | `201 TheaterResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT` + U4a's image codes |
| `PATCH /admin/theaters/{id}/photos/{photoId}` | key | `UpdateTheaterPhotoRequest` | `200 TheaterResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `DELETE /admin/theaters/{id}/photos/{photoId}` | key | — | `204` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `DELETE /admin/theaters/{id}/cover` | key | — | `204` (also when there is no cover) | `VALIDATION_FAILED`, `NOT_FOUND` |

A special date or photo that belongs to another theater is `NOT_FOUND`.

**Request DTOs**

- `CreateTheaterRequest`: `name` (2–100), `address` (1–200), `district` (1–80), `city` (1–80),
  `latitude` (−90…90, ≤ 6 decimals), `longitude` (−180…180, ≤ 6 decimals), optional nullable
  `transitInfo`, `parkingInfo` (≤ 500), `email` (`IsEmail`, ≤ 320), optional `showContactsPublic`
  (boolean, service default `false`).
- `UpdateTheaterRequest`: every field above optional, plus optional `status` (`IsIn(THEATER_STATUSES)`);
  at least one present, else `VALIDATION_FAILED`.
- `TheaterListQuery` extends `PageQuery`: optional `status`. Order `name, id`; sort key `name`;
  `total` with the same filter.
- `ReplaceHoursRequest`: `days: DayHoursRequest[]`, exactly 7, each `weekday` 1–7 once.
  `DayHoursRequest`: `weekday`, `closed` (boolean), `opens`, `closes` (`HH:mm`, required when
  open, forbidden when closed); the Decisions rule, else `VALIDATION_FAILED` on `days.<i>.closes`.
- `ReplacePhonesRequest`: `phones: PhoneRequest[]` (0–10); `PhoneRequest`: `label` (1–40),
  `number` (E.164).
- `ReplaceFacilitiesRequest`: `facilities` (`IsIn(FACILITIES)` each, `ArrayUnique`, 0–7).
- `ReplacePricesRequest`: `front`, `middle`, `back`: `MoneyRequest` (`amount` integer
  1–1,000,000, `currency` `IsIn(CURRENCIES)`); mixed currencies → `VALIDATION_FAILED`.
- `CreateSpecialDateRequest`: `cinemaDate` (`isCalendarDate`, not before today's cinema date),
  `label` (1–80), `closed`, `opens`, `closes` (as `DayHoursRequest`).
  `UpdateSpecialDateRequest`: each optional, at least one; the merged result is validated as a
  whole (in the service, `VALIDATION_FAILED` with field paths).
- `TheaterPhotoFieldsRequest` (multipart text fields): `usage` (`cover` | `gallery`, required),
  optional `caption` (1–120, gallery only).
- `UpdateTheaterPhotoRequest`: optional nullable `caption`, optional `position` (integer ≥ 0);
  at least one.

**Response DTOs**

- `TheaterResponse`: `id`, `name`, `status`, `address`, `district`, `city`, `latitude`,
  `longitude`, `transitInfo`, `parkingInfo`, `email` (nullable), `showContactsPublic`, `phones`
  (`TheaterPhoneResponse[]` = `{ label, number }`), `facilities` (`Facility[]`, `FACILITIES`
  order), `hours` (`DayHoursResponse[]`, 7 or empty), `specialDates` (`SpecialDateResponse[]`
  from today's cinema date on, by date), `defaultPrices` (`ZonePricesResponse` = `{ front,
  middle, back }` of `MoneyResponse`, or null), `cover` (`ImageResponse` or null), `photos`
  (`TheaterPhotoResponse[]` = `{ id, caption, position, image: ImageResponse }`), `openState`
  (`OpenStateResponse` at the `Clock`'s now), `publishBlockers` (unmet requirement keys; `[]`
  unless draft), `createdAt`, `updatedAt`.
- `DayHoursResponse`: `weekday`, `closed`, `opens`, `closes` (`HH:mm` or null), `closesNextDay`.
- `SpecialDateResponse`: `id`, `cinemaDate`, `label`, `closed`, `opens`, `closes`,
  `closesNextDay`.
- `OpenStateResponse` (`OpenState`): `isOpen`, `closesAt`, `nextOpensAt` (ISO with offset or
  null), exactly as the home-page draft.
- `TheaterListItemResponse`: `id`, `name`, `status`, `district`, `city`, `address`, `cover`,
  `mainPhone` (`TheaterPhoneResponse` or null), `openState`, `today` (`TodayHoursResponse` =
  `{ cinemaDate, closed, opens, closes, closesNextDay, specialDateLabel }`), `updatedAt`.
  `TheaterPage = PageResponseOf(TheaterListItemResponse)`. A page costs a fixed number of
  queries (theaters, count, phones, hours, special dates, images).

## Error codes added

| Code | HTTP | Details |
|---|---|---|
| `THEATER_NOT_PUBLISHABLE` | 409 | `{ missing: string[] }`, e.g. `['prices', 'hours', 'active_hall']` |
| `THEATER_NOT_DELETABLE` | 409 | `{ reasons: string[] }`, e.g. `['not_draft']`, `['has_showtimes']` |

Catalogue descriptions: "Set the zone prices and opening hours (and an active hall) before
publishing." / "Only a draft theater with no showtimes can be deleted; pause ticket sales
instead."

## Services

**Exported by `TheatersModule`** (for U5, U7, U8):

```ts
class TheaterReadService {
  findById(id: number): Promise<TheaterDetails | null>;                 // any status (U5, U7)
  lockForShare(id: number): Promise<TheaterSummary | null>;             // FOR SHARE in the open
                                                                        // transaction (U5, U7)
  listActive(): Promise<readonly TheaterDetails[]>;                     // status active, by name;
                                                                        // fixed query count (U8)
  findActive(id: number): Promise<TheaterDetails | null>;               // U8 /theaters/{id}
  findActiveByIds(ids: readonly number[]): Promise<ReadonlyMap<number, TheaterDetails>>;
}
// TheaterSummary = { id; name; status: TheaterStatus; defaultPrices: ZonePrices | null }
// ZonePrices = { front: Money; middle: Money; back: Money }
// TheaterDetails = TheaterSummary & { address; district; city; latitude: number; longitude: number;
//   transitInfo: string | null; parkingInfo: string | null; email: string | null;
//   showContactsPublic: boolean; phones: readonly TheaterPhone[] /* { label; number }, in order */;
//   facilities: readonly Facility[]; cover: StoredImage | null;
//   photos: readonly TheaterPhoto[] /* { id; caption; position; image: StoredImage } */;
//   createdAt: Date; updatedAt: Date }
// U8 hides phones and email itself when showContactsPublic is false.

class TheaterHoursService {
  windowFor(theaterId: number, cinemaDate: CalendarDate): Promise<OpeningWindow | null>; // U7
  hoursFor(theaterIds: readonly number[], from: CalendarDate, to: CalendarDate):
    Promise<ReadonlyMap<number, readonly CinemaDateHours[]>>;  // every date from..to (≤ 31), 2 queries
  openStates(theaterIds: readonly number[], at: Date): Promise<ReadonlyMap<number, OpenState>>;
  weeklyHours(theaterIds: readonly number[]): Promise<ReadonlyMap<number, readonly DayHours[]>>;
}
// OpeningWindow = { opensAt: Date; closesAt: Date }
// CinemaDateHours = { cinemaDate; weekday: IsoWeekday; source: HoursSource;
//   specialDateLabel: string | null; window: OpeningWindow | null }
// OpenState = { isOpen: boolean; closesAt: Date | null; nextOpensAt: Date | null }
// DayHours = { weekday: IsoWeekday; closed: boolean; opensMinute: number | null; closesMinute: number | null }

class TheaterLifecycleRegistry {
  addPublishRequirement(requirement: TheaterPublishRequirement): void; // duplicate key → throws
  addDeletionBlocker(blocker: TheaterDeletionBlocker): void;
}
// TheaterPublishRequirement = { key: string; isMet(theaterId: number): Promise<boolean> }
//   (runs in the publish transaction with the theater locked FOR UPDATE; U5 adds 'active_hall')
// TheaterDeletionBlocker = { key: string; blocks(theaterId: number): Promise<boolean> }
//   (U7 adds 'has_showtimes')
```

Also exported by path: `openingMinuteToWallClock()` (U8 formats hours), `FACILITIES`,
`TheaterPhoneResponse`, `OpenStateResponse`, `toOpenStateResponse()`.

**Consumed from U4a** (exact names): `MediaModule`, `MediaService.upload()`, `.findByIds()`,
`.delete()`, `.deleteMany()`, `.toImageResponse()`, `ImageUpload()`, `UploadedImage()`,
`ImageUploadPayload`, `UploadOutcome`, `StoredImage`, `ImageResponse`, image kinds `backdrop` and
`gallery`.

**Consumed from U2a**: nothing at runtime (the staff resolver authenticates the routes); tests use
`createStaffMember()`, `staffToken()`, `listHttpRoutes()`, `samplePath()`.

**Consumed from U1** (exact names): `TransactionRepository.run()`, `.afterCommit()` (through
`MediaService`), `TransactionContext.executor()`, `Strict()`, `Admin()`, `CurrentPrincipal()`,
`StaffPrincipal`, `AuditService.record()`, `Clock`, `cinemaDateOf()`, `weekdayOfCinemaDate()`,
`addDays()`, `cinemaMinuteToInstant()`, `isCalendarDate()`, `formatCairoIso()`,
`WALL_CLOCK_TIME_PATTERN`, `CalendarDate`, `IsoWeekday`, `Money`, `money()`, `CURRENCIES`,
`MoneyResponse`, `PageQuery`, `toPageRequest()`, `toPage()`, `PageResponseOf()`, `AppError`,
`ApiErrorResponses()`.

## Tests

**Unit** (`test/unit/modules/theaters/`):

- `opening-hours.test.ts` (pure, fixed instants):
  - minutes: `opens 05:59` refused; `closes 00:00` → 1440, `06:00` → 1800, `01:00` → 1500 and
    `nextDay`; `closes ≤ opens` refused; round trip minute → wall clock.
  - resolution: a special date replaces the weekday; a closed special date → no window; no rows →
    `none`.
  - open state on a normal day (weekly 12:00–01:00): 11:00 → closed, `nextOpensAt` 12:00 today;
    20:00 → open, `closesAt` 01:00 next calendar day; 01:30 Thursday is judged by Wednesday (open
    when Wednesday closes 02:00; closed with `nextOpensAt` Thursday 12:00 when it closes 01:00);
    after closing → next day's opening; a closed special date tomorrow skips to the day after; a
    special date with changed hours (11:00–03:00) is used; every day closed → `nextOpensAt null`;
    the only opening 8 days ahead → `null`.
  - summer time: cinema date 2026-04-23, closes 00:30 → `closesAt 2026-04-24T01:00:00+03:00`
    (shifted), and at `23:50+02:00` it is open; 2026-04-24 06:30 belongs to 2026-04-24 and opens
    at 12:00+03:00; cinema date 2026-10-29 closing 23:30 → `2026-10-29T23:30:00+03:00` (first
    occurrence), and at the second 23:45 (`+02:00`) it is closed with `nextOpensAt`
    `2026-10-30T12:00:00+02:00`; closing 01:00 on that date → `2026-10-30T01:00:00+02:00` (a
    window one hour longer in real time).
- `theaters.service.test.ts` (repositories, media and audit mocked): the transition table;
  `missing` lists built-in and registered keys in order; `reasons` for not-draft and a blocker; a
  no-op `PATCH` writes no audit row; field changes plus publish write two audit rows.
- `theater-lifecycle.registry.test.ts`: duplicate key throws; registration order kept.
- DTO validation (`ValidationPipe` with the global options): hours (6 or 8 days, a weekday twice,
  a closed day with times, an open day without), phones (non-E.164, 11 phones), facilities
  (duplicates, unknown), prices (0, 1,000,001, fraction, mixed currencies), photo fields (caption
  with `cover`).

**Integration** (`test/integration/modules/theaters/`, real app and Postgres, `TestClock`,
`STORAGE_DRIVER=local`, admin and box-office tokens from `staffToken()`):

- Flow: create (`201`, draft, audit `theater.created`) → `PATCH` fields → publish refused with
  `missing: ['prices','hours']` → `PUT /prices` → refused `['hours']` → `PUT /hours` all closed →
  still `['hours']` → `PUT /hours` with open days → publish `200 active` (audit
  `theater.published`) → pause → resume → back to `draft` and `draft → sales_paused` →
  `409 CONFLICT { from, to }`; duplicate name (other case) → `409 CONFLICT`.
- Seam: a test module registering an unmet `active_hall` requirement → `missing` includes it;
  a test blocker → `DELETE` → `THEATER_NOT_DELETABLE ['has_showtimes']`.
- Delete: a draft with phones, hours, special dates, a cover and photos → `204`, every child row
  and `images` row gone, files gone after commit; an active theater → `['not_draft']`.
- Sub-resources: `PUT /phones`, `/facilities` replace (second PUT leaves only the new set, order
  kept); special dates create, duplicate date → `CONFLICT`, past date → `VALIDATION_FAILED`,
  `PATCH` hours, `DELETE`, another theater's id → `NOT_FOUND`; `GET` lists only special dates from
  today's cinema date.
- Photos through the real pipeline (local adapter): gallery JPEG → `201`, three WebP files,
  response URLs served by `/media`; cover 1920 × 1080 PNG → cover set; a 1000 × 1000 cover →
  `IMAGE_WRONG_SHAPE`, nothing stored; replacing the cover deletes the old prefix after commit;
  `PATCH position` reorders contiguously; `DELETE` removes row and files; the 21st photo →
  `CONFLICT { limit: 20 }` and no leftover prefix; no key → `IDEMPOTENCY_KEY_REQUIRED`; same key
  and file → replay with `Idempotent-Replayed: true`; unknown theater → `404` before any file
  is written.
- Open state: `TheaterHoursService.openStates()` for three theaters (normal, after-midnight close,
  closed special date) with the `TestClock` at fixed instants, including 2026-04-23 23:50 and
  2026-10-29 23:45 (second occurrence); `windowFor()` with a changed special date; `GET
  /admin/theaters/{id}` `openState` matches.
- Reads: `listActive()` returns only active theaters, by name, with phones, facilities, cover and
  photos; the number of queries (counted with Knex's `query` event) is the same for 1 and 10
  theaters.
- List: 25 theaters → pages of 20 and 5 with `nextCursor`, `total`, `status` filter.
- Access: every route from `listHttpRoutes()` under `/api/v1/admin/theaters` (asserted to be the
  16 above) answers `403 FORBIDDEN` to a box-office token and `401 UNAUTHENTICATED` to none.
- Audit: each write leaves its row with field names only; no email, phone number or address
  value appears in `audit_events`.
- Contract: `npm run contract` regenerates `contracts/openapi.yaml` with the 16 operations, the
  two codes, and the `Phone`, `OpenState`, `Facility` schemas matching the home-page draft.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass, proving issue #5's theaters half: create, edit and publish, with publish
  refused when prices or hours are missing; the open-state computation for a normal day, a
  closing time after midnight, a closed special date, a special date with changed hours and both
  2026 summer-time transition days; photo upload through the real pipeline with the local storage
  adapter; every theater admin route refuses a box-office token with `FORBIDDEN`.
- `docs/system-design.md` §6.2 (theater columns, photo caption), §11 (`DELETE
  /admin/theaters/{id}/cover`) and §14.3 (two codes) updated; follow-ups for U5 (`active_hall`
  requirement, halls FK cascade, `lockForShare`) and U7 (`has_showtimes` blocker, `windowFor`)
  recorded; `docs/gh-5-theaters/spec.md` is this draft.
