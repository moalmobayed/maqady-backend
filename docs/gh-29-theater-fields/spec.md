---
title: "#29 P3 — Theater fields: prayer room, postal code, WhatsApp, total halls"
owner: Mohamed Tarek
status: Built
last_verified: 2026-11-13
tags: [theaters, discovery, facilities, contacts, seed, contract, frontend-gaps]
---

# #29 P3 — Theater fields: prayer room, postal code, WhatsApp, total halls

Issue: #29 (API Data Gaps Report, 2026-11-08), package P3. Docs folder:
`docs/gh-29-theater-fields/`. Migration range `0290_21` to `0290_29` (two used). Builds on U4b
(theaters: `theaters`, `theater_facilities`, `TheatersService`, the admin theater DTOs, the audit
of changed field names), U8a/U8b (discovery: `TheaterCard`, `PublicTheaterListItem`,
`PublicTheater`, the active-hall counts, the home-page draft) and the development seed. Design:
`docs/system-design.md` §5, §6.2, §9, §11, §14; PRD v2 A4, C4, C5.

## Goal

The frontend report asks the Theaters page and the theater page for four things the API did not
have:

- **Prayer room** (items 5 and 11): a facility the admin can tick and customers see, beside
  Kids room.
- **Postal code** (item 6): the cards and the theater page show it with the city, as in
  "Cairo 11211".
- **WhatsApp** (item 9): a dedicated number for the header button and the Contact section, with
  a ready `https://wa.me/<digits>` link, shown only when the theater shows its contacts.
- **Total halls** (item 4): "25 HALLS" at the top of the Theaters page, next to the theater
  total, whatever page is shown.

## Scope

- Migration `0290_21_add_theater_facilities_prayer_room`: `chk_theater_facilities_facility`
  dropped and re-added with `prayer_room`.
