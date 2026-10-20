---
title: U9 — Manual QA of customer accounts
owner: Mohamed Tarek
status: Done
last_verified: 2026-10-20
tags: [qa, customers, auth, sessions, refresh-tokens, email-verification, password-reset, profile, rate-limit]
---

# U9 — Manual QA of customer accounts

Issue #10, spec [`spec.md`](spec.md). QA mode: `curl`.

## Setup

- The built app (`npm run build`, `node dist/main.js`) on port 3109 against the unit's own
  database `maqady_u9_dev`, migrated at boot (migrations `0100_01` and `0100_02` applied).
  `EMAIL_DRIVER=simulated`; every rate limit at its production default (no `RATE_LIMIT_*` set).
- Customer data was emptied before the run; an admin was created with `npm run admin:create`
  (`node dist/cli/admin-create.js`) for the audience checks.
- Each section sends its own client address in `X-Forwarded-For`, so the per-address limits that
  sign-in, the two token routes and the password change share (`signInIp`, 20 per minute) stay
  within one section. An earlier run without this hit `RATE_LIMITED` on a sign-in after about 20
  such calls from one address, as designed.
- **QA-only helper.** The simulated sender records an email as sent and clears its encrypted
  payload, so the real one-time link can't be read back (by design, §13.1). To exercise the link
  routes, a scratchpad script (not committed) boots the app context and issues a fresh token
  through the real `OneTimeTokenService.issue()`, which voids the emailed one, exactly as a
  resend does. It also blocks a customer through `CustomerService.setStatus()` (U15 adds the
  admin route). That the emailed link itself works is proven by the integration suite with the
  recording sender (`customer-auth.controller.test.ts`).
- Output is trimmed: tokens shortened to six characters, correlation ids to eight, response
  headers dropped unless they matter.

## Registration: `POST /auth/registrations`

```
$ curl -X POST $B/auth/registrations -d '{"fullName":"  Layla Hassan ","email":" Layla.QA@Example.com ","password":"Cinema2026"}'
HTTP 201
{"accessToken":"eyJhbG…","accessTokenExpiresAt":"2026-10-20T22:28:05+03:00","refreshToken":"owBEeJ…",
 "refreshTokenExpiresAt":"2026-11-19T21:13:05+02:00",
 "customer":{"id":1,"fullName":"Layla Hassan","email":"Layla.QA@Example.com","phone":null,
   "emailVerified":false,"emailVerifiedAt":null,"memberSince":"2026-10-20T22:13:05+03:00"}}

$ (the same email in another case)
HTTP 409 {"error":{"code":"EMAIL_TAKEN","message":"An account with this email already exists.",…}}

$ (password "nodigits", and an extra "phone" field)
HTTP 400 VALIDATION_FAILED  phone: property phone should not exist
                            password: password must be 8 to 128 characters and include a digit
```

- Name and email trimmed; the session ends 30 days after sign-in (`+02:00` once Cairo leaves
  summer time by then).
- The verification email was queued in the same transaction and sent after commit; the stored
  copy holds the redacted link only:

```
 id |       template        |      recipient       | status | customer | payload_cleared | redacted | has_token
  1 | customer.verify_email | Layla.QA@Example.com | sent   |        1 | t               | t        | f
 id |        email         |  full_name   | phone | status | verified | signed_in | deleted_at
  1 | Layla.QA@Example.com | Layla Hassan |       | active | f        | t         |
```

## Email verification and resend

```
$ curl -X POST $B/auth/email-verifications -d '{"token":"At600_…"}'          (issued by the helper)
HTTP 204
$ (the same token again)
HTTP 400 {"error":{"code":"INVALID_TOKEN","message":"This link is invalid or has expired.",…}}
$ curl -X POST $B/auth/email-verifications -d '{"token":"made-up"}'
HTTP 400 INVALID_TOKEN
$ curl $B/me -H "Authorization: Bearer <access>"
HTTP 200 {"id":1,…,"emailVerified":true,"emailVerifiedAt":"2026-10-20T22:13:07+03:00",…}
$ curl -X POST $B/auth/email-verification-requests -H "Authorization: Bearer <access>"   (verified)
HTTP 202   (no body; still one customer.verify_email message for customer 1: nothing sent)
```

For an unverified customer (Omar, id 3), resend answers `202` and queues a second
`customer.verify_email`; only the newest link is live:

```
 id |       template        | customer | status        id |   purpose    | used
  2 | customer.verify_email |        3 | sent           4 | verify_email | f
  3 | customer.verify_email |        3 | sent
```

## Sign-in: `POST /auth/sessions`

