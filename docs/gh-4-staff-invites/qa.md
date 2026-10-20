---
title: U2b manual QA - staff invites, password reset and setup, Message log
owner: Mohamed Tarek
status: Done
last_verified: 2026-10-20
tags: [qa, staff, invites, password-reset, one-time-tokens, message-log, rate-limit]
---

# U2b manual QA: staff invites, password reset and setup, Message log

Issue #4 (U2b). Spec: `docs/gh-4-staff-invites/spec.md`.

**Setup.** The worktree's own database `maqady_u2b_dev`, dropped and re-created first; the app
built from the unit branch (`npm run build`); port 3106; fresh local secrets in `.env`;
`EMAIL_DRIVER=simulated`; production rate limits (none overridden). Bodies are trimmed: error
bodies show `code` and `details` only, correlation ids and tokens are shortened to `…`.
`B=http://localhost:3106/api/v1`; `$A` is the admin's access token from
`POST $B/admin/auth/sessions`.

QA has two parts, because a one-time link exists only in the email itself:

1. **The real app** (`node --enable-source-maps dist/main.js`): every route, the Message log,
   the database rows, the rate limit, the published document and the logs.
2. **A QA-only harness** on the same port and database, not part of the repository: the same
   compiled `AppModule` booted through `@nestjs/testing` with only `EmailSender` replaced by one
   that appends each email (to, subject, text) to a local `inbox.jsonl`, the way a recipient's
   inbox would hold it. It completes invites and resets with the real links.

## 1. The real app

### Migrations and the bootstrap admin

```console
$ BOOTSTRAP_ADMIN_EMAIL=qa.admin@maqady.example BOOTSTRAP_ADMIN_NAME="QA Admin" \
  BOOTSTRAP_ADMIN_PASSWORD=Cinema2026 node dist/cli/admin-create.js
… "msg":"Applied migration 0045_01_add_messages_staff_fk"
… "msg":"Applied migration 0045_02_comment_one_time_tokens_lookup"
Created admin #1. Sign in at /admin/login, then remove BOOTSTRAP_ADMIN_PASSWORD from the environment.

$ psql -d maqady_u2b_dev -Atc "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'fk_messages_related_staff_user_id'"
fk_messages_related_staff_user_id|FOREIGN KEY (related_staff_user_id) REFERENCES maqady.staff_users(id)

$ psql … -Atc "SELECT obj_description('maqady.uq_one_time_tokens_token_hash'::regclass)"
Consume: UPDATE ... WHERE token_hash = :hash AND purpose = :purpose AND used_at IS NULL AND expires_at > :now RETURNING ...; findLive (U2b password setup): SELECT ... WHERE token_hash = :hash AND used_at IS NULL AND expires_at > :now.
```

`0045_02`'s `down` and `up` were also run by hand against the dev database: `down` restored
U2a's comment exactly as stored, `up` wrote the text above. (A first version used `?`
placeholders, which Knex rewrote to `$n` inside the literal; fixed before this run.)

### Invite: `POST /admin/staff`

| # | Request | Status | Body (trimmed) |
|---|---|---|---|
| 1 | `{"fullName":"Hana Invited","email":"hana@maqady.example","role":"box_office"}`, no `Idempotency-Key` | 400 | `{"code":"IDEMPOTENCY_KEY_REQUIRED","details":null}` |
| 2 | the same with `"fullName":" Hana Invited "`, `Idempotency-Key: qa-invite-hana-1` | 201 | `{"id":2,"fullName":"Hana Invited","email":"hana@maqady.example","role":"box_office","status":"invited","lastSignInAt":null,"createdAt":"2026-10-20T21:58:19+03:00"}` |
| 3 | #2 again, same key | 201 | the same body, header `Idempotent-Replayed: true`; no second message row |
| 4 | `"email":"HANA@Maqady.example"`, new key | 409 | `{"code":"EMAIL_TAKEN","details":null}` |
| 5 | `"email":"\"a b\"@maqady.example","role":"owner"` | 400 | `VALIDATION_FAILED`, fields `email` ("email must be an email address") and `role` |

### Resend: `POST /admin/staff/{id}/invitations`

