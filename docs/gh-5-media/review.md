---
title: U4a — Review of the media unit
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, media, images, storage, supabase-storage, sharp, uploads, idempotency]
---

# U4a — Review of the media unit

Issue #5 (media half), spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`c5c7c79..9a2a6de` on `unit/gh-5-media`, against design §6.2 (`images`), §9 (image pipeline
and image links), §14.1 (the upload carve-out), §14.5, PRD v2.0 "Media and uploads", the spec,
and the `CLAUDE.md` stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed, and every fix has a test that failed before it.
The integration suites ran on this tree's own database (`maqady_u4a_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | minor | **An image above about 268 megapixels was refused as `415 UNSUPPORTED_IMAGE_TYPE`, not `422 IMAGE_TOO_MANY_PIXELS`.** The pipeline reads the header with `sharp(buffer).metadata()`, which applies sharp's default `limitInputPixels` (268,402,689 pixels) and throws "Input image exceeds pixel limit". `readHeader` mapped that to unsupported, so a giant panorama or a decompression bomb was told "Upload a JPG or PNG" instead of the documented 40 MP refusal with its `width` and `height`. It was still refused, and nothing was decoded. | A probe script on crafted PNG headers: 7000 × 6000 read fine; 20000 × 20000 and 100000 × 100000 threw the pixel-limit error. Then a new unit test (`pngHeader(20000, 20000)` → `IMAGE_TOO_MANY_PIXELS` with its details, `toBuffer` never called), which failed with `UNSUPPORTED_IMAGE_TYPE`. | Fixed in `d24e051`. The header read passes `limitInputPixels: false`; it decodes nothing, and the 40 MP check right after it refuses the image. The decode for each variant keeps `limitInputPixels: 40_000_000`. |
| R2 | minor | **The Supabase adapter never read a successful answer, and read a listing outside its error mapping.** `put` and `remove` returned without reading the body, so each response kept its connection out of undici's pool until garbage collection (three puts per upload, one remove per delete). `list` called `response.json()` after the mapped `fetch`, so a body cut off by the 15 s timeout escaped as a raw `TimeoutError`, not `STORAGE_UNAVAILABLE`, and a non-JSON `200` as a `SyntaxError`, not `INTERNAL`. | Three new unit tests with `fetch` mocked: `bodyUsed` of the put and remove answers stayed `false`; a `200` whose stream errors with a `TimeoutError` rejected with the raw error; an HTML `200` to a list rejected with a `SyntaxError`. All three failed. | Fixed in `4ab33e6`. `request()` reads every successful body to the end inside the same timeout and mapping, and returns its text; `list` parses it and answers `INTERNAL` for anything but a JSON array. |

No blocker or major finding was found.

## Checked, with nothing to report

- **Upload flow and transactions.** `@ImageUpload()` carries `@NoRequestTransaction()`, and
  `MediaService.upload()` refuses to run inside an open transaction, so no connection is held
  during the image work. The short transaction claims the key first, inserts the row, awaits the
  owner's `link`, and completes the key before commit (ADR 0003). A deadlock retry re-runs it
  with the same files, and the rolled-back attempt's post-commit hooks are dropped with it. Every
  failure after the files are stored (row, link, key, a second deadlock) removes them; a storage
  failure part-way through removes the variants already stored. Files of a deleted or replaced
  image go only after commit. U1's open R5 (keys of `@NoRequestTransaction()` routes never
  stored) is closed for uploads by this design.
- **Idempotency races.** Two uploads with one key both process and store their files; the
  second claim waits on the first's uncommitted key row, then replays it and deletes its own
  files, or claims the key itself if the first rolled back. The request hash covers the method,
  route template, path parameters, hold code, the multipart text fields and the file's SHA-256,
  so one key with another file is `IDEMPOTENCY_KEY_REUSED`. The stored status is the one Nest
  set before the interceptors ran, and Nest does not override the status the interceptor sets
  for a replay (`createHandleResponseFn` passes no status to `reply`).
- **Access.** Guards and the write interceptor's strict-key check run before the route's
  interceptor, so Multer reads nothing for a `401`, `403` or key-less strict request
  (integration test). The acting staff id comes from `@CurrentPrincipal()`. `/media` is plain
  `express.static`, GET and HEAD only, with no index, dotfiles or redirects; anything else falls
  through to the API's `404`.
- **Pipeline.** Magic bytes are checked by hand; the client's type and name are ignored. EXIF
  rotation is applied before the crop: a probe with orientation 6 (stored 2000 × 3000, shown
  3000 × 2000) as a backdrop, and a 1 % off poster with orientation 6, gave the exact 16:9 and
  2:3 variants. Metadata (GPS included) and ICC are stripped (unit test). One job at a time,
  `concurrency(1)`, cache off.
- **Storage paths and secrets.** Every path is checked segment by segment before any request or
  file operation, so `..`, absolute paths and empty segments are refused. The service role key
  appears in no message, details, cause or log form (unit test); config messages name the
  variable, never the value.
- **Migration.** Plural table, `BIGSERIAL` key, named `chk_`/`uq_` constraints, `TIMESTAMPTZ`
  without defaults, the covering index for U4b's foreign key, index comments, RLS on. No
  `SELECT *` (columns named in the repository), no N+1 (`whereIn` reads, batched orphan
  lookups), no inline types outside `types.ts`, services throw only `AppError`.
- **Swagger.** `Image` and `ImageVariant` match the home-page draft structurally (integration
  test). Upload routes document the multipart body, the field DTO through `allOf`, and the
  `400`, `413`, `415`, `422` and `503` codes with examples; `@nestjs/swagger` merges an owner's
  own `@ApiErrorResponses` for the same status instead of replacing it. The committed contract
  is unchanged, since no route returns an image yet.
- **Time.** The orphan cut-off uses the `Clock` and `subtractFromInstant`; nothing expires on a
  timer.

## Considered and dropped

- **Supabase list entries without a timestamp count as ancient** (`new Date(0)`), so
  `media:orphans --delete` would treat them as old enough to remove. Supabase Storage always
  returns `updated_at` and `created_at` for files, and only folders (`id: null`, recursed into)
  lack them, so no real listing reaches the fallback.
- **`/media` requests skip the request log**: the static middleware is mounted before
  `nestjs-pino`'s. The local driver is for development and tests only.
- **No cap on queued uploads.** Each waiting upload holds its buffer (up to 10 MB). The spec
  decides this deliberately (admins only).

## Gates on the final commit

Recorded in the review result: `npm run typecheck`, `npm run lint`, `npm test` (unit and
integration counts), `npm run build`, `npm run contract` with a clean `git status`.
