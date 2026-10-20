---
title: U0 — Manual QA of the scaffold
owner: Mohamed Tarek
status: Passed — 2026-10-20
last_verified: 2026-10-20
tags: [qa, scaffold, health, swagger, errors, logging]
---

# U0 — Manual QA of the scaffold

Issue #1, spec [`spec.md`](spec.md). QA mode: `curl` against the built app (`npm run build`,
then `node --enable-source-maps dist/main.js`). Environment: Node 22.22, local PostgreSQL 16.15
(`npm run db:local`), `.env` copied from `.env.example`. Responses are trimmed to the relevant
headers and the body.

## Boot and migrations

The `maqady` schema was dropped from `maqady_dev` first, so boot migrated from empty:

```
$ npm run migrate            # on an up-to-date database
{"level":"info",…,"context":"MigrationRepository","msg":"Database schema is up to date"}
Already up to date.

$ psql … -c 'DROP SCHEMA maqady CASCADE'; node --enable-source-maps dist/main.js
{"level":"info",…,"context":"MigrationRepository","msg":"Applied migration 0010_01_create_schema"}
{"level":"info",…,"context":"RouterExplorer","msg":"Mapped {/api/v1/health, GET} route"}
{"level":"info",…,"context":"RouterExplorer","msg":"Mapped {/api/v1/health/ready, GET} route"}
{"level":"info",…,"context":"Bootstrap","msg":"Listening on port 3000"}

$ psql … -tAc 'SELECT name, batch FROM maqady.knex_migrations'
0010_01_create_schema|1
```

## Health

```
$ curl -i http://localhost:3000/api/v1/health
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self';…;style-src 'self' https: 'unsafe-inline'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Request-Id: 13c79649-e241-4f23-ac91-5313042ef1b9
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
{"status":"ok"}

$ curl -i http://localhost:3000/api/v1/health/ready
HTTP/1.1 200 OK
X-Request-Id: 98946980-e965-47fc-a5d2-f3d6c851adc0
Cache-Control: no-store
{"status":"ok"}
```

## X-Request-Id

```
$ curl -i -H 'X-Request-Id: 6F9619FF-8B86-4011-B42D-00C04FC964FF' http://localhost:3000/api/v1/health
HTTP/1.1 200 OK
X-Request-Id: 6f9619ff-8b86-4011-b42d-00c04fc964ff          # echoed, lower-cased

$ curl -i -H 'X-Request-Id: not-a-uuid' http://localhost:3000/api/v1/health
HTTP/1.1 200 OK
X-Request-Id: d3dd62fb-33a4-4327-9e7e-a75684c899d6          # replaced with a new UUID
```

## Error shapes

```
$ curl -i 'http://localhost:3000/api/v1/nope?email=a@b.example'
HTTP/1.1 404 Not Found
X-Request-Id: cbc1e4c4-e961-4cd5-ba32-c0dc5fda8971
{"error":{"code":"NOT_FOUND","message":"No route matches GET /api/v1/nope.","details":null,"correlationId":"cbc1e4c4-e961-4cd5-ba32-c0dc5fda8971"}}

$ curl -i -X POST -H 'Content-Type: application/json' \
       -H 'X-Request-Id: 3d594650-3436-4a88-9e6c-1d4c0f5a0b2e' --data '{"name":' http://localhost:3000/api/v1/health
HTTP/1.1 400 Bad Request
X-Request-Id: 3d594650-3436-4a88-9e6c-1d4c0f5a0b2e
{"error":{"code":"VALIDATION_FAILED","message":"Unexpected end of JSON input","details":null,"correlationId":"3d594650-3436-4a88-9e6c-1d4c0f5a0b2e"}}
# Review finding R1 (review.md): the parser's message leaked through. After the fix:
{"error":{"code":"VALIDATION_FAILED","message":"The request body could not be read.","details":null,"correlationId":"3d594650-3436-4a88-9e6c-1d4c0f5a0b2e"}}

$ curl -i -X POST -H 'Content-Type: application/json' --data-binary @big.json http://localhost:3000/api/v1/health   # 1.1 MB
HTTP/1.1 413 Payload Too Large
{"error":{"code":"PAYLOAD_TOO_LARGE","message":"The request body is too large.","details":null,"correlationId":"ccfc5f65-ae64-472d-9d4e-08bfa13c9a8b"}}
```

The scaffold has no write endpoint, so `VALIDATION_FAILED` with field details, `INTERNAL` and
`CONFLICT` are exercised through the integration suite's test-only probe routes
(`test/integration/common/errors/global-exception.filter.test.ts`).

## Database down

```
$ pg_ctlcluster 16 main stop
$ curl -i -w 'time_total=%{time_total}s' http://localhost:3000/api/v1/health/ready
HTTP/1.1 503 Service Unavailable
X-Request-Id: 6e0a1827-d75e-40fe-8b74-22f67da4e599
{"error":{"code":"SERVICE_UNAVAILABLE","message":"The service is temporarily unavailable.","details":null,"correlationId":"6e0a1827-d75e-40fe-8b74-22f67da4e599"}}
time_total=0.008932s

$ curl -i http://localhost:3000/api/v1/health                # liveness never touches the database
HTTP/1.1 200 OK
{"status":"ok"}

$ pg_ctlcluster 16 main start
$ curl -i http://localhost:3000/api/v1/health/ready          # the pool reconnects; no restart needed
HTTP/1.1 200 OK
{"status":"ok"}
```

Log lines for the failed readiness check: Knex's own warning, now JSON and bound to the
request, then the filter's warning with the sanitized error and its source-mapped stack:

```
{"level":"warn",…,"correlationId":"6e0a1827-…","context":"Knex","msg":"Acquire connection error: Error: connect ECONNREFUSED 127.0.0.1:5432…"}
{"level":"warn",…,"correlationId":"6e0a1827-…","context":"GlobalExceptionFilter","code":"SERVICE_UNAVAILABLE","err":{"type":"AppError","message":"The service is temporarily unavailable.","code":"SERVICE_UNAVAILABLE","stack":"AppError: …\n    at HealthService.getReadiness (…/src/modules/health/health.service.ts…)","cause":{…"code":"ECONNREFUSED"…}}}
```

## Fail-fast boot

```
$ DATABASE_URL='mysql://admin:TopSecretPassword42@db.example.com/maqady' DB_SCHEMA= \
  CORS_ORIGINS='https://maqady.example/' PORT=99999 node dist/main.js; echo "exit=$?"
{"level":"fatal",…,"msg":"Boot failed","err":{"type":"ConfigValidationError","message":"Invalid environment configuration:
- DATABASE_URL must be a postgres:// or postgresql:// connection URL
- DB_SCHEMA is required
- CORS_ORIGINS must be a comma-separated list of origins such as https://maqady.example (no path, no trailing slash)
- PORT must be an integer between 1 and 65535",…}}
exit=1                                                       # the password is never printed

$ DATABASE_URL='postgres://postgres:postgres@127.0.0.1:1/maqady_dev' PORT=3999 node dist/main.js; echo "exit=$?"
{"level":"fatal",…,"msg":"Boot failed","err":{"type":"Error","message":"connect ECONNREFUSED 127.0.0.1:1","code":"ECONNREFUSED",…}}
exit=1                                                       # migrations failed, so it never listened
```

## CORS

```
$ curl -i -X OPTIONS -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: PATCH' \
       -H 'Access-Control-Request-Headers: authorization,idempotency-key,x-hold-token,x-request-id,content-type' \
       http://localhost:3000/api/v1/health
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET,HEAD,POST,PUT,PATCH,DELETE
Access-Control-Allow-Headers: Authorization,Content-Type,Idempotency-Key,X-Hold-Token,X-Request-Id
Access-Control-Max-Age: 600
Access-Control-Expose-Headers: Idempotent-Replayed,X-Request-Id,Content-Disposition,Retry-After

$ curl -i -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET' http://localhost:3000/api/v1/health
HTTP/1.1 204 No Content                                      # no Access-Control-Allow-Origin
```

## Swagger

```
$ curl -s -o /dev/null -w '%{http_code} %{content_type}' http://localhost:3000/api/docs
200 text/html; charset=utf-8                                 # <title>Maqady API docs</title>
$ for a in swagger-ui.css swagger-ui-bundle.js swagger-ui-standalone-preset.js swagger-ui-init.js; do …; done
swagger-ui.css 200 · swagger-ui-bundle.js 200 · swagger-ui-standalone-preset.js 200 · swagger-ui-init.js 200

$ curl -s http://localhost:3000/api/docs/openapi.json | python3 -c '…'
3.0.3 | Maqady API 0.1.0 | [('/health', 'getHealth', ['200', '500']), ('/health/ready', 'getReadiness', ['200', '500', '503'])] | ['HealthResponse', 'ErrorResponse'] | ['customer', 'staff']

$ curl -s -o /dev/null -w '%{http_code} %{content_type}' http://localhost:3000/api/docs/openapi.yaml
200 text/yaml; charset=utf-8

$ node -e "…assert.deepStrictEqual(served /api/docs/openapi.json, contracts/openapi.yaml)…"
served /api/docs/openapi.json deep-equals contracts/openapi.yaml
```

## Request logs

One line per request: no URL, query string, headers or body. The email in the 404's query
string appears nowhere in the log (`grep -c 'a@b.example'` → `0`):

```
{"level":"info","time":"2026-10-20T13:52:36.998Z","correlationId":"98946980-…","method":"GET","route":"/api/v1/health/ready","statusCode":200,"responseTime":2,"msg":"request completed"}
{"level":"warn","time":"2026-10-20T13:52:37.026Z","correlationId":"cbc1e4c4-…","method":"GET","route":null,"statusCode":404,"responseTime":2,"msg":"request completed"}
```

## Docker image, replayed

Docker isn't available in this environment, so the `Dockerfile` steps were replayed by hand in
a scratch directory. The image itself is built by Render and on developer machines.

```
$ cp package.json package-lock.json .npmrc tsconfig*.json nest-cli.json src/ → build/
$ npm ci && npm run build && npm prune --omit=dev           # found 0 vulnerabilities
$ cp package.json node_modules dist → runtime/              # dev dependencies gone (no jest), js-yaml kept
$ NODE_ENV=production PORT=3100 DATABASE_URL=… DB_SCHEMA=maqady CORS_ORIGINS=… node --enable-source-maps dist/main.js
GET /api/v1/health 200 · GET /api/v1/health/ready 200 · GET /api/docs 200 · openapi.json 0.1.0 ['/health', '/health/ready']
$ node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health')…"     # the HEALTHCHECK command
exit=0 against the running app · exit=1 against a port nobody listens on
```

## Shutdown

```
$ node dist/main.js & …; curl /api/v1/health/ready; kill -TERM $pid; wait $pid
exit code after SIGTERM: 143 (128+15 = re-raised SIGTERM) in 15 ms     # pool closed, nothing hangs
```

## Result

Every endpoint and behaviour in the spec responded as specified. The QA found and fixed one
packaging problem: `js-yaml` moved to the production dependencies, because the app imports it
at run time.
