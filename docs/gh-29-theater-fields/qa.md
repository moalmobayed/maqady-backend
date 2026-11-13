---
title: "#29 P3 — Theater fields: manual QA"
owner: Mohamed Tarek
status: Done
last_verified: 2026-11-13
tags: [qa, theaters, discovery, facilities, contacts, curl]
---

# #29 P3 — Theater fields: manual QA

QA mode `curl` (CLAUDE.md). Evidence for every changed route of
`docs/gh-29-theater-fields/spec.md`.

## Setup

- Worktree `unit/gh-29-theater-fields`, a fresh database `maqady_p3_dev` (local Postgres 16), the
  demo dataset seeded with `node dist/cli/seed.js` after `npm run build` (migrations ran first,
  `0290_21` and `0290_22` included; the demo dataset has no postal codes, WhatsApp numbers or
  prayer rooms, so every theater starts without them):

  ```text
  Created the seed admin seed-admin@maqady.local.
  Dataset: demo
  theaters: 6 created, 0 already there
  halls: 5 created, 0 already there
  publish-theaters: 5 created, 0 already there
  ...
  showtimes: 129 created, 0 already there
  Done. Sign in to the dashboard as seed-admin@maqady.local.
  ```

- The built app (`node dist/main.js`) on port 3132. `B=http://localhost:3132/api/v1`; `$T` is the
  seed admin's access token from `POST $B/admin/auth/sessions`. Writes that need it carry a fresh
  `Idempotency-Key`. Responses are trimmed to the fields under test. Theaters 1 (Zamalek) to 4
  show their contacts; 5 (Sheikh Zayed) hides them; 6 (Dokki) is a draft.

## Admin: prayer room

1. `PUT` the facilities with `prayer_room` sent first:

   ```bash
   curl -X PUT $B/admin/theaters/1/facilities -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
     -d '{"facilities":["prayer_room","wheelchair_access","valet_parking","cafe_bar","kids_room"]}'
   ```

   ```text
   HTTP 200
   {'id': 1, 'facilities': ['wheelchair_access', 'valet_parking', 'cafe_bar', 'kids_room', 'prayer_room']}
   ```

   Stored, and returned in the facility list order (prayer room after kids room).

2. An unknown facility is still refused, and the message lists `prayer_room`:
   `PUT .../facilities {"facilities":["prayer_room","imax"]}` →

   ```text
   HTTP 400
   VALIDATION_FAILED {'fields': [{'field': 'facilities', 'messages': ['each value in facilities must be one of the following values: wheelchair_access, free_parking, valet_parking, street_parking, cafe_bar, food_court, kids_room, prayer_room']}]}
   ```

## Admin: postal code and WhatsApp

3. `PATCH $B/admin/theaters/1 {"postalCode":" 11211 ","whatsapp":"+201001234567"}` (the postal
   code padded):

   ```text
   HTTP 200
   {'id': 1, 'postalCode': '11211', 'whatsapp': '+201001234567', 'showContactsPublic': True}
   ```

4. The theater that hides its contacts:
   `PATCH $B/admin/theaters/5 {"postalCode":"12588","whatsapp":"+201005550000"}` →

   ```text
   HTTP 200
   {'id': 5, 'postalCode': '12588', 'whatsapp': '+201005550000', 'showContactsPublic': False}
   ```

   The admin always sees both.

5. Create with both:

   ```bash
   curl -X POST $B/admin/theaters -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
     -H "Idempotency-Key: $(uuid)" -d '{"name":"QA Maqady Giza","address":"1 Pyramids Road","district":"Haram",
     "city":"Giza","latitude":29.99,"longitude":31.15,"postalCode":"12556","whatsapp":"+201112223334"}'
   ```

   ```text
   HTTP 201
   {'id': 7, 'status': 'draft', 'postalCode': '12556', 'whatsapp': '+201112223334'}
   ```

6. Refusals, each `PATCH $B/admin/theaters/1`:

   ```text
   {"postalCode":"1121"}       -> HTTP400 VALIDATION_FAILED [{'field': 'postalCode', 'messages': ['postalCode must be 5 digits, such as 11211']}]
   {"postalCode":"11 211"}     -> HTTP400 VALIDATION_FAILED [{'field': 'postalCode', 'messages': ['postalCode must be 5 digits, such as 11211']}]
   {"postalCode":11211}        -> HTTP400 VALIDATION_FAILED [{'field': 'postalCode', 'messages': ['postalCode must be 5 digits, such as 11211', 'postalCode must be a string']}]
   {"postalCode":""}           -> HTTP400 VALIDATION_FAILED [{'field': 'postalCode', 'messages': ['postalCode must be 5 digits, such as 11211']}]
   {"whatsapp":"01001234567"}  -> HTTP400 VALIDATION_FAILED [{'field': 'whatsapp', 'messages': ['whatsapp must be in E.164 format, such as +201001234567']}]
   {"whatsapp":"+0100123"}     -> HTTP400 VALIDATION_FAILED [{'field': 'whatsapp', 'messages': ['whatsapp must be in E.164 format, such as +201001234567']}]
   ```

7. Nothing changed: `GET $B/admin/theaters/1` →
   `{'postalCode': '11211', 'whatsapp': '+201001234567', 'facilities': [..., 'kids_room', 'prayer_room']}`.

