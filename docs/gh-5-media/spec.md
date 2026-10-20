---
title: U4a — Media - images, storage adapter and image pipeline
owner: Mohamed Tarek
status: Done
last_verified: 2026-10-20
tags: [media, images, storage, supabase-storage, sharp, multer, uploads, webp]
---

# U4a — Media: images, storage adapter and image pipeline

Issue: #5 (first half; U4b Theaters is the second). Docs folder: `docs/gh-5-media/`. Migration
prefix `0050`. Depends on U1 only (`docs/gh-2-foundations/spec.md`). Design:
`docs/system-design.md` §5, §6.1, §6.2 (`images`), §9 (image pipeline, image links), §10.7,
§11, §14 (14.1 upload carve-out, 14.3, 14.5), §15; PRD v2 "Media and uploads", "Free-tier
limits". Image shape in responses: `contracts/drafts/home-page.openapi.yaml` (`Image`,
`ImageVariant`).

## Goal

One place turns an admin's uploaded JPG or PNG into web-sized, metadata-free WebP files in
storage plus one `images` row, without ever holding a database connection during image work.
Theaters (U4b) and catalog (U6) put one decorator on their own upload routes and call one
service method; every API response that shows a picture builds it with the same helper, so the
`Image` shape of the home-page contract is produced in one place.

## Scope

- Migration `0050_01_create_images`.
- `src/modules/media/` (`MediaModule`): the `StorageAdapter` with `SupabaseStorageAdapter` and
  `LocalStorageAdapter`, `ImagePipeline` (magic bytes, pixel limit, shape rules, sharp),
  `ImagesRepository`, the exported `MediaService`, the `@ImageUpload()` route decorator with
  `ImageUploadInterceptor` and `@UploadedImage()`, `ImageResponse` / `ImageVariantResponse`,
  and `MediaOrphansService` behind `npm run media:orphans`.
- Storage configuration (`STORAGE_DRIVER`, the Supabase and local variables), validated at boot;
  read-only static serving of the local directory under `/media`.
- Error codes `UNSUPPORTED_IMAGE_TYPE`, `IMAGE_TOO_LARGE`, `IMAGE_TOO_MANY_PIXELS`,
  `IMAGE_WRONG_SHAPE`, `STORAGE_UNAVAILABLE`.
- Dependencies: `sharp` 0.35.5 (prebuilt libvips, works on `node:24-slim`), `multer` 2.4.0 (the
  version `@nestjs/platform-express` already ships, now a direct dependency because this unit
  imports it), `@types/multer` (dev).
- `.env.example`, README (variables, `media:orphans`, Supabase bucket setup), `.gitignore`
  (`.media/`), the `src/` row of `CLAUDE.md`'s source table, `docs/INDEX.md`, design §9 and
  §14.5.

## Out of scope

- Every upload, replace and delete **route**: theater cover and gallery (U4b), movie poster and
  photos, person photo (U6). This unit has no product route.
- Linking columns (`movies.poster_image_id`, `people.photo_image_id`,
  `theaters.cover_image_id`, `theater_photos.image_id`, `movie_photos.image_id`) and their FKs
  to `images` (their owners' migrations).
- The FK `fk_images_created_by_staff_id` → `staff_users`: added by U4b, the first unit that
  depends on both U2a and U4a (§6.1 "the later unit adds the FK"). The covering index
  `idx_images_created_by_staff_id` is created here.
- Video files (YouTube links only, U6), creating the Supabase bucket (a deploy step, README).

## Decisions

### Open questions of the draft, decided

| Question | Decision | Why |
|---|---|---|
| Movie backdrop "picked from the photos" vs the contract's "Backdrop image (16:9)" | Movie photos are `gallery` images and keep their own aspect ratio. The backdrop U6 returns is the picked photo's `Image`; the frontend shows it at 16:9 with `object-fit: cover`. U6 may refuse picking a photo narrower than landscape (it has `sourceWidth`/`sourceHeight`). | PRD §A2 says only "backdrop picked from the photos", and photos have no shape rule; refusing or cropping stills to 16:9 would also crop the media viewer's photos. The contract's "16:9" is the display ratio. A 16:9 rendition per photo would double storage on a 1 GB quota for one carousel. |
| Refuse a poster or person photo that is off its ratio, or always crop? | Posters (2:3) and person photos (1:1) are refused with `IMAGE_WRONG_SHAPE` when more than 2 % off; within 2 % they are centre-cropped to the exact ratio. `backdrop` images are always centre-cropped to 16:9. | The PRD states the poster and person shapes as upload rules for the admin; silently cropping could cut a face or a title. ±2 % absorbs off-by-a-few-pixels exports (a 27 × 40 in poster is 1.25 % off). A backdrop has no PRD shape rule, so it is fitted, not refused. |
| Minimum sizes the PRD does not set | Poster 400 × 600, backdrop 1280 × 720 (after the crop), gallery 320 on the shorter side, person 600 × 600 (PRD). | Below these the `medium` variant would already be upscaled by the browser on a phone (poster cards, full-width backdrops). |
| Theater cover: fixed 16:9 or any photo? | Recommend kind `backdrop` to U4b: any photo of at least 1280 × 720 after a centre crop to 16:9. | Theater cards and the theater page header show the cover at a fixed wide ratio; cropping on the server keeps every card the same shape without refusing phone photos (4:3, 3:2). |
| FK `images.created_by_staff_id` → `staff_users` | U4b adds it (U4a cannot: it depends on U1 only). The covering index is here. | §6.1. U4b must also switch this unit's integration suites to real staff (below). |
| Test staff tokens after U2a merges | The media suites get their staff token from one helper, `test/support/media.ts` `mediaAdmin()`, which uses U1's `TestPrincipalResolversModule`. After U2a merges, the integrator passes `overrides: REAL_RESOLVERS_OFF` in the two media suites (or switches `mediaAdmin()` to U2a's `staffSession()`); once U4b adds the FK, `mediaAdmin()` must return a real staff member. | One place to change. |

