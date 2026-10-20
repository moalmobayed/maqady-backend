---
title: U4a — Manual QA of media
owner: Mohamed Tarek
status: Passed — 2026-10-20
last_verified: 2026-10-20
tags: [qa, media, images, storage, uploads, sharp]
---

# U4a — Manual QA of media

Issue #5, spec [`spec.md`](spec.md). QA mode: `curl`. Environment: Node 22.22, local PostgreSQL
16, this unit's own database `maqady_u4a_dev` (migrated at boot), port 3105, fresh secrets from
`openssl rand -base64 32`, `STORAGE_DRIVER=local` with `LOCAL_STORAGE_DIR=.media`. Fixtures were
generated with sharp (`poster.jpg` 1000 × 1500, `square.jpg` 1200 × 1200, `huge.png`
7000 × 6000 at 134 KB, `face.png` 600 × 600, `gps.jpg` stored 1600 × 1000 with EXIF orientation 6,
GPS, an artist tag and a P3 ICC profile, `notes.jpg` a text file, `big.jpg` 11 MB starting with
the JPEG signature). Responses are trimmed to the status line, the relevant headers and the body.

U4a adds no product route, so QA has two parts:

1. **The real app** (`npm run build`, `node --enable-source-maps dist/main.js`): the migration,
   `/media` with nothing stored, refusal of bad storage configuration, `npm run media:orphans`.
2. **A QA-only harness** on the same port: the real `AppModule` compiled with `tsc` into the
   scratch directory together with the test-only upload routes of
   `test/support/media-probe.module.ts` (built like U4b's and U6's: `@Admin()`, `@Strict()` on a
   `POST`, `@ImageUpload()`) and U1's test principal resolvers (admin 7 on session 70, box office
   88 on session 8800), with tokens signed by the app's own `AccessTokenService`. It is not part
   of the repository. The probe table was dropped from `maqady_u4a_dev` afterwards.

## 1. The real app

### Boot, migration and the `images` table

```
$ grep -o '"msg":"\(Applied migration\|Listening\)[^"]*"' app.log
"msg":"Applied migration 0010_01_create_schema"
"msg":"Applied migration 0020_01_create_idempotency_keys"
"msg":"Applied migration 0020_02_create_audit_events"
"msg":"Applied migration 0050_01_create_images"
"msg":"Listening on port 3105"

$ psql: relrowsecurity, constraints, index comments of maqady.images
images|t
chk_images_kind|CHECK (kind IN ('poster', 'backdrop', 'person', 'gallery'))
chk_images_prefix_kind|CHECK (split_part(storage_prefix, '/', 1) = kind)
chk_images_source_size|CHECK ((source_width > 0) AND (source_height > 0))
chk_images_storage_prefix|CHECK (storage_prefix ~ '^(poster|backdrop|person|gallery)/[0-9a-f-]{36}$')
chk_images_variants|CHECK ((jsonb_typeof(variants) = 'object') AND jsonb_exists_all(variants, ARRAY['small', 'medium', 'large']))
images_pkey|PRIMARY KEY (id)
uq_images_storage_prefix|UNIQUE (storage_prefix)
idx_images_created_by_staff_id|Images uploaded by a staff member: WHERE created_by_staff_id = $1. Covers fk_images_created_by_staff_id (U4b).
uq_images_storage_prefix|npm run media:orphans: WHERE storage_prefix IN (...) finds the prefixes in storage that still have a row. Also keeps one row per prefix.
```

