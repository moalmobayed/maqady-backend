---
title: "#29 P3 — Review of the theater fields"
owner: Mohamed Tarek
status: Passed — 2026-11-13, no open blocker or major findings
last_verified: 2026-11-13
tags: [review, theaters, discovery, facilities, contacts, seed, contract, frontend-gaps]
---

# #29 P3 — Review of the theater fields

Issue #29 (API Data Gaps Report, items 4, 5, 6, 9 and 11), spec [`spec.md`](spec.md), QA
[`qa.md`](qa.md). Reviewed range: `631a017..ddf4ee4` on `unit/gh-29-theater-fields`, against the
report items, the spec, `docs/system-design.md` (§6.2, §9, §11, D-35) and the `CLAUDE.md` stack
rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed, and its fix has a test that failed before it.

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| F1 | minor | **The admin `TheaterResponse.whatsapp` had no `pattern` in Swagger.** Every other schema that carries `whatsapp` (`CreateTheaterRequest`, `UpdateTheaterRequest`, `PublicTheater`) publishes the E.164 pattern `^\+[1-9][0-9]{6,14}$`, and `TheaterResponse.postalCode` publishes its pattern, but `TheaterResponse.whatsapp` published none. A client generated from `contracts/openapi.yaml` saw an unconstrained string for the value the database CHECK holds to E.164. | A new case in `test/integration/modules/theaters/dto/theater-contract.test.ts` that collects every schema with `whatsapp` or `postalCode` from the built OpenAPI document and expects the shared pattern on each. It failed with `Expected: "^\\+[1-9][0-9]{6,14}$" Received: undefined`. | Fixed in `d811f21`. `TheaterResponse.whatsapp` takes `pattern: PHONE_NUMBER_PATTERN.source`, and `contracts/openapi.yaml` is regenerated. |
| F2 | info | **`PublicTheaterListItem.postalCode` is optional in its schema although `GET /theaters` always sends it.** It inherits the property from `TheaterCard`, which must keep it optional to stay additive in the home-page draft. An optional property that is always present is valid against the schema, so no response differs from it. | Reading `contracts/openapi.yaml`: `postalCode` is not in `PublicTheaterListItem.required`. The builder recorded it as a deviation. | **Open, by design.** Making it required on the list item alone would need its own property override; nothing in the report asks for it. |

## Checked, with nothing to report

- **Report items.** Item 4: `GET /theaters` returns `totalHalls` at the root, the sum of
  `hallCount` over every card that passes `openNow` and `parking`, computed before
  `pageInMemory`, so it does not depend on `limit` or `cursor`. Only `active` theaters become
  cards and `hallCount` counts only `active` halls, so drafts, paused theaters and draft or
  retired halls are left out. The integration test walks every `limit=1` page and checks the
  sum, the same value on every page, and both filters at a fixed clock. Items 5 and 11:
  `prayer_room` is in `FACILITIES`, the Swagger `Facility` enum and the DB CHECK. Item 6:
  `postalCode` is on every card (`/theaters`, `/home`) and on the theater page. Item 9:
  `whatsapp` and `whatsappUrl` are on the theater page.
- **Contacts.** `whatsapp` (and so `whatsappUrl`) is null unless `showContactsPublic` is true,
  in the same place phones and email are hidden (`TheaterBrowseService.find`). Cards never carry
  it. No other public route reads the theater row's contacts. The integration test checks the
  raw body of a hidden theater does not contain the number.
- **Migrations.** `0290_21` only widens the facility CHECK, so every existing row passes; both
  statements run in one transaction. `0290_22` adds two nullable columns without defaults, so
  existing rows pass both CHECKs. Both are in `migration-list.ts`, in order. Their `down` then
  `up` were run in a rolled-back transaction against `maqady_p3_test` (a throwaway test, not
  committed) and both round-trip.
- **Validation.** `postalCode` and `whatsapp` are ASCII-only regexes that fix the length, so
  nothing the validator accepts can overflow `VARCHAR(10)` / `VARCHAR(16)` or fail a CHECK; JS
  `$` and the Postgres `~` `$` both anchor at the end of the input. Null clears; `Trim` passes
  null through.
- **Queries.** No new query and no N+1: the two columns join `THEATER_COLUMNS`, which every
  theater read uses, and `totalHalls` reuses the hall counts already read for the cards.
- **Audit and logs.** `theater.updated` names `postalCode` and `whatsapp`, never their values.
- **Contract and `/home`.** `contracts/openapi.yaml` is regenerated and clean. The home-page
  draft only gains the optional, nullable `TheaterCard.postalCode` and `prayer_room` appended to
  `Facility`, with a changelog note; nothing is removed or renamed. The draft contract tests and
  the `/home` draft validation pass.
- **Seed.** `postalCode` and `whatsapp` are optional on `SeedTheater`; nulls are stripped
  (`withoutNulls`) before the create, so a dataset without them sends exactly what it did
  before. The back-fill `PATCH` runs only where the stored value is null and the dataset has
  one; every write carries a fresh `Idempotency-Key`. No photos were added, so there are no
  licence questions.