```
$ curl -X POST $B/auth/sessions -d '{"email":"LAYLA.QA@example.com","password":"Cinema2026"}'
HTTP 201 {"accessToken":"eyJhbG…",…,"customer":{"id":1,…,"emailVerified":true,…}}
$ (wrong password)                 HTTP 401 INVALID_CREDENTIALS "The email or password is incorrect."
$ (unknown email)                  HTTP 401 INVALID_CREDENTIALS (same answer)
```

## Refresh: `POST /auth/tokens`

```
$ curl -X POST $B/auth/tokens -d '{"refreshToken":"zXdvwf…"}'
HTTP 201 {"accessToken":"eyJhbG…","refreshToken":"ZB48zs…","refreshTokenExpiresAt":"2026-11-19T21:09:25+02:00",…}
$ (the same old token again, within 30 s)
HTTP 409 {"error":{"code":"REFRESH_CONFLICT","message":"These tokens were just refreshed elsewhere.",…}}
$ (sleep 31) the old token again
HTTP 401 SESSION_REVOKED "You were signed out. Sign in again."
$ curl $B/me -H "Authorization: Bearer <access of that family>"
HTTP 401 SESSION_REVOKED
$ curl -X POST $B/auth/tokens -d '{"refreshToken":"not-a-token"}'
HTTP 400 VALIDATION_FAILED  refreshToken must be a refresh token as issued
```

`refreshTokenExpiresAt` kept the sign-in's end. The refreshed family (rows 2 and 5) was revoked
as a whole; the customer's other sessions (rows 1 and 4) stayed live:

```
 id | refreshed_family | rotated | replaced_by_id | revoked_reason
  1 | f                | f       |                |
  2 | t                | t       |              5 | refresh_reuse
  4 | f                | f       |                |
  5 | t                | f       |                | refresh_reuse
```

## Audiences

```
$ curl $B/me -H "Authorization: Bearer <staff admin access>"         HTTP 401 UNAUTHENTICATED
$ curl -X POST $B/auth/tokens -d '{"refreshToken":"<staff refresh>"}' HTTP 401 UNAUTHENTICATED
$ curl $B/admin/me -H "Authorization: Bearer <customer access>"      HTTP 401 UNAUTHENTICATED
$ curl $B/admin/staff -H "Authorization: Bearer <customer access>"   HTTP 401 UNAUTHENTICATED
```

## Profile: `GET /me`, `PATCH /me`

```
$ curl -X PATCH $B/me -H "Idempotency-Key: 8d0c3c1e-…" -d '{"fullName":"  Omar F. ","phone":"01012345678"}'
HTTP 200 {"id":3,"fullName":"Omar F.","email":"omar.qa@example.com","phone":"+201012345678",…}
$ (the same request and key again)
HTTP/1.1 200 OK   Idempotent-Replayed: true
$ curl -X PATCH $B/me -d '{"phone":null}'
HTTP 200 {…,"phone":null,…}
$ curl -X PATCH $B/me -d '{"email":"new@example.com"}'
HTTP 400 VALIDATION_FAILED  email: property email should not exist
                            fullName: send fullName, phone or both
$ curl -X PATCH $B/me -d '{"phone":"0101234567"}'
HTTP 400 VALIDATION_FAILED  phone: phone must be an international number such as +201012345678, or an Egyptian mobile such as 01012345678
$ curl -X PATCH $B/me -d '{}'
HTTP 400 VALIDATION_FAILED  fullName: send fullName, phone or both
```

