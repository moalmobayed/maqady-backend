---
title: U1 — Manual QA of the foundations
owner: Mohamed Tarek
status: Passed — 2026-10-20
last_verified: 2026-10-20
tags: [qa, foundations, idempotency, auth, rate-limit, swagger]
---

# U1 — Manual QA of the foundations

Issue #2, spec [`spec.md`](spec.md). QA mode: `curl`. Environment: Node 22.22, local PostgreSQL
16.15, this unit's own database `maqady_u1_dev` (migrated from empty at boot), fresh random
secrets from `openssl rand -base64 32`. Responses are trimmed to the status line, the relevant
headers and the body.

U1 adds no product route, so QA has two parts:

1. **The real app** (`npm run build`, then `node --enable-source-maps dist/main.js` on port 3101,
   with `RATE_LIMIT_DEFAULT=5/1m`): boot and migrations, the health routes under the guards, the
   default rate limit, the published document, CORS and refusal of bad configuration.
2. **A QA-only harness** on port 3102: the same `AppModule`, compiled with `tsc` into a scratch
   directory together with the test-only probe routes of `test/support/foundations-probe.module.ts`
   and the test principal resolvers (customer 7 on session 70, customer 8 on 71, admin 3 on 30,
   box office 4 on 40), with tokens signed by the app's own `AccessTokenService`. It is not part
   of the repository; it gives the write interceptor and the guards real routes to answer.
   The probe tables were dropped from `maqady_dev` afterwards.

## 1. The real app

### Boot, migrations, row-level security, health under the guards, the default limit

`/health/ready` is `@Public()`, so a broken bearer token is ignored. The default limit (5 per
minute here) counts per route; the sixth call within the minute is refused with `Retry-After`.

```
$ grep "Applied migration" app.log
"msg":"Applied migration 0010_01_create_schema"
"msg":"Applied migration 0020_01_create_idempotency_keys"
"msg":"Applied migration 0020_02_create_audit_events"
"msg":"Listening on port 3101"

$ psql maqady_u1_dev: tables, RLS
audit_events|t
idempotency_keys|t
knex_migrations|t
knex_migrations_lock|t

$ curl -s localhost:3101/api/v1/health/ready -H "Authorization: Bearer not.a.token"
{"status":"ok"}

$ for i in 1..6: curl -s -o /dev/null -w "%{http_code} " localhost:3101/api/v1/health/ready
200 200 200 200 429 429 

$ curl -si localhost:3101/api/v1/health/ready   (7th call)
HTTP/1.1 429 Too Many Requests
X-Request-Id: 97f97bf4-285e-4a1b-83f7-a8ab82035893
Retry-After: 60
{"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again shortly.","details":null,"correlationId":"97f97bf4-285e-4a1b-83f7-a8ab82035893"}}
```

### The published document, CORS and the write path of an unknown route

```
$ curl -s localhost:3101/api/docs/openapi.json | jq (per operation: security and response codes)
GET /health security=[] responses=200,429,500 429 examples=RATE_LIMITED
GET /health/ready security=[] responses=200,429,500,503 429 examples=RATE_LIMITED
x-maqady markers in document: false

$ curl -si -X OPTIONS localhost:3101/api/v1/health -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: idempotency-key,authorization"
HTTP/1.1 204 No Content
Access-Control-Allow-Methods: GET,HEAD,POST,PUT,PATCH,DELETE
Access-Control-Allow-Headers: Authorization,Content-Type,Idempotency-Key,X-Hold-Token,X-Request-Id

$ curl -si -X POST localhost:3101/api/v1/nothing-here -H "Idempotency-Key: bad key"
HTTP/1.1 404 Not Found
{"error":{"code":"NOT_FOUND","message":"No route matches POST /api/v1/nothing-here.","details":null,"correlationId":"1dad2a30-d1c0-4bb6-aa24-f0aa74cb13ca"}}
```

### Boot refuses bad secrets and rate limits, naming variables, never values

```
$ (no JWT_SECRET_CUSTOMER, JWT_SECRET_STAFF too short, DATA_ENCRYPTION_KEY of 16 bytes, RATE_LIMIT_SEARCH=60) node dist/main.js
exit code: 1
fatal Boot failed
Invalid environment configuration:
- JWT_SECRET_CUSTOMER is required
- JWT_SECRET_STAFF must be base64 encoding at least 32 bytes; generate one with: openssl rand -base64 32
- DATA_ENCRYPTION_KEY must be base64 encoding exactly 32 bytes; generate one with: openssl rand -base64 32
- RATE_LIMIT_SEARCH must be <count>/<window>, the window in s, m or h, for example 300/1m

$ (the same secret for both audiences) node dist/main.js
exit code: 1
Invalid environment configuration:
- JWT_SECRET_STAFF must differ from JWT_SECRET_CUSTOMER
```

## 2. The write interceptor, through the QA harness

`$B` is `localhost:3102/api/v1`. `POST /test-foundations/widgets` is `@Strict()` and inserts a
row through the request transaction; `POST /test-foundations/lock-pairs` locks row `first`, waits
for its twin, then locks the other row, so two opposite calls deadlock.

