---
title: U2a manual QA - staff access core
owner: Mohamed Tarek
status: Done
last_verified: 2026-10-20
tags: [qa, staff, auth, sessions, refresh-tokens, last-admin, rate-limit]
---

# U2a manual QA: staff access core

Issue #4 (U2a). Spec: `docs/gh-4-staff-access/spec.md`.

**Setup.** The worktree's own databases (`maqady_u2a_dev`), the app built from the unit branch and
started with `node dist/main.js` on port 3104, fresh local secrets in `.env`, production rate
limits (none overridden). Bodies are trimmed: correlation ids and long tokens are shortened to
`…`. `B=http://localhost:3104/api/v1`.

Staff seeded for QA: #1 `QA Admin` from `npm run admin:create`; #2 `Karim Box Office` (active),
#3 `Salma Second Admin` (active admin) and #4 `Hana Invited` (invited, no password), inserted with
SQL because the invite route is U2b's.

## admin:create

```console
$ BOOTSTRAP_ADMIN_EMAIL=qa.admin@maqady.example BOOTSTRAP_ADMIN_NAME="QA Admin" \
  BOOTSTRAP_ADMIN_PASSWORD=Cinema2026 npm run admin:create
Applied 7 migration(s) … (info lines)
Created admin #1. Sign in at /admin/login, then remove BOOTSTRAP_ADMIN_PASSWORD from the environment.

$ (same variables) node dist/cli/admin-create.js
An active admin already exists. Nothing changed.
```

Neither the email nor the password appears in the output or in the info log lines.

## Sign-in: `POST /admin/auth/sessions`

| # | Request | Status | Body (trimmed) |
|---|---|---|---|
| 1 | `{"email":"QA.Admin@maqady.example","password":"Cinema2026"}` (case differs) | 201 | `{"accessToken":"eyJ…","accessTokenExpiresAt":"2026-10-20T21:08:03+03:00","refreshToken":"o0YI…","refreshTokenExpiresAt":"2026-10-21T08:53:03+03:00","staff":{"id":1,"fullName":"QA Admin","email":"qa.admin@maqady.example","role":"admin"}}` |
| 2 | right email, `wrong-pass-1` | 401 | `INVALID_CREDENTIALS` |
| 3 | `nobody@maqady.example` | 401 | `INVALID_CREDENTIALS` (same answer, ~210 ms like a real check) |
| 4 | `{"email":"nope","extra":true}` | 400 | `VALIDATION_FAILED`, fields `extra`, `email`, `password` |
| 22 | deactivated member, right password | 403 | `ACCOUNT_DEACTIVATED` |
| 22 | deactivated member, wrong password | 401 | `INVALID_CREDENTIALS` |

The access token lasts 15 minutes and the session 12 hours from sign-in (21:08 and 08:53 next
day, Cairo time with offset).

## `GET /admin/me`

| # | Token | Status | Body |
|---|---|---|---|
| 5 | admin | 200 | `{"id":1,"fullName":"QA Admin","email":"qa.admin@maqady.example","role":"admin"}` |
| 6 | none | 401 | `UNAUTHENTICATED` |
| 18 | box office | 200 | `{"id":2,"fullName":"Karim Box Office",…,"role":"box_office"}` |

## Refresh: `POST /admin/auth/tokens`

```console
$ curl -s -X POST $B/admin/auth/tokens -d '{"refreshToken":"o0YI…"}'          # 7
201 {"accessToken":"eyJ…","accessTokenExpiresAt":"2026-10-20T21:08:30+03:00",
     "refreshToken":"8B0U…","refreshTokenExpiresAt":"2026-10-21T08:53:03+03:00"}
$ (the same old token again, within 30 s)                                         # 8
409 {"error":{"code":"REFRESH_CONFLICT","message":"These tokens were just refreshed elsewhere.",…}}
$ curl -s $B/admin/me -H "Authorization: Bearer <new access token>"                # 9
200 {"id":1,…}
$ … '{"refreshToken":"abc"}'                                                       # 10
400 VALIDATION_FAILED  refreshToken must be a refresh token as issued
$ … '{"refreshToken":"ZZZZ…(43)"}'
401 UNAUTHENTICATED
$ (wait 31 s) the old token again                                                   # 11
401 {"error":{"code":"SESSION_REVOKED",…}}
$ GET /admin/me with the newest access token; refresh with the newest token         # 12
401 SESSION_REVOKED   401 SESSION_REVOKED
```

The expiry stays `08:53:03` after the refresh (absolute). The rows after step 12:

```text
 id | staff_user_id | rotated | replaced_by_id | revoked_reason
  1 |             1 | t       |              2 | refresh_reuse
  2 |             1 | f       |                | refresh_reuse
```