The first QA run showed four messages under `fullName` for the email-only body (the empty-body
rule shared the name's validators); fixed in `fix(customers): give PATCH /me one message per name
problem`, with tests, before this run.

## Password change: `PUT /me/password`

```
$ curl -X PUT $B/me/password -d '{"currentPassword":"Wrong-pass1","newPassword":"NewCinema2026"}'
HTTP 400 VALIDATION_FAILED  currentPassword: currentPassword is not correct
$ curl -X PUT $B/me/password -d '{"currentPassword":"Cinema2026","newPassword":"weak"}'
HTTP 400 VALIDATION_FAILED  newPassword: password must be 8 to 128 characters and include a digit
$ curl -X PUT $B/me/password -d '{"currentPassword":"Cinema2026","newPassword":"NewCinema2026"}'
HTTP 204
$ curl $B/me -H "Authorization: Bearer <this device>"     HTTP 200
$ curl $B/me -H "Authorization: Bearer <other device>"    HTTP 401 SESSION_REVOKED
$ (sign in with the old password)                          HTTP 401 INVALID_CREDENTIALS
 id |  revoked_reason
  3 |                      (this device, kept)
  7 | password_changed     (the other device)
```

## Forgot and reset password

```
$ curl -X POST $B/auth/password-reset-requests -d '{"email":"nobody@example.com"}'       HTTP 202 (empty)
$ curl -X POST $B/auth/password-reset-requests -d '{"email":"blocked.qa@example.com"}'   HTTP 202 (empty)
$ curl -X POST $B/auth/password-reset-requests -d '{"email":"NOUR.qa@example.com"}'      HTTP 202 (empty)
 id |        template         | customer | status | redacted | has_token
  6 | customer.password_reset |        4 | sent   | t        | f
```

Only the active customer (Nour, id 4) got a message; the unknown and the blocked email got the
same answer and nothing else.

```
$ curl -X POST $B/auth/password-resets -d '{"token":"Rs6vK5…","password":"weakpassword"}'   (issued by the helper)
HTTP 400 VALIDATION_FAILED  password: password must be 8 to 128 characters and include a digit
$ curl -X POST $B/auth/password-resets -d '{"token":"Rs6vK5…","password":"NewCinema2026"}'
HTTP 204                        (the weak attempt did not spend the link)
$ (the same token again)        HTTP 400 INVALID_TOKEN
$ curl $B/me -H "Authorization: Bearer <Nour's registration token>"   HTTP 401 SESSION_REVOKED
$ (sign in with the old password)   HTTP 401 INVALID_CREDENTIALS
$ (sign in with the new password)   HTTP 201 {…,"customer":{"id":4,…,"emailVerified":true,…}}
```

## Blocked customer

The customer (id 5) was blocked through `CustomerService.setStatus()` by the helper.

```
$ curl -X POST $B/auth/password-resets -d '{"token":"7ibdgD…","password":"NewCinema2026"}'
HTTP 403 ACCOUNT_BLOCKED
$ (sign in, wrong password)          HTTP 401 INVALID_CREDENTIALS
$ (sign in, right password)          HTTP 403 ACCOUNT_BLOCKED
$ curl $B/me -H "Authorization: Bearer <token from before the block>"   HTTP 403 ACCOUNT_BLOCKED
 actor_kind |         action          | entity_type | entity_id | changed_fields |       metadata
 system     | customer.status_changed | customer    |         5 | {status}       | {"status": "blocked"}
```

## Sign-out: `DELETE /auth/sessions/current`

```
$ curl -X DELETE $B/auth/sessions/current -H "Authorization: Bearer <access>"   HTTP 204
$ curl $B/me -H "Authorization: Bearer <same access>"                          HTTP 401 SESSION_REVOKED
$ curl -X POST $B/auth/tokens -d '{"refreshToken":"<same session>"}'           HTTP 401 SESSION_REVOKED
$ curl -X DELETE $B/auth/sessions/current                                      HTTP 401 UNAUTHENTICATED
```

## Rate limits (production defaults)

Resend, for a customer who had already resent once in this run (3 per hour per customer):

```
resend 1: HTTP 202
resend 2: HTTP 202
resend 3: HTTP 429
HTTP/1.1 429 Too Many Requests
Retry-After-verificationResendCustomer: 3600
Retry-After: 3600
```

Registration from one address (5 per hour):

```
registration 1–5: HTTP 201
$ (the 6th)  HTTP 429 {"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again shortly.",…}}
```

## Logs

The app log of the run (141 lines, 68 request lines) holds no email, name, phone, password or
token: a search for the run's emails, names, passwords, `+2010`, `"token"` and `refreshToken`
matched only route paths (`/api/v1/me/password`, `/api/v1/auth/password-…`). Request lines carry
`principalKind` and `principalId` only.

## Result

| Check | Result |
|---|---|
| Registration signs in, trims, refuses a taken email in any case and a weak password | Pass |
| Verification email stored redacted, sent after commit, payload cleared | Pass |
| Verification works once; a used or made-up link is `INVALID_TOKEN`; resend sends nothing once verified | Pass |
| Sign-in: success, `INVALID_CREDENTIALS` for wrong password and unknown email alike | Pass |
| Refresh rotation keeps the session end; `REFRESH_CONFLICT` within 30 s; reuse after revokes the family only | Pass |
| A staff token can't reach customer routes or refresh here; a customer token can't reach admin routes | Pass |
| `PATCH /me`: trimmed name, local phone stored as E.164, `null` clears, replay with the same key, email refused | Pass |
| Password change: wrong current on its field, keeps this device, signs out the others | Pass |
| Forgot: always `202`, sends only to an active customer, stored redacted | Pass |
| Reset: weak password keeps the link, works once, verifies the email, signs out everywhere, opens no session | Pass |
| Blocked: reset and right-password sign-in `ACCOUNT_BLOCKED`, old token `ACCOUNT_BLOCKED`, audited | Pass |
| Sign-out ends the session's access and refresh tokens | Pass |
| Resend and registration limits answer `429` with `Retry-After` | Pass |
| No personal data in logs | Pass |

The app was stopped after QA and the dev database's customer data emptied. Nothing is left
running on port 3109.