8. The audit rows name the fields, never the values:

   ```text
   $ psql … -Atc "select action, changed_fields, metadata from maqady.audit_events
                 where entity_type='theater' and entity_id in (1,5)
                 and action in ('theater.updated','theater.facilities_replaced') order by id"
   theater.facilities_replaced|{}|{"count": 3}        (seed, Zamalek)
   theater.facilities_replaced|{}|{"count": 2}        (seed, Sheikh Zayed)
   theater.facilities_replaced|{}|{"count": 5}        (step 1)
   theater.updated|{postalCode,whatsapp}|{}           (step 3)
   theater.updated|{postalCode,whatsapp}|{}           (step 4)
   ```

9. The CHECKs refuse what the API refuses:

   ```text
   update maqady.theaters set postal_code='1121' where id=2
   ERROR:  new row for relation "theaters" violates check constraint "chk_theaters_postal_code"
   update maqady.theaters set whatsapp='0100123' where id=2
   ERROR:  new row for relation "theaters" violates check constraint "chk_theaters_whatsapp"
   insert into maqady.theater_facilities values (2,'imax')
   ERROR:  new row for relation "theater_facilities" violates check constraint "chk_theater_facilities_facility"
   ```

## Public: the Theaters page and totalHalls

10. A second active hall at Zamalek, so the counts differ: `POST $B/admin/theaters/1/halls
    {"name":"Hall 2"}` then `PATCH $B/admin/halls/6 {"status":"active"}` → `HTTP 200`.

11. `GET $B/theaters`:

    ```text
    HTTP/1.1 200 OK
    Cache-Control: public, max-age=60
    {'total': 5, 'totalHalls': 6, 'nextCursor': None}
    2 Maqady Downtown     | Cairo None  | hallCount 1 | ['street_parking', 'cafe_bar']
    3 Maqady Heliopolis   | Cairo None  | hallCount 1 | ['wheelchair_access', 'free_parking', 'food_court', 'kids_room']
    4 Maqady New Cairo    | Cairo None  | hallCount 1 | ['wheelchair_access', 'free_parking', 'valet_parking', 'cafe_bar', 'food_court']
    5 Maqady Sheikh Zayed | Giza 12588  | hallCount 1 | ['free_parking', 'food_court']
    1 Maqady Zamalek      | Cairo 11211 | hallCount 2 | ['wheelchair_access', 'valet_parking', 'cafe_bar', 'kids_room', 'prayer_room']
    ```

    `totalHalls` 6 = 1 + 1 + 1 + 1 + 2. The postal code is on the card even where contacts are
    hidden (5); the draft (6) and the new draft (7) are not listed.

12. Every page of `GET $B/theaters?limit=2` (following `nextCursor`):

    ```text
    [(2, 1), (3, 1)] total 5 totalHalls 6
    [(4, 1), (5, 1)] total 5 totalHalls 6
    [(1, 2)]         total 5 totalHalls 6
    ```

    The same `totalHalls` on every page, equal to the sum of `hallCount` across the pages.

13. `GET $B/theaters?parking=true&limit=1` → `[3] total 4 totalHalls 5` (Heliopolis, New Cairo,
    Sheikh Zayed and Zamalek: 1 + 1 + 1 + 2; Downtown's street parking does not count).

14. `GET $B/theaters?openNow=true` (17:20 Cairo time, all five open) →
    `[(2, 1), (3, 1), (4, 1), (5, 1), (1, 2)] total 5 totalHalls 6`. The closed-at-the-clock case
    is proven by the integration test with a fixed clock.

## Public: the theater page

15. `GET $B/theaters/1` (contacts shown):

    ```text
    {'id': 1, 'city': 'Cairo', 'postalCode': '11211', 'whatsapp': '+201001234567',
     'whatsappUrl': 'https://wa.me/201001234567', 'hallCount': 2,
     'facilities': ['wheelchair_access', 'valet_parking', 'cafe_bar', 'kids_room', 'prayer_room']} phones 2
    ```

16. `GET $B/theaters/5` (contacts hidden):

    ```text
    {'id': 5, 'city': 'Giza', 'postalCode': '12588', 'whatsapp': None, 'whatsappUrl': None, 'email': None, 'phones': []}
    $ curl -s $B/theaters/5 | grep -c 201005550000
    0
    ```

17. `GET $B/theaters/2` (none set) → `{'id': 2, 'postalCode': None, 'whatsapp': None, 'whatsappUrl': None}`.

18. `GET $B/theaters/7` (the draft created in step 5) → `HTTP 404`.

## Public: the home page

19. `GET $B/home`, `cinemas` (id, `postalCode`, `facilities`, whether a `whatsapp` key is there):

    ```text
    2 None  ['street_parking', 'cafe_bar'] False
    3 None  ['wheelchair_access', 'free_parking', 'food_court', 'kids_room'] False
    4 None  ['wheelchair_access', 'free_parking', 'valet_parking', 'cafe_bar', 'food_court'] False
    5 12588 ['free_parking', 'food_court'] False
    1 11211 ['wheelchair_access', 'valet_parking', 'cafe_bar', 'kids_room', 'prayer_room'] False
    ```

    That `/home` matches the additively updated draft is proven by
    `test/integration/modules/discovery/dto/discovery-contract.test.ts`, `home.controller.test.ts`
    and the `HomeResponse` validation in `theater-browse.controller.test.ts`.

## Log hygiene

20. The server log of the whole session (250 lines) holds none of the numbers or postal codes:

    ```text
    $ grep -c "201001234567\|201005550000\|201112223334\|11211\|12588" app.log
    0
    ```