(Casts trimmed from `pg_get_constraintdef`. Knex turns the `?` of an index comment into `$1`,
as it does for U1's comments; the comment still names its query.)

### `/media` with nothing stored

```
$ curl -si localhost:3105/media/poster/missing/small.webp
HTTP/1.1 404 Not Found
X-Request-Id: 3bd5b92e-3b9a-4f5a-bd38-977b40a029c2
{"error":{"code":"NOT_FOUND","message":"No route matches GET /media/poster/missing/small.webp.","details":null,"correlationId":"3bd5b92e-3b9a-4f5a-bd38-977b40a029c2"}}
```

### Bad storage configuration stops the boot, naming variables, never values

```
$ STORAGE_DRIVER= node dist/main.js
{"level":"fatal","msg":"Boot failed","err":{"type":"ConfigValidationError","message":"Invalid environment configuration:\n- STORAGE_DRIVER is required", …}}

$ STORAGE_DRIVER=s3 node dist/main.js
… STORAGE_DRIVER must be one of supabase, local

$ STORAGE_DRIVER=supabase SUPABASE_URL=http://abcd.supabase.co SUPABASE_SERVICE_ROLE_KEY="secret value" node dist/main.js
… - SUPABASE_URL must be the project URL such as https://abcd.supabase.co (https, no path, no trailing slash)
  - SUPABASE_SERVICE_ROLE_KEY must be the service role key from the Supabase dashboard (at least 20 characters, no spaces)
```

The first run printed the key's message twice (one per failed rule). Fixed in `fbc2047`, with a
unit test that failed first; the output above is after the fix. `secret value` appears nowhere
in the output.

### `npm run media:orphans` on an empty store

```
$ npm run media:orphans
0 orphaned prefix(es), 0 recent, 0 unknown path(s), 0 linked.
```

## 2. Uploads, through the QA harness

`$B` is `localhost:3105/api/v1`. `POST $B/test-media/posters` uploads a poster with no owner;
`POST $B/test-media/owners` uploads a gallery photo with text fields (`caption`, `mode`) and
links it to a `zz_media_owners` row in the upload's transaction; `PUT
$B/test-media/owners/{id}/image` replaces that row's image with a person photo and deletes the
old image; `DELETE $B/test-media/images/{id}` deletes an image in the request transaction and
reports whether its files still exist at that moment.

### A poster: three WebP variants, one row, a replay, a reused key

```
$ curl -si -X POST $B/test-media/posters -H "Authorization: Bearer $ADMIN"   (no Idempotency-Key)
HTTP/1.1 400 Bad Request
{"error":{"code":"IDEMPOTENCY_KEY_REQUIRED","message":"This request needs an Idempotency-Key header.","details":null,…}}
$ find .media -type f
find: '.media': No such file or directory

$ curl -si -X POST $B/test-media/posters -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: $K1" -F file=@poster.jpg
HTTP/1.1 201 Created
{"imageId":1,"image":{"alt":"Probe poster","variants":[
  {"name":"small","url":"http://localhost:3105/media/poster/fdf17a17-fd9d-4ae5-a4d5-2b12d123f45a/small.webp","width":200,"height":300},
  {"name":"medium","url":"http://localhost:3105/media/poster/fdf17a17-…/medium.webp","width":400,"height":600},
  {"name":"large","url":"http://localhost:3105/media/poster/fdf17a17-…/large.webp","width":800,"height":1200}]}}

$ find .media -type f
.media/poster/fdf17a17-fd9d-4ae5-a4d5-2b12d123f45a/large.webp
.media/poster/fdf17a17-fd9d-4ae5-a4d5-2b12d123f45a/medium.webp
.media/poster/fdf17a17-fd9d-4ae5-a4d5-2b12d123f45a/small.webp

$ psql: SELECT id, kind, storage_prefix, source_width, source_height, created_by_staff_id, variants->'small' FROM images
1|poster|poster/fdf17a17-fd9d-4ae5-a4d5-2b12d123f45a|1000|1500|7|{"path": "poster/fdf17a17-…/small.webp", "bytes": 192, "width": 200, "height": 300}

$ (the same request again, key K1)
HTTP/1.1 201 Created
Idempotent-Replayed: true
{"imageId":1,"image":{…the same body…}}

$ (key K1, another file: poster2.jpg)
HTTP/1.1 422 Unprocessable Entity
{"error":{"code":"IDEMPOTENCY_KEY_REUSED","message":"This Idempotency-Key was already used for a different request.","details":null,…}}

$ find .media -type f | wc -l; psql: SELECT count(*) FROM images
3
1
```

The replay and the refused reuse each deleted the files their own attempt had stored.

### The files at `/media`

```
$ curl -si localhost:3105/media/poster/fdf17a17-…/small.webp
HTTP/1.1 200 OK
Cross-Origin-Resource-Policy: cross-origin
Cache-Control: public, max-age=31536000, immutable
Content-Type: image/webp
Content-Length: 192

$ curl -s localhost:3105/media/poster/fdf17a17-…/large.webp -o large.webp; sharp(large.webp).metadata()
format webp 800x1200 exif false icc false xmp false

$ curl -si -X PUT localhost:3105/media/poster/fdf17a17-…/small.webp --data-binary x
HTTP/1.1 404 Not Found
{"error":{"code":"NOT_FOUND","message":"No route matches PUT /media/poster/fdf17a17-…/small.webp.",…}}
$ curl -si -X DELETE localhost:3105/media/poster/fdf17a17-…/small.webp
HTTP/1.1 404 Not Found
$ curl -si --path-as-is localhost:3105/media/../package.json
HTTP/1.1 404 Not Found
$ curl -si localhost:3105/media/%2e%2e/%2e%2e/package.json
HTTP/1.1 404 Not Found
$ find .media -type f | wc -l
3
```

### Access, then every refusal: no row, no file

```
$ curl -si -X POST $B/test-media/posters -H "Idempotency-Key: …" -F file=@poster.jpg   (no token)
HTTP/1.1 401 Unauthorized
{"error":{"code":"UNAUTHENTICATED",…}}
$ (box office token)
HTTP/1.1 403 Forbidden
{"error":{"code":"FORBIDDEN",…}}

$ -F file=@notes.jpg   (a text file)
HTTP/1.1 415 Unsupported Media Type
{"error":{"code":"UNSUPPORTED_IMAGE_TYPE","message":"Upload a JPG or PNG image.","details":{"allowed":["jpeg","png"]},…}}
$ -F file=@big.jpg     (11 MB)
HTTP/1.1 413 Payload Too Large
{"error":{"code":"IMAGE_TOO_LARGE","message":"This image is larger than 10 MB.","details":{"maxBytes":10485760},…}}
$ -F file=@huge.png    (7000 × 6000)
HTTP/1.1 422 Unprocessable Entity
{"error":{"code":"IMAGE_TOO_MANY_PIXELS","message":"This image has more than 40 megapixels.","details":{"maxPixels":40000000,"width":7000,"height":6000},…}}
$ -F file=@square.jpg  (a square poster)
HTTP/1.1 422 Unprocessable Entity
{"error":{"code":"IMAGE_WRONG_SHAPE","message":"This image does not have the required shape or size.","details":{"kind":"poster","aspect":"2:3","minWidth":400,"minHeight":600,"width":1200,"height":1200},…}}
$ -F caption=x         (no file)
HTTP/1.1 400 Bad Request
{"error":{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"file","messages":["Send one JPG or PNG file in the \"file\" field."]}]},…}}
$ -F file=@poster.jpg -F file=@poster.jpg
HTTP/1.1 400 Bad Request
{"error":{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"file","messages":["Send exactly one file."]}]},…}}