| # | Request | Status | Body |
|---|---|---|---|
| 6 | `/2/invitations` (invited), key | 201 | `{"staffUserId":2,"expiresAt":"2026-10-23T21:58:29+03:00"}` (72 hours) |
| 7 | `/1/invitations` (the active admin), key | 409 | `{"code":"NOT_INVITED","details":{"status":"active"}}` |
| 8 | `/999/invitations`, key | 404 | `{"code":"NOT_FOUND","details":null}` |
| 9 | `/2/invitations`, no key | 400 | `{"code":"IDEMPOTENCY_KEY_REQUIRED","details":null}` |

### Forgot password and set password (no real link yet)

```console
$ for e in nobody@maqady.example hana@maqady.example ' QA.Admin@maqady.example '; do
    curl -s -o /dev/null -w "%{http_code} body_bytes=%{size_download}\n" \
      -X POST $B/admin/auth/password-reset-requests -H 'content-type: application/json' -d "{\"email\":\"$e\"}"
  done
202 body_bytes=0
202 body_bytes=0
202 body_bytes=0
```

Only the active admin got a message (row 3 below); the unknown and the invited email got
nothing.

| # | `POST /admin/auth/password-setups` body | Status | Body |
|---|---|---|---|
| 10 | a well-formed token nobody issued, `"password":"Cinema2026"` | 400 | `{"code":"INVALID_TOKEN","details":null}` |
| 11 | `"token":"abc"` | 400 | `{"code":"INVALID_TOKEN","details":null}` (not `VALIDATION_FAILED`) |
| 12 | `"token":"abc","password":"short"` | 400 | `VALIDATION_FAILED` on `password`: "password must be 8 to 128 characters and include a digit" |
| 13 | `"token":""` | 400 | `VALIDATION_FAILED` on `token` |

### Message log: `GET /admin/messages`, `GET /admin/messages/{id}`

```console
$ curl -s "$B/admin/messages?limit=10" -H "authorization: Bearer $A"
200 {"items":[
  {"id":3,"channel":"email","template":"staff.password_reset","recipient":"qa.admin@maqady.example","subject":"Reset your Maqady dashboard password","status":"sent","attempts":1,"lastErrorCode":null,"nextAttemptAt":null,"sentAt":"2026-10-20T21:58:38+03:00","related":{"customerId":null,"staffUserId":1,"bookingId":null},"createdAt":"2026-10-20T21:58:38+03:00"},
  {"id":2,"channel":"email","template":"staff.invite","recipient":"hana@maqady.example",…,"related":{"customerId":null,"staffUserId":2,"bookingId":null},…},
  {"id":1,"channel":"email","template":"staff.invite",…}],
 "nextCursor":null,"total":3}

$ curl -s $B/admin/messages/1 -H "authorization: Bearer $A" | jq '{id,template,status,attempts,providerMessageId,bodyText}'
{ "id": 1, "template": "staff.invite", "status": "sent", "attempts": 1,
  "providerMessageId": "simulated-email-1",
  "bodyText": "Hello Hana Invited,\n\nAn admin has invited you to the Maqady dashboard as Box office.\n\nSet your password within 72 hours.\n[one-time link hidden]\n\nThe link works once. If you weren't expecting this invite, you can ignore this email." }
```