```
$ curl -si -X POST $B/test-foundations/widgets -d {"name":"Lamp"}    (strict, no key)
HTTP/1.1 400 Bad Request
{"error":{"code":"IDEMPOTENCY_KEY_REQUIRED","message":"This request needs an Idempotency-Key header.","details":null,"correlationId":"998c8feb-430c-44e1-a1ff-dd962f9cf2c5"}}

$ curl -si -X POST $B/test-foundations/widgets -H "Idempotency-Key: bad key!"
HTTP/1.1 400 Bad Request
{"error":{"code":"VALIDATION_FAILED","message":"The request is not valid.","details":{"fields":[{"field":"Idempotency-Key","messages":["Idempotency-Key must be 1 to 128 letters, digits, \"_\" or \"-\", such as a UUID"]}]},"correlationId":"3bfaec51-f845-42b7-82d6-3f3e4fdb8c4d"}}

$ curl -si -X POST $B/test-foundations/widgets -H "Idempotency-Key: 6f1d1f2e-8c55-4a43-9a7e-0d6b1b3e2a10" -d {"name":"Lamp"}   (first)
HTTP/1.1 201 Created
{"id":1,"name":"Lamp","run":1}

$ same request again (retry)
HTTP/1.1 201 Created
Idempotent-Replayed: true
{"id":1,"name":"Lamp","run":1}

$ same key, body {"name":"Chair"}
HTTP/1.1 422 Unprocessable Entity
{"error":{"code":"IDEMPOTENCY_KEY_REUSED","message":"This Idempotency-Key was already used for a different request.","details":null,"correlationId":"19b77070-9f36-4ba7-8329-37ebe44ec580"}}

$ psql: SELECT scope, response_status, left(response_ciphertext, 14) FROM idempotency_keys; SELECT name FROM zz_widgets
anonymous|201|v1.9fba8c04.DC...
Lamp

$ two concurrent POSTs with Idempotency-Key: 0a9e6f0c-3b1f-4d7e-8f52-6a7c9d0e1b23
- response 1:
HTTP/1.1 201 Created
Idempotent-Replayed: true
{"id":2,"name":"Desk","run":2}
- response 2:
HTTP/1.1 201 Created
{"id":2,"name":"Desk","run":2}

$ deadlocking twins: POST $B/test-foundations/lock-pairs {"first":"a"} and {"first":"b"} at once
{"tag":"left","attempt":2}
{"tag":"right","attempt":1}
```

The two concurrent `Desk` requests ran the handler once (one row, `run` 2 being the handler's
second run overall, after `Lamp`); the other answered the stored response with
`Idempotent-Replayed: true`. In the deadlock, Postgres aborted one twin with `40P01`; the
interceptor re-ran its whole transaction (`attempt` 2) and both succeeded.

## 3. The access guards, through the QA harness

`$B` is `localhost:3102/api/v1/test-access`; one route per access level answers with the
principal the guards resolved.

```
$ curl -si $B/customer -H "Authorization: Bearer $CUSTOMER"
HTTP/1.1 200 OK
{"principal":{"kind":"customer","id":7,"sessionId":70}}

$ curl -si $B/customer   (no token)
HTTP/1.1 401 Unauthorized
{"error":{"code":"UNAUTHENTICATED","message":"Sign in to continue.","details":null,"correlationId":"51d83b2e-fcd2-4310-b2a5-01708362a15e"}}

$ curl -si $B/customer -H "Authorization: Bearer $ADMIN"   (staff token, wrong audience)
HTTP/1.1 401 Unauthorized
{"error":{"code":"UNAUTHENTICATED","message":"Sign in to continue.","details":null,"correlationId":"29b74907-0108-462e-b03a-33f24a153d0e"}}

$ curl -si $B/customer -H "Authorization: Bearer <customer token with one signature character changed>"
HTTP/1.1 401 Unauthorized
{"error":{"code":"UNAUTHENTICATED","message":"Sign in to continue.","details":null,"correlationId":"d68b4dd5-75f3-4237-813d-8c8474f16823"}}

$ curl -si $B/guest
HTTP/1.1 200 OK
{"principal":null}

$ curl -si $B/guest -H "Authorization: Bearer garbage"
HTTP/1.1 401 Unauthorized
{"error":{"code":"UNAUTHENTICATED","message":"Sign in to continue.","details":null,"correlationId":"f4296cb8-1e7f-462c-af1e-4def167f98df"}}

$ curl -si $B/staff -H "Authorization: Bearer $BOX_OFFICE"
HTTP/1.1 200 OK
{"principal":{"kind":"staff","id":4,"sessionId":40,"role":"box_office"}}

$ curl -si $B/admin -H "Authorization: Bearer $BOX_OFFICE"
HTTP/1.1 403 Forbidden
{"error":{"code":"FORBIDDEN","message":"You do not have access to this.","details":null,"correlationId":"e59b5adc-b795-494b-bf0d-787a2480fece"}}

$ curl -si $B/admin -H "Authorization: Bearer $ADMIN"
HTTP/1.1 200 OK
{"principal":{"kind":"staff","id":3,"sessionId":30,"role":"admin"}}

$ POST $B/customer-writes with Idempotency-Key: 3c3b9a1e-2d4f-4e5a-8b6c-7d8e9f0a1b2c, as customer 7, then as customer 8
HTTP/1.1 201 Created
{"principalId":7}
HTTP/1.1 201 Created
{"principalId":8}
$ psql: scopes of that key
customer:7
customer:8
```

## Logs

The harness logged at `warn`. No token and no request body appears in any line, and a refused
request is one line with method, route template, status and correlation id:

```
$ grep -c "<customer token>" harness.log; grep -c "Lamp" harness.log
0
0
$ one 401 request line from harness.log
{"level":"warn","time":"2026-10-20T16:53:13.703Z","pid":5769,"hostname":"vm","correlationId":"51d83b2e-fcd2-4310-b2a5-01708362a15e","method":"GET","route":"/api/v1/test-access/customer","statusCode":401,"responseTime":1,"msg":"request completed"}
```

## Result

Every check above behaved as the spec says. Nothing found in QA needed a code change; the one
defect found while testing (`iat` missing from access tokens) was caught by a unit test first and
fixed in `fix(auth): keep the iat claim on access tokens`.