$ find .media -type f | wc -l; psql: SELECT count(*) FROM images
3
1
```

### Orientation and metadata, text fields, and a failed link

```
$ sharp(gps.jpg).metadata()
upload: 1600x1000 orientation 6 exif true icc true
$ curl -si -X POST $B/test-media/owners -H "Authorization: Bearer $ADMIN" -H "Idempotency-Key: …" -F caption="Opening night" -F file=@gps.jpg
HTTP/1.1 201 Created
{"ownerId":1,"imageId":2,"caption":"Opening night"}
$ psql: id, kind, source size, large variant size
2|gallery|1000|1600|1000|1600
$ (download the large variant) sharp metadata and the pixel at (500, 20)
stored: webp 1000x1600 orientation undefined exif false icc false top pixel rgb 254,0,0
```

The photo was turned upright (its red left edge is now the top), kept its own shape and was not
enlarged, and lost its EXIF (GPS included), orientation tag and ICC profile.

```
$ -F caption=<101 characters> -F file=@poster.jpg
HTTP/1.1 400 Bad Request
{"error":{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"caption","messages":["caption must be shorter than or equal to 100 characters"]}]},…}}
$ -F colour=red -F file=@poster.jpg
HTTP/1.1 400 Bad Request
{"error":{"code":"VALIDATION_FAILED",…,"details":{"fields":[{"field":"colour","messages":["property colour should not exist"]}]},…}}