| # | Query | Status | Result |
|---|---|---|---|
| 14 | `?limit=2`, then `&cursor=<nextCursor>` | 200 | ids `[3,2]` (`nextCursor` `WyIyMDI2LTEwLTIwVDE4OjU4OjI5LjkyOVoiLDJd`, the instant with milliseconds), then `[1]`, `nextCursor: null`; `total: 3` both times |
| 15 | `?status=sent&channel=email` / `?channel=sms` | 200 | `[3,2,1]` / `[]`, `total` 3 / 0 |
| 16 | `?from=2026-10-20T18:58:29.929Z` (message 2's `created_at`) / `?to=` the same | 200 | `[3,2]` (from inclusive) / `[1]` (to exclusive) |
| 17 | `from` = `to` | 400 | `VALIDATION_FAILED` on `to`: "to must be later than from" |
| 18 | `?from=2026-10-20` | 400 | `VALIDATION_FAILED` on `from`: "from must be an ISO 8601 time with its offset, …" |
| 19 | `?status=delivered`, `?cursor=bad!`, `?limit=101` | 400 | `VALIDATION_FAILED` on `status`, `cursor`, `limit` |
| 20 | `/messages/999` / `/messages/abc` / no token | 404 / 400 / 401 | `NOT_FOUND` / `VALIDATION_FAILED` on `id` / `UNAUTHENTICATED` |

### Rate limit on "Forgot password" (3 per hour per email)

The admin's email had one request from the table above; three more:

```console
HTTP/1.1 202 Accepted
HTTP/1.1 202 Accepted
HTTP/1.1 429 Too Many Requests  Retry-After-emailRequestEmail: 3600  Retry-After: 3600
```

### Database rows after part 1

```console
 id |       template       | status | staff | payload_cleared | no_token_in_bodies | redacted
----+----------------------+--------+-------+-----------------+--------------------+----------
  1 | staff.invite         | sent   |     2 | t               | t                  | t
  2 | staff.invite         | sent   |     2 | t               | t                  | t
  3 | staff.password_reset | sent   |     1 | t               | t                  | t
  4 | staff.password_reset | sent   |     1 | t               | t                  | t
  5 | staff.password_reset | sent   |     1 | t               | t                  | t

 id |       purpose        | staff_user_id | used | lifetime
----+----------------------+---------------+------+----------
  2 | staff_invite         |             2 | f    | 3 days
  5 | staff_password_reset |             1 | f    | 01:00:00

 id | actor_kind | actor |               action                | entity_id |                  metadata
----+------------+-------+-------------------------------------+-----------+---------------------------------------------
  1 | system     |       | staff_user.created                  |         1 | {"role": "admin", "status": "active"}
  3 | staff      |     1 | staff_user.invited                  |         2 | {"role": "box_office", "status": "invited"}
  4 | staff      |     1 | staff_user.invite_resent            |         2 | {}
  5 | system     |       | staff_user.password_reset_requested |         1 | {}
  6 | system     |       | staff_user.password_reset_requested |         1 | {}
  7 | system     |       | staff_user.password_reset_requested |         1 | {}
```

Each new token replaced the owner's previous unused one of its purpose (only the latest invite
and reset rows remain). `no_token_in_bodies` is `position('token=' in body_text || body_html) = 0`.

### Published document and logs

`GET /api/docs/openapi.json`: tags `Health`, `Admin: auth`, `Admin: staff`, `Admin: messages`.

| Operation | Security | Responses |
|---|---|---|
| `POST /admin/auth/password-reset-requests` (`requestPasswordReset`) | none | 202, 400, 413, 429, 500 |
| `POST /admin/auth/password-setups` (`setUpPassword`) | none | 204, 400, 403, 413, 429, 500 |
| `POST /admin/staff` (`inviteStaffMember`) | staff | 201, 400, 401, 403, 409, 413, 422, 429, 500; `Idempotency-Key` required |
| `POST /admin/staff/{id}/invitations` (`resendInvitation`) | staff | 201, 400, 401, 403, 404, 409, 413, 422, 429, 500; `Idempotency-Key` required |
| `GET /admin/messages` (`listMessages`) | staff | 200, 400, 401, 403, 429, 500 |
| `GET /admin/messages/{id}` (`getMessage`) | staff | 200, 400, 401, 403, 404, 429, 500 |

The app log (89 lines) has no line matching `maqady\.example`, `Hana` or `token=`.

## 2. The harness: real links from the inbox

Same database, the app stopped first, rate-limit counters reset by the restart.
`link <email>` reads the last `/admin/set-password?token=` link sent to that address from
`inbox.jsonl`.

### Invite, then set the password, then sign in

| # | Step | Status | Result |
|---|---|---|---|
| 21 | `POST /admin/staff` `{"fullName":"Karim Nabil","email":"karim@maqady.example","role":"box_office"}`, key | 201 | `{"id":4,…,"status":"invited",…}`; the inbox gets "You're invited to the Maqady dashboard" with `http://localhost:5173/admin/set-password?token=IA3D…` |
| 22 | `GET /admin/messages?limit=100` and every `GET /admin/messages/{id}` | 200 | the token occurs 0 times in the list and 0 times in the details; `token=` 0 times |
| 23 | `POST /admin/auth/password-setups` with the inbox token, `"password":"Karim2026"` | 204 | (no body) |
| 24 | the same token again | 400 | `INVALID_TOKEN` |
| 25 | `POST /admin/auth/sessions` Karim / `Karim2026` | 201 | `"staff":{"id":4,"fullName":"Karim Nabil",…,"role":"box_office"}` |
| 26 | Karim's token on `GET /admin/messages`, `GET /admin/messages/1`, `POST /admin/staff`, `POST /admin/staff/2/invitations` | 403 ×4 | `FORBIDDEN` |