- Migration `0290_22_add_theaters_postal_code_whatsapp`: `theaters.postal_code VARCHAR(10) NULL`
  (`^[0-9]{5}$`) and `theaters.whatsapp VARCHAR(16) NULL` (E.164, the phones' CHECK).
- `FACILITIES` (`src/modules/theaters/enums.ts`) gains `prayer_room`, appended after `kids_room`,
  so the Swagger `Facility` enum, `PUT /admin/theaters/{id}/facilities` and every public
  `facilities` list take it.
- Admin (`AdminTheatersController`, `TheatersService`):
  - `POST /admin/theaters` and `PATCH /admin/theaters/{id}` accept `postalCode` and `whatsapp`
    (null clears).
  - `GET /admin/theaters/{id}` (and every route answering `Theater`) returns both, always.
  - The `theater.updated` audit event names `postalCode` and `whatsapp` in `changedFields` when
    they change (names only, never values).
- Public (`TheaterBrowseService`, `DiscoveryResponseMapper`):
  - The shared `TheaterCard` gains `postalCode`: `GET /theaters` (`PublicTheaterListItem`
    extends it) and `GET /home` (`cinemas`).
  - `GET /theaters` gains `totalHalls` at the root of `PublicTheaterPage`.
  - `GET /theaters/{id}` (`PublicTheater`) gains `postalCode`, `whatsapp` and `whatsappUrl`.
- Contract: `contracts/openapi.yaml` regenerated; `contracts/drafts/home-page.openapi.yaml`
  gains `prayer_room` in `Facility` and the optional `TheaterCard.postalCode`, additively, with a
  changelog note naming #29.
- Seed: `SeedTheater` gains optional `postalCode` and `whatsapp`. The `theaters` step sends them
  on create and back-fills each on an existing theater where it is still null. `SeedAdminTheater`
  reads both. Dataset values are P5's.

## Out of scope

- Dataset values (the real theaters' postal codes, WhatsApp numbers and prayer rooms): P5. The
  seed's facilities step only sets facilities on a theater that has none, so adding
  `prayer_room` to a staging theater that already lists facilities is P5's (or an admin's).
- The postal code or WhatsApp on the admin theater list (`TheaterListItem`), the search results
  and the booking's theater location: not asked for. Follow-up if the frontend asks.
- Folding the postal code into `address`: the report wants it shown with the city; the frontend
  composes "Cairo 11211".
- A filter by facility on `GET /theaters` (only `openNow` and `parking` exist).
- Other report items (facets, actors, gallery, screen size, showtimes, rating): other packages.

## Decisions

| Decision | Why |
|---|---|
| `prayer_room` appended to `FACILITIES` after `kids_room`; the CHECK dropped and re-added in a new migration | Earlier values keep their place (lists are returned in `FACILITIES` order, so existing UIs see no reorder); the design lists amenities after access and parking and food, Kids room last, and a prayer room is another on-site room. Migrations are append-only, so the CHECK is replaced, not edited |
| `postal_code VARCHAR(10) NULL`, `CHECK (postal_code ~ '^[0-9]{5}$')` | Egyptian postal codes are 5 digits. `VARCHAR(10)` leaves room should the format grow, the CHECK says what is stored today. A text, not an integer: a leading zero is meaningful |
| API: `postalCode` is a string of exactly 5 digits (`POSTAL_CODE_PATTERN`), trimmed; null clears; empty text, `"1121"`, `"112111"`, `"11 211"` and a number are `VALIDATION_FAILED` on `postalCode` | One rule, the same as the CHECK. Trimmed like every typed theater text |
| `postalCode` not folded into `address`; returned beside it | The report asks for it shown with the city; keeping it a field lets the UI place it |
| `whatsapp VARCHAR(16) NULL`, the phones' E.164 CHECK; the API uses `PHONE_NUMBER_PATTERN`; not trimmed (as phones) | A WhatsApp number is a phone number; one pattern for both |
| `whatsapp` and `whatsappUrl` are public only when `showContactsPublic` is true, otherwise both null | PRD C5: contacts appear only when the theater's "show contacts" setting is on, exactly like `phones` and `email` |
| `whatsappUrl` is `https://wa.me/` and the E.164 number without `+`, built by the API | WhatsApp's documented click-to-chat link takes the full number in international format without `+`. The frontend gets a ready link and never rebuilds it |
| `whatsapp` on the theater page only, not on cards | The report asks for it in the theater page header and Contact section; cards keep `mainPhone` |
| `totalHalls` = the sum of `hallCount` over every theater that passes the filters, before paging | The page already reads every active theater's card (`pageInMemory`); summing the same `hallCount`s makes the root number consistent with the cards by construction and costs no query |
| `TheaterCard.postalCode` optional in the schema (`required: false`), nullable, always sent by this API | `TheaterCard` is a `/home` schema: the draft takes it as an optional property, additively, as the #29 rules allow. `PublicTheater` is not in the draft, so its new fields are required and nullable |
| Admin `Theater` returns `postalCode` and `whatsapp` always, whatever `showContactsPublic` | The admin edits them |
| Seed: `postalCode` and `whatsapp` sent on create when the dataset has them; on a theater that already exists, each is back-filled by one `PATCH` only where the stored value is null | The seed only adds what is missing (design: idempotent steps). An admin's own value is never overwritten |

## Modules and files

- `src/migrations/0290_21_add_theater_facilities_prayer_room.ts`,
  `src/migrations/0290_22_add_theaters_postal_code_whatsapp.ts` (and their rows in
  `src/common/database/migration-list.ts`).
- `src/modules/theaters/`: `enums.ts`, `types.ts` (`TheaterRow`, `NewTheaterRow`,
  `TheaterRowUpdate`, `TheaterDetails`, `CreateTheaterInput`, `TheaterChanges`),
  `theaters.constants.ts` (`POSTAL_CODE_PATTERN`), `theaters.repository.ts`, `theater-rows.ts`,
  `theaters.service.ts`, `theater-response.mapper.ts`, `dto/create-theater.request.ts`,
  `dto/update-theater.request.ts`, `dto/theater.response.ts`.
- `src/modules/discovery/`: `types.ts` (`TheaterCardView`, `PublicTheaterView`,
  `TheaterCardPage`), `discovery.constants.ts` (`WHATSAPP_URL_BASE`), `whatsapp.ts`,
  `theater-browse.service.ts`, `theater-browse.controller.ts`, `discovery-response.mapper.ts`,
  `dto/theater-card.response.ts`, `dto/public-theater.response.ts`.
- `src/modules/seed/`: `types.ts`, `seed.steps.ts`.
- `contracts/openapi.yaml`, `contracts/drafts/home-page.openapi.yaml`.

## Migrations

`0290_21_add_theater_facilities_prayer_room` (widens a CHECK; the previous release never writes
`prayer_room`, so it runs beside it):

```sql
ALTER TABLE theater_facilities DROP CONSTRAINT chk_theater_facilities_facility;
ALTER TABLE theater_facilities ADD CONSTRAINT chk_theater_facilities_facility CHECK (facility IN (
  'wheelchair_access', 'free_parking', 'valet_parking', 'street_parking', 'cafe_bar',
  'food_court', 'kids_room', 'prayer_room'
));
```

Both statements run in the migration's transaction, so no write sees the table without a CHECK.
`down` deletes the `prayer_room` rows, then restores the earlier CHECK.

`0290_22_add_theaters_postal_code_whatsapp` (expand only; both nullable without a default, the
previous release names its columns and never writes these):

```sql
ALTER TABLE theaters
  ADD COLUMN postal_code VARCHAR(10) NULL,
  ADD COLUMN whatsapp VARCHAR(16) NULL,
  ADD CONSTRAINT chk_theaters_postal_code CHECK (postal_code ~ '^[0-9]{5}$'),
  ADD CONSTRAINT chk_theaters_whatsapp CHECK (whatsapp ~ '^[+][1-9][0-9]{6,14}$');
```

Column comments say what each holds. No index: nothing filters or sorts by them. `down` drops
both columns (their constraints go with them).

## Endpoints

### `PUT /admin/theaters/{id}/facilities` (admin)

`facilities` items may be `prayer_room`. An unknown facility is still `VALIDATION_FAILED`.

### `POST /admin/theaters`, `PATCH /admin/theaters/{id}` (admin)

Request, new optional fields:

| Field | Type | Rules |
|---|---|---|
| `postalCode` | string \| null | exactly 5 digits (`11211`), trimmed; null clears |
| `whatsapp` | string \| null | E.164 (`+201001234567`), the phones' pattern; null clears |

Errors: `VALIDATION_FAILED` on `postalCode` or `whatsapp`. A `PATCH` with only one of them is a
change (it no longer counts as "send at least one field"). Response: `Theater` (below). A
`PATCH` that changes either records `theater.updated` with `changedFields` naming it.

### `GET /admin/theaters/{id}` and every route answering `Theater` (admin)

`Theater` gains `postalCode` (string \| null, example `11211`) and `whatsapp` (string \| null,
example `+201001234567`), whatever `showContactsPublic`.

### `GET /theaters` (public)

- `PublicTheaterPage` gains `totalHalls` (integer ≥ 0, example 25): the active halls of every
  theater that matches `openNow` and `parking`, whatever the page; the sum of the cards'
  `hallCount` over all pages. "25 HALLS" next to `total`.
- Each `PublicTheaterListItem` (through `TheaterCard`) gains `postalCode` (string \| null).
- `facilities` may contain `prayer_room`.

### `GET /theaters/{id}` (public)

`PublicTheater` gains:

| Field | Type | Meaning |
|---|---|---|
| `postalCode` | string \| null | shown with the city ("Cairo 11211"); null hides it |
| `whatsapp` | string \| null | E.164; null when none is set or the theater hides its contacts |
| `whatsappUrl` | string (uri) \| null | `https://wa.me/201001234567` for the WhatsApp button; null exactly when `whatsapp` is |

### `GET /home` (public)

`cinemas[]` (`TheaterCard`) gains optional `postalCode` (string \| null), always sent;
`facilities` may contain `prayer_room`.

## Tests

Unit (`test/unit/`, collaborators mocked):

- `modules/theaters/dto/theater-requests.test.ts`: `prayer_room` accepted by
  `ReplaceFacilitiesRequest`, an unknown facility refused; `postalCode` `11211`, padded, and null
  accepted; `1121`, `112111`, `11 211`, `abcde`, empty and a number refused; `whatsapp` E.164 and
  null accepted, local `01001234567`, `+0…` and text refused; both on create and update; a
  `PATCH` with only `postalCode` passes.
- `modules/theaters/theaters.service.test.ts`: create stores both columns (null when left out);
  update writes `postal_code` and `whatsapp` and records `changedFields: ['postalCode',
  'whatsapp']`; the same values write nothing.
- `modules/discovery/whatsapp.test.ts`: `https://wa.me/` plus the digits.
- `modules/discovery/theater-browse.service.test.ts`: `totalHalls` is the sum of every matching
  card's `hallCount` whatever the page size, and follows `openNow` and `parking`; the theater page
  returns `postalCode` and `whatsapp`, and hides `whatsapp` when contacts are hidden; cards carry
  `postalCode`.
- `modules/seed/seed.steps.test.ts`: the `theaters` step sends both on create; back-fills only
  the null ones on an existing theater; sends nothing for a dataset theater without them.

Integration (`test/integration/`, real Postgres, real wiring):

- `migrations/0290_theater_fields.test.ts`: both migrations in the list; the columns, their
  CHECKs and comments; the facility CHECK takes `prayer_room` and still refuses `imax`.
- `modules/theaters/admin-theaters.controller.test.ts` ("#29 theater fields" block): `PUT
  facilities` with `prayer_room` is stored and returned in order, `imax` refused; create with
  `postalCode` and `whatsapp` answers them and `GET` returns them; `PATCH` changes and clears them
  and the audit row names the fields; bad values are `VALIDATION_FAILED` and nothing changes.
- `modules/discovery/theater-browse.controller.test.ts` ("#29 theater fields" block): `GET
  /theaters` returns `postalCode` on cards and `prayer_room` in facilities; `totalHalls` equals
  the sum of `hallCount` across several pages (`limit=1`), the same on every page, and follows
  `parking`; `GET /theaters/{id}` returns `postalCode`, `whatsapp` and the `wa.me` URL, and nulls
  both when contacts are hidden.
- `modules/discovery/dto/discovery-contract.test.ts` (unchanged): every `/home` schema, with the
  new optional `TheaterCard.postalCode` and `prayer_room`, equals the draft.
- `modules/discovery/home.controller.test.ts` (unchanged): `/home` validates against the draft.
- `modules/seed/seed.steps.test.ts` and `seed.command.test.ts`: both datasets still seed and
  re-seed.

## Acceptance

- Gates: typecheck, lint, the whole suite, build, and the contract regenerated with a clean
  `git status`.
- Tests prove: `prayer_room` is accepted by the admin route and the database and returned
  publicly, an unknown facility is still refused; postal code validation and its public return on
  cards and details; WhatsApp validation, its hiding when contacts are not public, and the wa.me
  URL; `totalHalls` equals the sum of `hallCount` over all matching theaters across several pages
  and follows the filters; `/home` still matches the (additively updated) draft.
- `docs/gh-29-theater-fields/qa.md` records curl evidence of every changed route.