$ find .media -type f | wc -l
6
$ -F mode=refuse -F file=@poster.jpg          (the link throws AppError NOT_FOUND)
HTTP/1.1 404 Not Found
{"error":{"code":"NOT_FOUND",…}}
$ -F mode=missing-owner -F file=@poster.jpg   (the link breaks a foreign key)
HTTP/1.1 500 Internal Server Error
{"error":{"code":"INTERNAL","message":"Something went wrong on our side.",…}}
$ find .media -type f | wc -l; psql: SELECT count(*) FROM images
6
2
```

Both failed links rolled their row back and deleted the files they had stored.

### Replace, delete after commit, rollback keeps files

```
$ find .media -maxdepth 2 -mindepth 2 -type d
.media/gallery/fc13e44c-8124-4f17-a08e-9014e3d38378
.media/poster/fdf17a17-fd9d-4ae5-a4d5-2b12d123f45a
$ curl -si -X PUT $B/test-media/owners/1/image -H "Authorization: Bearer $ADMIN" -F file=@face.png   (no key: a PUT)
HTTP/1.1 200 OK
{"ownerId":1,"imageId":5}
$ find .media -maxdepth 2 -mindepth 2 -type d
.media/person/ff25c785-d32a-4eda-8d42-2b57e778cb73
.media/poster/fdf17a17-fd9d-4ae5-a4d5-2b12d123f45a
$ psql: images; zz_media_owners
1|poster|poster/fdf17a17-fd9d-4ae5-a4d5-2b12d123f45a
5|person|person/ff25c785-d32a-4eda-8d42-2b57e778cb73
1|5

$ curl -si -X DELETE $B/test-media/images/1/failing   (deletes, then throws)
HTTP/1.1 409 Conflict
$ psql: SELECT count(*) FROM images WHERE id = 1; find .media/poster -type f | wc -l
1
3

$ curl -si -X DELETE $B/test-media/images/1
HTTP/1.1 200 OK
{"filesPresentBeforeCommit":true}
$ psql: SELECT count(*) FROM images WHERE id = 1; find .media/poster -type f | wc -l; ls .media
0
0
person
```

(Image ids 3 and 4 were the two failed links; the sequence moved on.)

### `npm run media:orphans`

One old orphaned prefix (files touched 2 hours back), one fresh orphan, and a stray file:

```
$ npm run media:orphans
orphan gallery/fb21f1c2-0991-4e42-8639-363f7e467bd1 3 18 2026-10-20T16:24:36.871Z
recent backdrop/4137ee30-83dd-4b96-b20b-a7abbe16168f 3 9 2026-10-20T18:24:36.869Z (kept: under 60 minutes old)
unknown notes/readme.txt (kept: not an image path)
1 orphaned prefix(es), 1 recent, 1 unknown path(s), 1 linked.
Run with --delete to remove the orphaned prefixes.

$ npm run media:orphans -- --delete
… (the same four lines)
Removed 3 file(s) of 1 orphaned prefix(es).
$ find .media -type f
.media/backdrop/4137ee30-…/large.webp, medium.webp, small.webp
.media/notes/readme.txt
.media/person/ff25c785-…/large.webp, medium.webp, small.webp

$ npm run media:orphans -- --force; echo "exit: $?"
{"level":"fatal","msg":"media:orphans failed","err":{"type":"Error","message":"Unknown argument --force; the only option is --delete",…}}
exit: 1
```

The argument is now checked before the app boots (`src/cli/media-orphans.ts`).

### Logs

The harness logged at `warn`: 22 lines. None contains the caption, the EXIF artist, the long
caption, the refused field name or a token. The one unexpected error (the broken foreign key) is
logged by SQLSTATE and constraint only:

```
{"level":"error",…,"correlationId":"9d24146e-…","context":"GlobalExceptionFilter","code":"INTERNAL","err":{"type":"DatabaseError","code":"23503","constraint":"zz_media_owners_image_id_fkey","stack":"    at parseErrorMessage …"}}
{"level":"error",…,"correlationId":"9d24146e-…","method":"POST","route":"/api/v1/test-media/owners","statusCode":500,"responseTime":178,"principalKind":"staff","principalId":7,"msg":"request failed"}
```

## Not covered here

- Supabase Storage itself: no project is attached to this environment. The adapter's URLs,
  headers, batching, paging and error mapping are covered by
  `test/unit/modules/media/storage/supabase-storage.adapter.test.ts` with `fetch` mocked. The
  first deploy should upload one image through U4b's or U6's route and load its public URL.