### Resend voids the previous link

| # | Step | Status | Result |
|---|---|---|---|
| 27 | resend for Hana (#2) twice, new keys | 201, 201 | the inbox holds messages 7 and 8 for her |
| 28 | setup with message 7's token | 400 | `INVALID_TOKEN` |
| 29 | setup with message 8's token, `Hana2026x` | 204 | |
| 30 | Hana signs in / resend for her now | 201 / 409 | / `{"code":"NOT_INVITED","details":{"status":"active"}}` |

### Forgot password, end to end

| # | Step | Status | Result |
|---|---|---|---|
| 31 | `POST /admin/auth/password-reset-requests` `{"email":"karim@maqady.example"}` | 202 | the inbox gets "Reset your Maqady dashboard password" |
| 32 | setup with the reset token, `Karim2027` | 204 | |
| 33 | sign in with the old password `Karim2026` | 401 | `INVALID_CREDENTIALS` |
| 34 | sign in with `Karim2027` | 201 | |
| 35 | Karim's access token from #25 on `GET /admin/me` | 401 | `SESSION_REVOKED` |
| 36 | the reset token again | 400 | `INVALID_TOKEN` |

### No usable link anywhere but the inbox

```console
tokens in inbox: 4; total messages: 9
occurrences of any inbox token in list+details JSON: 0; 'token=': 0; redacted marker in details: 18
detail keys: attempts,bodyHtml,bodyText,channel,createdAt,id,lastErrorCode,nextAttemptAt,providerMessageId,recipient,related,sentAt,status,subject,template,updatedAt
```

```console
 id |       template       |      recipient       | status | staff | payload_cleared
----+----------------------+----------------------+--------+-------+-----------------
  6 | staff.invite         | karim@maqady.example | sent   |     4 | t
  7 | staff.invite         | hana@maqady.example  | sent   |     2 | t
  8 | staff.invite         | hana@maqady.example  | sent   |     2 | t
  9 | staff.password_reset | karim@maqady.example | sent   |     4 | t

 id | actor_kind | actor |               action                | entity_id |  changed_fields   |                  metadata
----+------------+-------+-------------------------------------+-----------+-------------------+-------------------------------------
  9 | staff      |     1 | staff_user.invited                  |         4 | {}                | {"role": "box_office", "status": "invited"}
 10 | staff      |     4 | staff_user.password_set             |         4 | {password,status} | {"purpose": "staff_invite"}
 12 | staff      |     1 | staff_user.invite_resent            |         2 | {}                | {}
 13 | staff      |     1 | staff_user.invite_resent            |         2 | {}                | {}
 14 | staff      |     2 | staff_user.password_set             |         2 | {password,status} | {"purpose": "staff_invite"}
 16 | system     |       | staff_user.password_reset_requested |         4 | {}                | {}
 17 | staff      |     4 | staff_user.password_set             |         4 | {password}        | {"purpose": "staff_password_reset"}

 staff_user_id | revoked_by_reset | live
---------------+------------------+------
             4 |                1 |    1
```

Karim's session from #25 was revoked with `password_changed`; the one from #34 is live. The
harness log has no line matching `maqady\.example`, `Karim`, `Hana` or `token=`.

## Not covered by hand

- Expiry after 72 hours and after 1 hour, two concurrent setups with one link, and a setup
  waiting on a deactivation in flight: they need a moved clock or held row locks, so the
  integration tests cover them (`test/integration/modules/staff/staff-onboarding.service.test.ts`).
- Delivery through Resend itself: the sandbox's proxy refuses `api.resend.com` (U3's QA); the
  harness stands in at the `EmailSender` boundary.

## Result

| Check | Result |
|---|---|
| Invite → email with the real link → set password → sign in | Pass |
| Stored subject and bodies, and the Message log, never hold a token; links read `[one-time link hidden]` | Pass |
| Resend voids the previous link; resend refused for active members (`NOT_INVITED`) | Pass |
| "Forgot password" always `202` with no body; only active members get an email | Pass |
| A reset link works once, replaces the password and revokes earlier sessions | Pass |
| Admin-only routes refuse a box-office token (`FORBIDDEN`) | Pass |
| Message log filters, pagination and validation | Pass |
| 4th reset request for one email in an hour is `429` with `Retry-After` | Pass |
| Audit rows for every staff write; no personal data in logs | Pass |