### Other decisions

| Decision | Why |
|---|---|
| Four kinds with fixed rules (table below); every kind yields exactly the variants `small`, `medium`, `large` | The home-page contract's `ImageVariant.name` enum is `small, medium, large` for posters, backdrops and covers alike. |
| Variant sizes are upper bounds: `fit: cover` on the already exact-ratio crop (fixed-ratio kinds) or `fit: inside` (gallery), with `withoutEnlargement`; a small source yields smaller variants, never upscaled ones | "Web sizes, never the original upload"; upscaling only wastes the 1 GB quota. |
| Checks in this order: Multer size → magic bytes → header pixel count (no decode) → shape on the EXIF-oriented size → decode | Each refusal costs as little as possible; a 40+ MP image is never decoded. |
| Magic bytes checked by hand: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`; the client's `Content-Type` and file name are ignored | Two signatures need no dependency. |
| A file that passes the magic bytes but sharp cannot read or decode (truncated, corrupt) → `415 UNSUPPORTED_IMAGE_TYPE` | Same answer for the admin: "not a usable JPG or PNG". sharp's default `failOn: 'warning'` refuses a truncated JPEG. |
| sharp: `sharp.concurrency(1)`, `sharp.cache(false)` when `ImagePipeline` is created; inputs opened with `limitInputPixels: 40_000_000`; `.rotate()` (EXIF), no `keepMetadata`/`withMetadata`, WebP `quality: 80`, `effort: 4` | §9 and §3 (little memory and CPU). sharp drops EXIF, XMP and ICC and converts to sRGB by default. |
| Each variant is decoded from the upload on its own (three decodes) instead of from one decoded raw image | A 40 MP raw image is 120 MB; three streaming decodes keep memory near the 10 MB upload on Render's small instance. |
| `ImagePipeline` runs one job at a time (an in-process FIFO promise chain); later uploads wait | §3 "Image processing runs one job at a time". Admins only, so no cap on waiters. |
| Storage layout `<kind>/<uuid>/<variant>.webp`; `storage_prefix` = `<kind>/<uuid>` (`crypto.randomUUID()`) | One prefix per image (§9 step 4); a replacement gets a new prefix, so public URLs are immutable and cacheable. |
| Uploaded with `Cache-Control: public, max-age=31536000, immutable`, `Content-Type: image/webp`, no overwrite | Bandwidth is the scarcest free-tier limit (PRD); paths never change content. |
| Upload routes record their idempotency key themselves: `MediaService.upload` claims it with U1's `IdempotencyService.claim()` first thing in its short transaction, after the image work and the storage upload, and completes it before commit; a replay deletes the files this attempt uploaded and answers the stored response | U1 leaves this to U4 (`@NoRequestTransaction()` routes only check the key). A claim inside the short transaction keeps "key stored with the write" (ADR 0003). No pre-check before the image work: a retried upload costs one more processing run, and stays correct. |
| The upload's request hash is U1's `hashRequest()` over method, route template, path params, the hold token, and body `{ fields: <multipart text fields>, fileSha256 }` | The same key with a different file must be `IDEMPOTENCY_KEY_REUSED`, which a hash of the text fields alone would miss. |
| The short transaction is retried once on `40P01`/`40001` (`isRetryableTransactionError`), reusing the uploaded files | Same rule as the write interceptor (§14.1, §7.1). |
| Any failure inside the short transaction (row insert, the owner's link, the key) → rollback, then delete this attempt's files, then rethrow the original error; a failed delete is logged (`err`, paths only) and left to `media:orphans` | §9 "If that insert fails, the uploaded files are deleted." |
| A storage failure part-way through the variant uploads deletes the variants already uploaded, then rethrows | Same rule, one step earlier. |
| `MediaService.upload` refuses to run inside an open transaction (`INTERNAL`) | Its files could not be deleted when an outer transaction rolled back later. Upload routes carry `@NoRequestTransaction()` through `@ImageUpload()`. |
| `MediaService.delete*` delete the rows in the caller's transaction and register `TransactionRepository.afterCommit()` to delete the files | §9, §14.1 step 4: a rollback keeps both row and files. |
| Storage failures: network error, timeout (15 s), `429` or `5xx` → `503 STORAGE_UNAVAILABLE`; any other non-2xx → `INTERNAL` with the status and operation as `cause` (a misconfigured key or bucket is our bug) | Design is silent; `SERVICE_UNAVAILABLE` already means "database". The service key and response bodies never reach the error or the log. |
| Delete of a path that no longer exists is a success | Deletes run after commit and from the orphan script; both must be repeatable. |
| `images` rows are hard-deleted, no `deleted_at` | An image is removed, not retracted; its files go with it (PRD "Replacing or deleting a photo removes the old files"). |
| `alt` is not stored on `images`; the owner passes it to `toImageResponse()` (movie title, person name, photo caption, theater name) | The owner already has the text; one source of truth per field. |
| Swagger schema names `Image` and `ImageVariant` via `@ApiSchema({ name })` on `ImageResponse` / `ImageVariantResponse`; they enter `contracts/openapi.yaml` when the first owner route returns them | Must match the home-page draft that U8 reproduces exactly; a test compares the generated schemas with the draft. Publishing a schema no route returns would only be noise. |
| `StorageAdapter` is an abstract class, used as its own injection token (the `Clock` pattern) | No symbol token and no `@Inject()`; tests replace it with `overrideProvider(StorageAdapter)`. |
| Local driver: files under `LOCAL_STORAGE_DIR` (created on the first write, not at boot), served by `express.static` at `/media` (outside `/api/v1`) with `index: false`, `dotfiles: 'ignore'`, `redirect: false`, the same `Cache-Control`, and `Cross-Origin-Resource-Policy: cross-origin`; anything it does not serve (missing file, `PUT`, `DELETE`, `..`) falls through to the API's `404 NOT_FOUND` | Helmet's default `same-origin` CORP would stop the SPA on another port loading the images. Static serving is GET/HEAD only, so read-only. Falling through keeps the one error shape. `npm run contract` creates no directory. |
| `STORAGE_DRIVER` is required, no default | A deploy that forgot it must not silently write to Render's ephemeral disk. |
| The upload interceptor and `@UploadedImage()` inject nothing (Multer and U1 helper functions only); the payload travels on a `WeakMap` keyed by the request | Owners use `@ImageUpload()` from their own modules; a dependency-free interceptor resolves in any module. No global `Request` augmentation. |
| `media:orphans` lists by default and deletes only with `--delete`; a prefix counts as orphaned only if no `images` row has it **and** its newest file is older than 60 minutes (by the `Clock`); paths outside `<kind>/<uuid>/…` are reported, never deleted | An upload in flight has files before its row; "it only tidies up". |

### Kind rules

| Kind | Used for (owner decides) | Aspect | Off-ratio input | Minimum (oriented, after any crop) | `small` / `medium` / `large` (max px) |
|---|---|---|---|---|---|
| `poster` | movie poster (U6) | 2:3 | within 2 %: centre-crop; else refused | 400 × 600 | 200×300 / 400×600 / 800×1200, cover |
| `backdrop` | theater cover (recommended to U4b) | 16:9 | always centre-cropped | 1280 × 720 | 640×360 / 1280×720 / 1920×1080, cover |
| `person` | person photo (U6) | 1:1 | within 2 %: centre-crop; else refused | 600 × 600 | 150×150 / 300×300 / 600×600, cover |
| `gallery` | movie photos (U6), theater gallery (U4b) | any | kept | 320 × 320 (the shorter side) | inside 480×480 / 1024×1024 / 1920×1920 |

## Configuration

Added to `EnvironmentVariables` and `AppConfig.storage` (`common/config`); messages name the
variable, never the value.

| Variable | Rule | Default |
|---|---|---|
| `STORAGE_DRIVER` | `supabase` or `local` | required |
| `SUPABASE_URL` | when `supabase`: an `https://` origin (no path, no trailing slash) | required for `supabase` |
| `SUPABASE_SERVICE_ROLE_KEY` | when `supabase`: at least 20 characters, no whitespace | required for `supabase` |
| `STORAGE_BUCKET` | `^[a-z0-9][a-z0-9._-]{1,62}$` | `media` |
| `LOCAL_STORAGE_DIR` | when `local`: a path, resolved against the working directory | `.media` |
| `LOCAL_STORAGE_PUBLIC_URL` | when `local`: `http(s)://` URL, no trailing slash | `http://localhost:<PORT>/media` |