## Staff screen: `GET /admin/staff`

```console
$ curl -s "$B/admin/staff?limit=2" -H "Authorization: Bearer <admin>"             # 13
200 {"items":[{"id":4,"fullName":"Hana Invited",…,"status":"invited","lastSignInAt":null,
     "createdAt":"2026-10-20T20:53:19+03:00"},{"id":2,"fullName":"Karim Box Office",…,
     "lastSignInAt":"2026-10-20T20:54:24+03:00",…}],"nextCursor":"WyJLYXJpbSBCb3ggT2ZmaWNlIiwyXQ","total":4}
$ … "?limit=2&cursor=WyJLYXJp…"                                                    # 14
['QA Admin', 'Salma Second Admin']  nextCursor None  total 4
$ … "?role=box_office&status=invited"                                              # 15
200 {"items":[{"id":4,"fullName":"Hana Invited",…}],"nextCursor":null,"total":1}
$ … "?status=gone"                                                                 # 16
400 VALIDATION_FAILED  status must be one of the following values: invited, active, deactivated
```

## Changes: `PATCH /admin/staff/{id}`

| # | Who, request | Status | Result |
|---|---|---|---|
| 17 | box office: `GET /admin/staff`, `PATCH /admin/staff/2 {"role":"admin"}` | 403, 403 | `FORBIDDEN` |
| 19 | admin: `PATCH /admin/staff/3 {"role":"box_office"}` (demote Salma) | 200 | `role: box_office` |
| 20 | Salma's old access token on `GET /admin/me`; her refresh token | 401, 401 | `SESSION_REVOKED` (demotion signed her out) |
| 21 | only admin: `PATCH /admin/staff/1 {"role":"box_office"}`, then `{"status":"deactivated"}` | 409, 409 | `LAST_ADMIN` |
| 22 | admin: `PATCH /admin/staff/2 {"status":"deactivated"}`; Karim's token on `/admin/me` | 200, 403 | `deactivated`; `ACCOUNT_DEACTIVATED` on the next request |
| 23 | admin: `PATCH /admin/staff/2 {"status":"active"}` | 200 | `active` again |
| 24 | admin: `PATCH /admin/staff/4 {"status":"active"}` (invited) | 400 | `VALIDATION_FAILED` on `status`: "an invited member becomes active by setting their password" |
| 24 | then `{"status":"deactivated"}`, then `{"status":"active"}` | 200, 200 | `deactivated`, then `invited` (never set a password) |
| 25 | `PATCH /admin/staff/999 {"role":"admin"}` | 404 | `NOT_FOUND` |
| 25 | `PATCH /admin/staff/2 {}` | 400 | `VALIDATION_FAILED`, `role`: "send role, status or both" |
| 25 | `PATCH /admin/staff/x` | 400 | `VALIDATION_FAILED` on `id` |
| 25 | `PATCH /admin/staff/3 {"role":"admin"}` with `Idempotency-Key: qa-promote-salma`, twice | 200, 200 | the second has `Idempotent-Replayed: true` |

## Sign-out: `DELETE /admin/auth/sessions/current`

```console
$ curl -s -i -X DELETE $B/admin/auth/sessions/current -H "Authorization: Bearer <admin>"   # 26
HTTP/1.1 204 No Content
$ curl -s $B/admin/me -H "Authorization: Bearer <same token>"
401 {"error":{"code":"SESSION_REVOKED",…}}
```

## Rate limit (production values)

```console
$ for i in 1..6: POST $B/admin/auth/sessions {"email":"rate.qa@maqady.example",…}           # 27
401 401 401 401 401 429
$ (7th)
HTTP/1.1 429 Too Many Requests
Retry-After-signInEmail: 60
Retry-After: 60
{"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again shortly.",…}}
```

## Activity log and logs

Audit rows after the run (`maqady.audit_events`, trimmed): `staff_user.created` (system, the
bootstrap), `session.created` per sign-in, `session.reuse_detected` (system, entity session 1),
`staff_user.updated` with `changed_fields` `{role}` or `{status}` and metadata such as
`{"role": "box_office", "status": "deactivated"}`, and `session.revoked` `{"reason": "sign_out"}`.
No names, emails or tokens.

The server log has one line per request with method, route template, status, principal kind and
id. `grep -cE 'qa.admin@|counter.one@|Cinema2026|Counter2026|refreshToken'` over the whole log
is `0`.

## Swagger

`GET /api/docs/openapi.json` lists `POST /admin/auth/sessions`, `POST /admin/auth/tokens`,
`DELETE /admin/auth/sessions/current`, `GET /admin/me`, `GET /admin/staff` and
`PATCH /admin/staff/{id}`, each with its error codes and examples (for example `409
REFRESH_CONFLICT` on the refresh route).