`StorageConfig = { driver: 'supabase'; supabaseUrl; serviceRoleKey; bucket } | { driver:
'local'; directory; publicBaseUrl }` lives in `common/config/types.ts`; `STORAGE_DRIVERS` in
`common/config/enums.ts` (config must not import a feature module). `test/support/test-config.ts`
sets `STORAGE_DRIVER=local` and a per-run temporary `LOCAL_STORAGE_DIR`; `npm run contract`
uses `local`.

## Modules and files

**`src/modules/media/`** — `MediaModule` (not global; imports U1's `IdempotencyModule`).
Providers: `ImagesRepository`, `ImagePipeline`, `{ provide: StorageAdapter, useFactory:
createStorageAdapter, inject: [APP_CONFIG] }`, `MediaService`, `MediaOrphansService`. Exports:
`MediaService`. Owners import `MediaModule`; `ImageUpload`, `UploadedImage` and `ImageResponse`
are imported by path. `AppModule` imports `MediaModule` (so `npm run media:orphans` finds it).

| File | Holds |
|---|---|
| `enums.ts` | `IMAGE_KINDS = ['poster','backdrop','person','gallery']`, `IMAGE_VARIANT_NAMES = ['small','medium','large']`, `DETECTED_IMAGE_TYPES = ['jpeg','png']`, `SHAPE_POLICIES = ['refuse','crop','keep']` |
| `types.ts` | every type of the module (`ImageKind`, `StoredImage`, `ImageUploadPayload`, `UploadOutcome<T>`, `UploadImageInput<T>`, `KindRule`, `ProcessedImage`, `StorageObject`, `StorageListEntry`, `OrphanReport`, …) |
| `media.constants.ts` | `MAX_UPLOAD_BYTES = 10 * 1024 * 1024`, `MAX_INPUT_PIXELS = 40_000_000`, `ASPECT_TOLERANCE = 0.02`, `KIND_RULES` (table above), `WEBP_OPTIONS`, `UPLOAD_FILE_FIELD = 'file'`, `MULTER_LIMITS = { fileSize, files: 1, fields: 20, fieldSize: 2048, parts: 21 }`, `STORAGE_CACHE_CONTROL`, `STORAGE_TIMEOUT_MS = 15_000`, `STORAGE_DELETE_BATCH = 1000`, `STORAGE_LIST_PAGE = 1000`, `LOCAL_MEDIA_ROUTE = '/media'`, `ORPHAN_MIN_AGE_MINUTES = 60`, `ORPHAN_LOOKUP_BATCH = 500`, `STORAGE_PREFIX_PATTERN` |
| `image-type.ts` | `detectImageType(buffer): DetectedImageType \| null` |
| `image-shape.ts` | `planCrop(kind, width, height)`: the crop rectangle or `IMAGE_WRONG_SHAPE` |
| `image-pipeline.ts` | `ImagePipeline.process(buffer, kind)`; sharp's global settings |
| `storage/storage.adapter.ts` | the abstract `StorageAdapter` (`put`, `remove`, `list`, `publicUrl`) |
| `storage/storage-path.ts` | `assertStoragePath(path)`, `encodeStoragePath(path)` |
| `storage/storage.factory.ts` | `createStorageAdapter(config)` |
| `storage/supabase-storage.adapter.ts` | `SupabaseStorageAdapter` (global `fetch`) |
| `storage/local-storage.adapter.ts` | `LocalStorageAdapter` (`node:fs/promises`) |
| `storage/local-media.static.ts` | `serveLocalMedia(app, storage)`, called by `configureApp()`; does nothing for `supabase` |
| `images.repository.ts` | `insert`, `findByIds`, `deleteByIds` (returns the deleted rows), `existingPrefixes(prefixes)` |
| `media.service.ts` | `MediaService` |
| `media-orphans.service.ts` | `MediaOrphansService` (`scan`, `remove`) |
| `media-orphans.command.ts` | `parseOrphanArgs(argv)`, `runMediaOrphans(app, argv, write)` |
| `image-upload.context.ts` | the request → payload `WeakMap`, `uploadOutcome()` and `isUploadOutcome()` |
| `image-upload.interceptor.ts` | `ImageUploadInterceptor` |
| `image-upload.decorators.ts` | `ImageUpload(options?)`, `UploadedImage()` |
| `dto/image.response.ts` | `ImageResponse` (`@ApiSchema({ name: 'Image' })`), `ImageVariantResponse` (`@ApiSchema({ name: 'ImageVariant' })`) |
| `media.module.ts` | the module |

Also: `src/cli/media-orphans.ts` (thin `main()` like `migrate.ts`); `package.json` script
`"media:orphans": "nest build && node --enable-source-maps dist/cli/media-orphans.js"`;
`configureApp()` calls `serveLocalMedia()`.

## Migration (prefix `0050`)

**`0050_01_create_images`**

```sql
CREATE TABLE images (
  id BIGSERIAL PRIMARY KEY,
  kind VARCHAR(16) NOT NULL,
  storage_prefix VARCHAR(64) NOT NULL,
  variants JSONB NOT NULL,
  source_width INT NOT NULL,
  source_height INT NOT NULL,
  created_by_staff_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_images_kind CHECK (kind IN ('poster', 'backdrop', 'person', 'gallery')),
  CONSTRAINT chk_images_storage_prefix
    CHECK (storage_prefix ~ '^(poster|backdrop|person|gallery)/[0-9a-f-]{36}$'),
  CONSTRAINT chk_images_prefix_kind CHECK (split_part(storage_prefix, '/', 1) = kind),
  CONSTRAINT chk_images_variants
    CHECK (jsonb_typeof(variants) = 'object'
           AND jsonb_exists_all(variants, ARRAY['small', 'medium', 'large'])),
  CONSTRAINT chk_images_source_size CHECK (source_width > 0 AND source_height > 0),
  CONSTRAINT uq_images_storage_prefix UNIQUE (storage_prefix)  -- media:orphans: prefix → row
);
-- Covers the FK to staff_users that U4b adds; serves "images uploaded by a staff member".
CREATE INDEX idx_images_created_by_staff_id ON images (created_by_staff_id);
ALTER TABLE images ENABLE ROW LEVEL SECURITY;
```

`variants` = `{ "<name>": { "path": "poster/<uuid>/small.webp", "width": 200, "height": 300,
"bytes": 10342 }, … }` for exactly the three names; `source_*` are the oriented upload's size
(before any crop). No defaults; `created_at` from the `Clock`. `kind` mirrors `IMAGE_KINDS`.

## Endpoints

None. Owners' upload routes look like this (U4b and U6 own the real ones and their DTOs):

```ts
@Post(':id/photos')
@Admin() @Strict() @ImageUpload({ fields: MoviePhotoFieldsRequest })
@ApiCreatedResponse({ type: MoviePhotoResponse })
upload(@Param('id', ParseIntPipe) id: number, @Body() fields: MoviePhotoFieldsRequest,
       @UploadedImage() upload: ImageUploadPayload, @CurrentPrincipal() actor: StaffPrincipal) {
  return this.media.upload({ kind: 'gallery', upload, actor, link: (image) => … });
}
```

`@ImageUpload(options?: { fields?: Type<unknown> })` = `@NoRequestTransaction()` +
`UseInterceptors(ImageUploadInterceptor)` + `ApiConsumes('multipart/form-data')` + `ApiBody`
(`file`: binary, required, plus the `fields` DTO's properties through `allOf`) +
`ApiErrorResponses('VALIDATION_FAILED', 'IMAGE_TOO_LARGE', 'UNSUPPORTED_IMAGE_TYPE',
'IMAGE_TOO_MANY_PIXELS', 'IMAGE_WRONG_SHAPE', 'STORAGE_UNAVAILABLE')`. Access and strictness
stay the owner's decorators (§11: `POST …/photos` Admin + S; `PUT /admin/people/{id}/photo`
Admin, key accepted).

`ImageUploadInterceptor`:

1. Runs Multer (`memoryStorage()`, `MULTER_LIMITS`, single field `file`). Guards and the
   write interceptor's key check have already run, so nothing is read for an unauthorised or
   key-less strict request.
2. Maps errors: `LIMIT_FILE_SIZE` → `413 IMAGE_TOO_LARGE` (`details.maxBytes`); other limits,
   an unexpected file field, malformed multipart, or no file (also a non-multipart body) →
   `400 VALIDATION_FAILED` with `details.fields[0].field = "file"`.
3. Stores `ImageUploadPayload { buffer, byteSize, fileSha256, idempotency?, successStatus }`
   for the request: `idempotency` = `{ scope: scopeOf(principal), key, requestHash }` when a key
   was sent (`idempotencyKeyOf(request, false)`); `successStatus` = `response.statusCode` (the
   route's `@HttpCode` or Nest's default, already set by Nest before interceptors run).
4. After the handler, unwraps an `UploadOutcome<T>`: sets the status, and
   `Idempotent-Replayed: true` on a replay; returns the body. Any other return value passes
   through unchanged.

`@UploadedImage()` returns that payload (`INTERNAL` if the route lacks `@ImageUpload()`).

**Response DTOs** (exported for every owner):

- `ImageResponse`: `alt` (string, nullable), `variants` (`ImageVariantResponse[]`, smallest
  first, always 3, `minItems: 1` as in the draft).
- `ImageVariantResponse`: `name` (`small | medium | large`), `url` (absolute public URL,
  `format: uri`), `width`, `height` (integers).

## Error codes added

| Code | HTTP | Details |
|---|---|---|
| `IMAGE_TOO_LARGE` | 413 | `{ maxBytes: 10485760 }` |
| `UNSUPPORTED_IMAGE_TYPE` | 415 | `{ allowed: ['jpeg', 'png'] }` |
| `IMAGE_TOO_MANY_PIXELS` | 422 | `{ maxPixels: 40000000, width, height }` |
| `IMAGE_WRONG_SHAPE` | 422 | `{ kind, aspect: '2:3' \| '16:9' \| '1:1' \| null, minWidth, minHeight, width, height }` |
| `STORAGE_UNAVAILABLE` | 503 | none |

Each gets a catalogue `message` and `description` naming the rules per kind.

## Services

**Exported by `MediaModule`** (for U4b, U6, U8):

```ts
class MediaService {
  // Pipeline (no transaction) → upload variants → one short transaction: claim key (if any),
  // insert images row, await link(image), store the response under the key → commit.
  // Failure: rollback, delete this attempt's files, rethrow. Replay: delete them, return stored.
  upload<T>(input: {
    kind: ImageKind;
    upload: ImageUploadPayload;           // from @UploadedImage()
    actor: StaffPrincipal;                // created_by_staff_id
    link(image: StoredImage): Promise<T>; // inside the transaction: owner's row, old image's
                                          // delete(); returns the response DTO
  }): Promise<UploadOutcome<T>>;          // { status: number; body: T; replayed: boolean }

  findByIds(ids: readonly number[]): Promise<ReadonlyMap<number, StoredImage>>; // one whereIn
  delete(id: number): Promise<void>;                     // row now, files after commit
  deleteMany(ids: readonly number[]): Promise<void>;     // one DELETE … WHERE id IN, same rule
  toImageResponse(image: StoredImage | undefined, alt: string | null): ImageResponse | null;
}
// StoredImage = { id; kind: ImageKind; storagePrefix: string;
//   variants: Readonly<Record<ImageVariantName, StoredVariant>>;  // { path; width; height; bytes }
//   sourceWidth; sourceHeight; createdByStaffId: number; createdAt: Date }
```

Owners read their image ids with their own rows, then call `findByIds` once per response (no
N+1). Deleting an `images` row still referenced by an owner's FK fails (`ON DELETE RESTRICT`,
the owner's choice) and rolls the request back.

**Module-internal:** `ImagePipeline.process(buffer, kind): Promise<ProcessedImage>`;
`StorageAdapter`:

```ts
abstract class StorageAdapter {
  put(object: { path: string; body: Buffer; contentType: 'image/webp' }): Promise<void>;
  remove(paths: readonly string[]): Promise<void>;          // missing paths are fine
  list(prefix: string): Promise<readonly StorageListEntry[]>; // { path; updatedAt: Date }, recursive
  publicUrl(path: string): string;
}
```

`SupabaseStorageAdapter` (headers `Authorization: Bearer <key>` and `apikey: <key>` on every
call):

| Call | Request |
|---|---|
| `put` | `POST {SUPABASE_URL}/storage/v1/object/{bucket}/{path}`, `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`, `x-upsert: false`, body = bytes |
| `remove` | `DELETE {SUPABASE_URL}/storage/v1/object/{bucket}`, JSON `{ "prefixes": [paths] }`, batches of 1000 |
| `list` | `POST {SUPABASE_URL}/storage/v1/object/list/{bucket}`, JSON `{ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }`, paged; entries with `id: null` are folders and are listed recursively |
| `publicUrl` | `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}` (no request) |

Every call has `AbortSignal.timeout(STORAGE_TIMEOUT_MS)`; path segments are checked against
`^[a-z0-9][a-z0-9._-]*$` (else `INTERNAL`) and URI-encoded. `LocalStorageAdapter` writes with
`flag: 'wx'` after `mkdir -p`, removes with `force` and then the emptied prefix folder, lists by
a recursive walk (`mtime`), and refuses any path that resolves outside its directory.

**Consumed from U1** (exact names): `TransactionRepository.run()`, `.afterCommit()`,
`TransactionContext.executor()`, `.isActive()`, `isRetryableTransactionError()`,
`IdempotencyService.claim()` and `.complete()`, `IdempotencyModule`, `idempotencyKeyOf()`,
`scopeOf()` (from `write.interceptor.ts`), `hashRequest()`, `hashedPartsOf()`,
`IDEMPOTENT_REPLAYED_HEADER`, `NoRequestTransaction()`, `StaffPrincipal`, `Clock`,
`subtractFromInstant()`, `AppError`, `ApiErrorResponses()`, `APP_CONFIG`, `AppConfig`,
`EnvironmentVariables`, `loadDotenv()`, `loadConfig()`, `serializeError()`. Nothing from any
feature unit.

## `npm run media:orphans`

Boots an application context like `npm run migrate`, lists every object in the bucket (or the
local directory), groups by prefix, looks the prefixes up 500 at a time (`existingPrefixes`,
`whereIn`), prints one line per orphaned prefix (`<prefix> <files> <bytes?> <newest file ISO>`),
the unknown paths, and a summary. With `--delete` it removes the orphaned prefixes' files and
prints the count. Exit 0 on success, 1 with a JSON `fatal` line (no keys, no values) on failure.

## Tests

**Unit** (`test/unit/modules/media/`; fixtures generated in the test with real sharp, never
committed binaries):

- `image-type.test.ts`: JPEG and PNG detected; a text file renamed `.jpg`, a GIF, a WebP, an
  empty and a 2-byte buffer → `null`.
- `image-shape.test.ts`: the tolerance (exactly 2 % accepted), the crop rectangle per kind, the
  minimums.
- `image-pipeline.test.ts` (real sharp): a renamed non-image → `UNSUPPORTED_IMAGE_TYPE`; a
  7000 × 6000 PNG (42 MP, still under 10 MB) → `IMAGE_TOO_MANY_PIXELS` without decoding; a
  truncated JPEG → `UNSUPPORTED_IMAGE_TYPE`; per kind the exact variant sizes; outputs are WebP
  with no `exif`, `xmp` or `icc`; a JPEG with EXIF orientation 6 and GPS tags comes out rotated
  and without them; 2:3 off by 1 % accepted and cropped to exact 2:3, off by 5 % →
  `IMAGE_WRONG_SHAPE`; person 599 × 599 → `IMAGE_WRONG_SHAPE`; a 4:3 backdrop is cropped to
  16:9; two concurrent `process()` calls run one after the other.
- `supabase-storage.adapter.test.ts` (`global.fetch` mocked): exact URLs for put, remove, list
  and public URL; `Authorization`, `apikey`, `Content-Type`, `Cache-Control`, `x-upsert`
  headers; remove batches 2,500 paths into 3 calls; list pages and recurses into folders;
  network error, abort/timeout, `429`, `500`, `503` → `STORAGE_UNAVAILABLE`; `400`, `401`,
  `403`, `404` → `INTERNAL`; the service key appears in no error message, details or cause.
- `local-storage.adapter.test.ts` (temp dir): put/list/remove round trip; no overwrite;
  `../` and absolute paths refused; removing a missing path succeeds.
- `media.service.test.ts` (repository, adapter, pipeline and idempotency mocked; the real
  `TransactionRepository` on a fake Knex): the images insert throws → `adapter.remove` called
  with every uploaded path, original error rethrown; `remove` also throws → original error
  still rethrown, failure logged; a `40P01` retries once without re-uploading; a replay deletes
  this attempt's files; a failed variant upload removes the ones already stored; `delete`
  removes files only after commit; `toImageResponse` order, URLs and `null`.
- `image-upload.interceptor.test.ts`: Multer error mapping table; payload hash differs when
  only the file differs; outcome unwrapping.
- `load-config.test.ts` (extended): each storage variable's rule; Supabase variables required
  only for `supabase`; messages never contain values.
- `media-orphans.service.test.ts` and `media-orphans.command.test.ts`: grouping by prefix, the
  60-minute rule, lookups 500 at a time, unknown paths; argument parsing; output lines.
- `storage/storage.factory.test.ts`: the driver picks the adapter.

**Integration** (`test/integration/modules/media/`, real app, real Postgres,
`STORAGE_DRIVER=local` in a temp dir; `test/support/media-probe.module.ts` adds `@Admin()`
probe routes with `@ImageUpload()`, a probe owner table `zz_media_owners (image_id BIGINT
REFERENCES images)`, and `test/support/media.ts` for the staff token):

- Upload a poster: `201`, one `images` row with `created_by_staff_id` = the token's staff id,
  three `.webp` files under the row's prefix, `toImageResponse` URLs that `GET /media/...`
  serves with `image/webp`, `Cache-Control` and `Cross-Origin-Resource-Policy: cross-origin`.
- A renamed text file → `415 UNSUPPORTED_IMAGE_TYPE`; an 11 MB file → `413 IMAGE_TOO_LARGE`;
  a 42 MP PNG → `422 IMAGE_TOO_MANY_PIXELS`; a wrong-shape poster → `422 IMAGE_WRONG_SHAPE`;
  two files, or no file → `400 VALIDATION_FAILED` on `file`; in each case no row and no file.
- Strict probe without a key → `400 IDEMPOTENCY_KEY_REQUIRED` before any file is written; same
  key and file twice → second answers the same status and body with `Idempotent-Replayed: true`,
  one row, one prefix on disk; same key, another file → `422 IDEMPOTENCY_KEY_REUSED`, its files
  deleted.
- The link fails (probe inserts into `zz_media_owners` with a missing image id, and a probe that
  throws an `AppError`) → error answered, no `images` row, the attempt's prefix gone from disk.
- Delete probe that, inside its request transaction, calls `media.delete()` and reports that
  the files still exist → `200 { filesPresentBeforeCommit: true }`, then the files are gone;
  a delete probe that throws after `media.delete()` → row and files both still there.
- Replace probe (`link` deletes the previous image) → old prefix gone after commit, new present.
- `PUT`/`DELETE` to `/media/...` are not served (`404 NOT_FOUND`); `GET /media/../` cannot escape.
- `media:orphans` (`runMediaOrphans` against the test app): an orphaned prefix older than 60
  minutes (Clock moved) is listed, kept without `--delete` and removed with it; a fresh orphan
  and a prefix with a row are kept; an unknown path is reported and kept.
- The generated `Image` and `ImageVariant` schemas (from a probe route returning
  `ImageResponse`) match the home-page draft's (`dto/image.response.test.ts`), and an
  `@ImageUpload()` route is documented as multipart with its fields and error codes.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass, including every acceptance case in issue #5's media half: magic bytes
  refuse a renamed non-image; too large and over-40-megapixel refused; real sharp produces the
  expected sizes as WebP with metadata stripped; a failed row insert deletes the uploaded
  files; delete removes files only after commit; the Supabase adapter's URLs, headers and error
  mapping are unit-tested with `fetch` mocked; integration tests use the local adapter.
- `.env.example`, README, `.gitignore`, `CLAUDE.md` source table and `docs/INDEX.md` updated;
  design §9 and §14.5 record the decisions above.

## Follow-ups for other units

- **U4b**: add `fk_images_created_by_staff_id` (`images.created_by_staff_id` → `staff_users.id`,
  `ON DELETE RESTRICT`); make `test/support/media.ts` `mediaAdmin()` return a real staff member
  (`staffSession(testApp, 'admin')`) in the same change. Use kind `backdrop` for the cover,
  `gallery` for the gallery.
- **U6**: posters kind `poster`, person photos `person`, movie photos `gallery`; the backdrop is
  a picked photo (frontend cover-crops to 16:9).
- **Integrator (after U2a)**: the two media integration suites register U1's test resolvers;
  pass `overrides: REAL_RESOLVERS_OFF` to `createTestApp()` there, as for the U1 suites.
