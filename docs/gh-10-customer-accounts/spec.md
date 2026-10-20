---
title: U9 — Customer accounts - register, sign-in, refresh, verify email, reset password, profile
owner: Mohamed Tarek
status: Approved
last_verified: 2026-10-20
tags: [customers, auth, sessions, refresh-tokens, email-verification, password-reset, profile, rate-limit]
---

# U9 — Customer accounts: register, sign-in, refresh, verify email, reset password, profile

Issue: #10. Docs folder: `docs/gh-10-customer-accounts/`. Migration prefix `0100`. Depends on
U2a (`sessions`, `one_time_tokens`, `CredentialsModule`, the staff test helpers) and U3
(`messages`, `MessagingService`, `MessageTemplateRegistry`). It does **not** depend on U2b.
Design: `docs/system-design.md` §5, §6.1, §6.2 (`customers`), §10 (all), §11 (customer auth and
`/me`), §13.1, §14; PRD v2 "Accounts", C7, C12, "New customer screens", "Email and SMS",
"Frontend integration contract".

## Goal

A visitor creates an account with name, email and password and is signed in at once; a
verification email (24-hour link) is queued in the same transaction. Customers sign in, stay
signed in through refresh rotation, sign out, verify their email, reset a forgotten password with
a 1-hour single-use link, and read and edit their profile and password. Every customer-audience
request is checked against the database, so blocking, sign-out and a password reset take effect
on the next request. Customer and staff tokens never open each other's routes.

## Scope

- Migrations: `customers`; foreign keys from `sessions`, `one_time_tokens`, `messages` and
  `audit_events` to `customers` (U1, U2a and U3 left the covering indexes for them).
- `src/modules/customers/` (`CustomersModule`): repository, `CustomerService` (exported),
  `CustomerAuthService`, `CustomerProfileService`, `CustomerPrincipalResolver` (registered for the
  `customer` audience), two templates and their registrar, two controllers.
- Routes: `POST /auth/registrations`, `POST /auth/sessions`, `POST /auth/tokens`,
  `DELETE /auth/sessions/current`, `POST /auth/email-verifications`,
  `POST /auth/email-verification-requests`, `POST /auth/password-reset-requests`,
  `POST /auth/password-resets`, `GET /me`, `PATCH /me`, `PUT /me/password`.
- Templates `customer.verify_email` and `customer.password_reset` in U3's registry.
- One new named rate limit, `verificationResendCustomer` (see Decisions).
- One additive option on U2a's `SessionService.revokeAllFor()`: keep the caller's own family.
- `test/support/customer-auth.ts` for later units (U10–U12, U15).

## Out of scope

- Claiming a guest hold after sign-in or registration: U10's `POST /holds/{ref}/claims`
  (design §7.3). Sign-in and registration take no hold code. **Follow-up for U10**: its
  integration test signs in through `POST /auth/sessions` (or registers through
  `POST /auth/registrations`) and then claims, proving these tokens work there.
- `GET /me/bookings` and the Profile "booking count" (U12, once `bookings` exists).
- Admin customer routes: list, detail, edit, the block and unblock route, anonymisation, the
  admin "send a reset email" route (U15). U9 exports the service methods U15 calls
  (`setStatus`, `issuePasswordReset`).
- Changing the email address (PRD C12: email is read-only).
- Social or phone sign-in (PRD non-goals).

## Decisions on the open questions

| Question | Decision | Why |
|---|---|---|
| Phone format | Accept E.164 (`+201012345678`, any country) **and** an Egyptian local mobile number (`01012345678`: `01`, then `0`, `1`, `2` or `5`, then 8 digits), which is normalised to `+20…`. Only E.164 is stored and returned. | Cairo customers type the local form; storing E.164 keeps every stored phone sendable by U3's SMS check (`^\+[1-9]\d{7,14}$`). Normalising once on the server spares every client the rule. |
| Customer session lifetime | Absolute: 30 days from sign-in, never extended by a refresh. | Design §10.2 states it and U2a built it: a stolen refresh token can't be kept alive by refreshing. A daily customer signs in again once a month. |
| Activity log for customer self-service | No audit rows for registration, sign-in, sign-out, verification, profile edits, password change or reset. `customer.status_changed` (a staff or system actor) is audited, and U2a's `session.reuse_detected` still is. | Design §13.5 audits staff writes and customer booking events only; the Activity log is a staff tool filtered by staff member. A security log of customer actions would be a new feature; recorded as a follow-up question for the product owner. |
| Password change and other devices | Keeps the caller's own session family and revokes every other one (`password_changed`). | Signing out the device in use would be hostile; the other devices may be an attacker's. |
| Password reset | Marks the email verified when it wasn't, revokes every session, and does **not** open a session: the customer signs in next. | The link proved control of the mailbox. "Set a new password, then sign in" is the flow staff get too (U2b), and it keeps the reset route free of credentials. |
| Profile booking count (PRD C12) | Deferred to U12, which adds `bookingCount` to `GET /me`. Recommended definition: Confirmed and Completed bookings (paid, not refunded), matching the dashboard's "Tickets sold" and the drawer's "Spent". | `bookings` does not exist yet. |

## Other decisions

| Decision | Why |
|---|---|
| Registration signs the customer in: `201` with tokens and the profile | PRD C7: "Success claims the hold and goes to Checkout", which needs a token. |
| Registration inserts with `INSERT … ON CONFLICT (email) WHERE deleted_at IS NULL DO NOTHING RETURNING …`; no row → `409 EMAIL_TAKEN` | §10.5; a taken email never raises `23505` inside the request transaction. A blocked account's email is also taken; an anonymised one's is free again. |
| Email is stored trimmed as typed; `CITEXT` makes every lookup and the unique index case-insensitive | §6.2. |
| Sign-in: an unknown or anonymised email runs `PasswordService.verify(password, null)` (dummy scrypt) and answers `INVALID_CREDENTIALS`; `ACCOUNT_BLOCKED` only after the password matched | Same as U2a: neither timing nor answer reveals the account or its state to a wrong password. |
| Sign-in records itself with an update that matches only a live, active customer whose `password_hash` is still the one the password was checked against, before it opens the session | As U2a for staff: the update waits for a block, password change or reset in flight and is refused by it, so no session escapes their revocation. A changed hash answers `INVALID_CREDENTIALS`, a block alone `ACCOUNT_BLOCKED` (review R1). |
| Unverified customers can do everything | PRD Accounts 2: "Verification blocks nothing". |
| Resolver order: no row, another customer's session, or `deleted_at` set → `null` (`UNAUTHENTICATED`); `status = 'blocked'` → `ACCOUNT_BLOCKED`; session revoked → `SESSION_REVOKED`; `expires_at <= now` → `SESSION_EXPIRED` | Blocking also revokes the sessions; checking status first gives the PRD's "Account blocked" screen instead of a generic sign-out. Mirrors U2a. |
| Guest and customer routes document `SESSION_EXPIRED` among their access errors | The customer resolver answers it in the last 15 minutes of a session; U2a left this documentation change to U9. |
| `POST /auth/tokens` is `@NoRequestTransaction()` + `@NoIdempotencyStorage()`; `SessionService.refresh()` runs its own transactions | U2a's decision: a `SESSION_REVOKED` after reuse must commit the family revocation. |
| A staff refresh token at `/auth/tokens` (or a customer one at `/admin/auth/tokens`) answers `401 UNAUTHENTICATED` | Audiences never mix (§10.1). U2a's `SessionService.refresh({ audience })` already treats the other audience's row as unknown; U9 tests it through both routes. |
| Refresh's owner check: missing or anonymised → `UNAUTHENTICATED`; blocked → `ACCOUNT_BLOCKED` | Same rule as the resolver. `SessionService.refresh()` runs the owner check before the session's own checks (U2a second review round), so a blocked customer, whose family the block revoked, gets `ACCOUNT_BLOCKED`, not `SESSION_REVOKED`. |
| Blocking (`CustomerService.setStatus(…, 'blocked')`) revokes every live session (`account_blocked`) in the same transaction | §10.2, PRD Accounts 5. Built here because the tests need it; U15 calls it from its admin route. |
| Email verification consumes `verify_email`, sets `email_verified_at = now` only when NULL, answers `204`; it works for blocked customers too | It records a fact about the address. Anonymised customers have no tokens (U15 deletes them), so their links are `INVALID_TOKEN`. |
| Resend verification answers `202` with no body; an already verified customer gets nothing sent | Idempotent and simple; the frontend offers the link only while unverified. |
| Resend is limited by a new named limit `verificationResendCustomer` (3/1h, key `customer`, `RATE_LIMIT_VERIFICATION_RESEND_CUSTOMER`) plus `emailRequestIp` | The route has no `body.email`, so U1's `emailRequestEmail` would put every customer in one bucket (the hash of `''`). A customer's email is fixed, so per customer equals §10.6's "per email". §10.6 updated. |
| Forgot password always answers `202` with no body; it sends only to live, active customers | §10.5, PRD "If an account exists…". A blocked customer can't use a reset link. |
| Forgot password uses `@RateLimit('emailRequestEmail', 'emailRequestIp')`, sharing one count with the staff route (U2b) | §10.6: "a named limit shares one count across those routes". |
| Password reset consumes `customer_password_reset`; the customer must be live and active, else `403 ACCOUNT_BLOCKED` (the throw rolls back the request transaction, so the token is not spent) | A blocked customer must not regain access through a reset. |
| Token fields are validated only as strings of 1–128 characters; anything matching no live hash is `400 INVALID_TOKEN` | A mangled link shows "invalid or expired", like an old one (as U2b). |
| The password policy (`@IsAllowedPassword()`) is checked by the DTO before any token is touched | A weak password never spends a token. |
| `PUT /me/password` with a wrong `currentPassword` answers `400 VALIDATION_FAILED` with `details.fields = [{ field: 'currentPassword', messages: ['currentPassword is not correct'] }]` | A `401` on a signed-in route would trip a frontend's "session ended" handling; the form shows it under the field. |
| `POST /auth/email-verifications`, `POST /auth/password-resets` and `PUT /me/password` are limited by `signInIp` | A stolen access token must not allow fast guessing of the current password; the token routes get the same cheap guard. §10.6 updated. |
| Auth and password routes are `@NoIdempotencyStorage()`; `PATCH /me` takes an optional key, stored (not strict); `GET`s have none | §10.2, §11 (no "S" on any customer route here). A repeated registration answers `EMAIL_TAKEN`, a repeated sign-in opens a second session. |
| Token responses answer `201`; sign-out, verification, reset and password change `204`; the two request routes `202` | Same as U2a. |
| Times in responses use `formatCairoIso()` | §11. |
| U9 writes its own `customerLinkToken(text, path)` test helper | U9 does not depend on U2b and may merge first. Follow-up: fold it together with U2b's helper once both are merged. |

## Modules and files

**`src/modules/customers/`** — `CustomersModule` imports `CredentialsModule` (U2a) and exports
`CustomerService`. Messaging, audit, auth and the clock come from the global U1 and U3 modules.

| File | Holds |
|---|---|
| `enums.ts` | `CUSTOMER_STATUSES = ['active', 'blocked']` |
| `types.ts` | `CustomerStatus`, `CustomerRow`, `NewCustomerRow`, `CustomerProfileUpdate`, `CustomerRowChanges`, `CustomerPrincipalRow`, `Customer`, `RegisterCustomerInput`, `CustomerSignInInput`, `CustomerTokens`, `CustomerSession`, `ProfileChanges`, `ChangePasswordInput`, `ResetPasswordInput`, `CustomerVerifyEmailParams`, `CustomerPasswordResetParams` |
| `customers.constants.ts` | `CUSTOMER_FULL_NAME_MAX_LENGTH`, `EMAIL_MAX_LENGTH`, `SIGN_IN_PASSWORD_MAX_LENGTH`, `ONE_TIME_TOKEN_MAX_LENGTH`, `E164_PHONE_PATTERN`, `EGYPT_LOCAL_MOBILE_PATTERN`, `EGYPT_COUNTRY_CODE`, `ACCEPTED_PHONE_PATTERN_SOURCE` (the published `phone` pattern), `VERIFY_EMAIL_PATH`, `RESET_PASSWORD_PATH`, `CURRENT_PASSWORD_WRONG_MESSAGE` |
| `customers.repository.ts` | `insertIfEmailFree`, `findById`, `findByIdForUpdate`, `findLiveByEmail`, `findPrincipalBySession`, `recordSignIn`, `updateProfile`, `setPasswordHash`, `markEmailVerified`, `setStatus`; named columns, through `TransactionContext.executor()` |
| `customer.mapper.ts` | `toCustomer(row)` |
| `customer.service.ts` | `CustomerService` (exported) |
| `customer-auth.service.ts` | `CustomerAuthService`: register, sign-in, refresh, sign-out, verification and its resend, forgot and reset |
| `customer-profile.service.ts` | `CustomerProfileService`: `/me` and the password change |
| `customer-principal.resolver.ts` | `CustomerPrincipalResolver` (`onModuleInit` → `registry.register('customer', this)`) |
| `templates/customer-verify-email.template.ts` | `customerVerifyEmailTemplate` |
| `templates/customer-password-reset.template.ts` | `customerPasswordResetTemplate` |
| `templates/customer-templates.registrar.ts` | `CustomerTemplatesRegistrar` (`onModuleInit` registers both) |
| `customer-auth.controller.ts` | `@Controller('auth')`, `@ApiTags('Auth')` |
| `me.controller.ts` | `@Controller('me')`, `@ApiTags('Profile')` |
| `dto/transforms.ts` | `TrimString()`, `NormalisePhone()` (class-transformer decorators) |
| `dto/register-customer.request.ts`, `dto/customer-sign-in.request.ts`, `dto/email-verification.request.ts`, `dto/forgot-password.request.ts`, `dto/reset-password.request.ts`, `dto/update-profile.request.ts`, `dto/change-password.request.ts` | request DTOs |
| `dto/customer-profile.response.ts`, `dto/customer-session.response.ts` | response DTOs |
| `customers.module.ts` | the module |

Also changed:

- `src/common/rate-limit/enums.ts`, `rate-limit.constants.ts`,
  `src/common/config/environment-variables.ts`: `verificationResendCustomer`. `.env.example`
  and README list it.
- `src/modules/auth/session.service.ts`, `sessions.repository.ts`, `types.ts` (U2a): optional
  `{ exceptSessionId }` on `revokeAllFor`, excluding that session's family.
- `src/common/swagger/swagger.constants.ts`: tags `Auth` and `Profile`.
- `src/common/swagger/cross-cutting-docs.ts`: `SESSION_EXPIRED` on guest and customer routes.
- `src/app.module.ts`: imports `CustomersModule` after `StaffModule`.
- `test/support/foundations-probe.module.ts`: `REAL_RESOLVERS_OFF` also switches off
  `CustomerPrincipalResolver`.
- Integration tests of U1, U2a and U3 that wrote made-up customer ids into `sessions`,
  `one_time_tokens`, `messages` and `audit_events` now create a real customer first (the new
  foreign keys refuse made-up ids). Their assertions are unchanged.

## Migrations (prefix `0100`)

No defaults; every time comes from the `Clock`. Row-level security on.

**`0100_01_create_customers`**

```sql
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  email CITEXT NULL,
  full_name VARCHAR(100) NULL,
  phone VARCHAR(16) NULL,
  password_hash TEXT NULL,
  status VARCHAR(16) NOT NULL,
  email_verified_at TIMESTAMPTZ NULL,
  last_sign_in_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_customers_status CHECK (status IN ('active', 'blocked')),
  CONSTRAINT chk_customers_email CHECK (length(email) <= 320 AND email ~ '^[^\s@]+@[^\s@]+$'),
  CONSTRAINT chk_customers_full_name CHECK (btrim(full_name) <> ''),
  CONSTRAINT chk_customers_phone CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT chk_customers_password_hash CHECK (password_hash ~ '^scrypt[$]…$'),
  CONSTRAINT chk_customers_live_or_anonymised CHECK (
    (deleted_at IS NULL AND email IS NOT NULL AND full_name IS NOT NULL AND password_hash IS NOT NULL)
    OR (deleted_at IS NOT NULL AND email IS NULL AND full_name IS NULL AND phone IS NULL
        AND password_hash IS NULL)),
  CONSTRAINT chk_customers_updated_at CHECK (updated_at >= created_at)
);
```

| Index | Columns | Query it serves (index comment) |
|---|---|---|
| `uq_customers_email_live` | UNIQUE `(email) WHERE deleted_at IS NULL` | Registration `ON CONFLICT (email) WHERE deleted_at IS NULL`; sign-in and forgot-password lookup `WHERE email = ? AND deleted_at IS NULL` |

The resolver and every `/me` read go by primary key. U15 adds the admin list and search indexes.

**`0100_02_add_customer_foreign_keys`**: `fk_sessions_customer_id`,
`fk_one_time_tokens_customer_id`, `fk_messages_related_customer_id`,
`fk_audit_events_actor_customer_id`, each `REFERENCES customers (id)`. Already covered by
`idx_sessions_customer_id` (U2a), `idx_one_time_tokens_customer_id_purpose` (U2a),
`idx_messages_related_customer_id` (U3) and `idx_audit_events_actor_customer_id` (U1). No
`ON DELETE`: customers are anonymised, never deleted.

## Behaviour

**Register** (`CustomerAuthService.register`, request transaction): hash the password;
`insertIfEmailFree({ email, full_name, phone: null, password_hash, status: 'active',
last_sign_in_at = created_at = updated_at = now })`, `null` → `EMAIL_TAKEN`; issue a
`verify_email` token (24 h); queue `customer.verify_email` (`related.customerId`); open a
30-day session; sign the access token. Answers tokens and profile.

**Sign-in**: `findLiveByEmail` → `verify(password, row?.password_hash ?? null)`; no row or false
→ `INVALID_CREDENTIALS`; `blocked` → `ACCOUNT_BLOCKED`; `recordSignIn` (matches only a live,
active row with the checked hash) → none → re-read: the hash changed → `INVALID_CREDENTIALS`,
else `ACCOUNT_BLOCKED`; open the session; sign.

**Refresh**: `SessionService.refresh({ audience: 'customer', refreshToken, assertOwnerLive })`,
then sign a new access token. Unknown → `UNAUTHENTICATED`, blocked → `ACCOUNT_BLOCKED` (checked
first), revoked → `SESSION_REVOKED`,
expired → `SESSION_EXPIRED`, within 30 s of rotation → `REFRESH_CONFLICT`, later reuse → family
revoked, `SESSION_REVOKED`.

**Sign-out**: `SessionService.revokeFamilyOf(principal.sessionId, 'sign_out')`.

**Principal resolver**: one query by the session's primary key,
`SELECT s.customer_id, s.revoked_at, s.expires_at, c.status, c.deleted_at FROM sessions s JOIN
customers c ON c.id = s.customer_id WHERE s.id = :sid`, then the order in Decisions.

**Verify email**: consume `verify_email` → `markEmailVerified(id, now)` (only when NULL, only a
live row).

**Resend verification**: lock the customer; verified → nothing; else issue and queue as at
registration (the earlier link stops working).

**Forgot password** (`requestPasswordReset(email)`): `findLiveByEmail`; when `active`,
`CustomerService.issuePasswordReset(id)` (issue `customer_password_reset`, 1 hour, and queue
`customer.password_reset`). Otherwise nothing.

**Reset password**: consume `customer_password_reset`; lock the customer; anonymised →
`INVALID_TOKEN`, blocked → `ACCOUNT_BLOCKED`; set the hash; mark the email verified; revoke every
session (`password_changed`).

**Profile**: `get(principal)`; `update(principal, changes)` writes only the fields that differ
(`updated_at = now`), a no-op writes nothing; `changePassword(principal, { currentPassword,
newPassword })`: lock, verify (false → `VALIDATION_FAILED` on `currentPassword`), set the hash,
`revokeAllFor(owner, 'password_changed', { exceptSessionId: principal.sessionId })`.

**Set status** (`CustomerService.setStatus(actor, id, status)`): lock; missing or anonymised →
`NOT_FOUND`; same status → unchanged; else update; `blocked` → revoke every session
(`account_blocked`); audit `customer.status_changed` (`changedFields ['status']`,
`metadata { status }`).

**Templates** (English, `renderSimpleHtml`, `secretParams: ['token']`, link always
`links.oneTime(path, token)`):

| Name | Subject | Body |
|---|---|---|
| `customer.verify_email` | `Confirm your email for Maqady` | "Hello {fullName}, welcome to Maqady. Please confirm your email address. This link works for 24 hours." Action "Confirm email" → `/verify-email?token=`. "If you didn't create an account, ignore this email." |
| `customer.password_reset` | `Reset your Maqady password` | "Hello {fullName}, we received a request to reset your password. This link works once, for 1 hour." Action "Set a new password" → `/reset-password?token=`. "If you didn't ask, ignore this email; your password stays the same." |

**Logging.** Nothing in this unit logs; the request line carries the principal kind and id only.
No email, name, phone, password or token appears in any log line (tested).

## Endpoints

All under `/api/v1`. Every operation has a summary, a description and `@ApiErrorResponses(...)`;
U1 adds the access, idempotency, `413` and `429` errors from the declarations. Every route also
has U1's default limit. No new error codes.

| Route | Access | Limits | Idempotency | Request | Response | Errors |
|---|---|---|---|---|---|---|
| `POST /auth/registrations` | `@Public()` | `registrationIp` | `@NoIdempotencyStorage()` | `RegisterCustomerRequest` | `201 CustomerSessionResponse` | `VALIDATION_FAILED`, `EMAIL_TAKEN` |
| `POST /auth/sessions` | `@Public()` | `signInEmail`, `signInIp` | `@NoIdempotencyStorage()` | `CustomerSignInRequest` | `201 CustomerSessionResponse` | `VALIDATION_FAILED`, `INVALID_CREDENTIALS`, `ACCOUNT_BLOCKED` |
| `POST /auth/tokens` | `@Public()` | — | `@NoRequestTransaction()`, `@NoIdempotencyStorage()` | `RefreshTokensRequest` (U2a) | `201 SessionTokensResponse` (U2a) | `VALIDATION_FAILED`, `UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `REFRESH_CONFLICT`, `ACCOUNT_BLOCKED` |
| `DELETE /auth/sessions/current` | `@Customer()` | — | `@NoIdempotencyStorage()` | — | `204` | access errors |
| `POST /auth/email-verifications` | `@Public()` | `signInIp` | `@NoIdempotencyStorage()` | `EmailVerificationRequest` | `204` | `VALIDATION_FAILED`, `INVALID_TOKEN` |
| `POST /auth/email-verification-requests` | `@Customer()` | `verificationResendCustomer`, `emailRequestIp` | `@NoIdempotencyStorage()` | — | `202`, no body | access errors |
| `POST /auth/password-reset-requests` | `@Public()` | `emailRequestEmail`, `emailRequestIp` | `@NoIdempotencyStorage()` | `ForgotPasswordRequest` | `202`, no body | `VALIDATION_FAILED` |
| `POST /auth/password-resets` | `@Public()` | `signInIp` | `@NoIdempotencyStorage()` | `ResetPasswordRequest` | `204` | `VALIDATION_FAILED`, `INVALID_TOKEN`, `ACCOUNT_BLOCKED` |
| `GET /me` | `@Customer()` | — | — | — | `200 CustomerProfileResponse` | access errors |
| `PATCH /me` | `@Customer()` | — | optional key, stored | `UpdateProfileRequest` | `200 CustomerProfileResponse` | `VALIDATION_FAILED` |
| `PUT /me/password` | `@Customer()` | `signInIp` | `@NoIdempotencyStorage()` | `ChangePasswordRequest` | `204` | `VALIDATION_FAILED` |

"Access errors" for `@Customer()` are `UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED`
and `ACCOUNT_BLOCKED`.

**DTOs**

- `RegisterCustomerRequest`: `fullName` (trimmed, 1–100, no NUL), `email` (trimmed, `IsEmail`,
  ≤ 320, and the stored shape `^[^\s@]+@[^\s@]+$`, so a quoted local part is refused),
  `password` (`@IsAllowedPassword()`).
- `CustomerSignInRequest`: `email` (`IsEmail`, ≤ 320), `password` (string, 1–128; the policy is
  not applied at sign-in).
- `EmailVerificationRequest`: `token` (string, 1–128).
- `ForgotPasswordRequest`: `email` (`IsEmail`, ≤ 320).
- `ResetPasswordRequest`: `token` (string, 1–128), `password` (`@IsAllowedPassword()`).
- `UpdateProfileRequest`: optional `fullName` (trimmed, 1–100, no NUL, one message per problem); optional
  `phone` (E.164 or an Egyptian local mobile, normalised to E.164; `null` clears it); at least one
  present, else `VALIDATION_FAILED` with `send fullName, phone or both` on `fullName`. `email` or any other field → `VALIDATION_FAILED` (`forbidNonWhitelisted`).
- `ChangePasswordRequest`: `currentPassword` (string, 1–128), `newPassword`
  (`@IsAllowedPassword()`).
- `CustomerProfileResponse`: `id`, `fullName`, `email`, `phone` (nullable), `emailVerified`,
  `emailVerifiedAt` (nullable), `memberSince`.
- `CustomerSessionResponse`: U2a's `SessionTokensResponse` fields plus
  `customer: CustomerProfileResponse`.

## Services

**Exported by `CustomersModule`** (for U10–U12, U15, U18):

```ts
class CustomerService {
  findById(id: number): Promise<Customer | null>;          // live or anonymised
  findByIdForUpdate(id: number): Promise<Customer | null>; // locks the row (FOR NO KEY UPDATE)
  setStatus(actor: AuditActor, id: number, status: CustomerStatus): Promise<Customer>;
  //   NOT_FOUND for missing or anonymised; 'blocked' revokes every session (account_blocked)
  issuePasswordReset(customerId: number): Promise<void>;
  //   NOT_FOUND for missing or anonymised; issues the 1-hour link and queues the email
}
// Customer = { id; email: string | null; fullName: string | null; phone: string | null;
//   status: CustomerStatus; emailVerifiedAt: Date | null; lastSignInAt: Date | null;
//   createdAt: Date; updatedAt: Date; deletedAt: Date | null }
```

`CustomerAuthService`, `CustomerProfileService`, the resolver and the registrar are
module-internal. Every method joins the open transaction (`TransactionRepository.run()`).

**Changed in U2a's `CredentialsModule`** (additive):

```ts
revokeAllFor(owner: SessionOwner, reason: SessionRevokeReason,
  options?: { exceptSessionId?: number }): Promise<number>; // skips that session's family
```

## Test support for later units

`test/support/customer-auth.ts`:

```ts
registerCustomer(app: TestApp, fixture?: { email?; fullName?; password? }):
  Promise<CustomerSessionFixture>; // { customerId, email, password, sessionId, accessToken,
                                   //   refreshToken, authorization: 'Bearer …' }
// CustomerAuthService.register in TransactionRepository.run (no HTTP, no rate limit);
// default email `customer-<unique>@test.maqady.local`, password `Passw0rd-customer`
signInCustomer(app, email, password): Promise<CustomerSessionFixture>;
blockCustomer(app, customerId): Promise<void>; // CustomerService.setStatus, system actor
customerLinkToken(text: string, path: string): string; // the token of FRONTEND_BASE_URL + path ?token=
```

## Tests

**Unit** (`test/unit/modules/customers/`, collaborators mocked, a fixed `Clock`):

- `customer-principal.resolver.test.ts`: no row, another customer's session and anonymised →
  `null`; blocked → `ACCOUNT_BLOCKED` (even with a revoked session); revoked → `SESSION_REVOKED`;
  expired → `SESSION_EXPIRED`; the principal's shape; registers for `customer`.
- `customer-auth.service.test.ts`: a taken email → `EMAIL_TAKEN` with no token, message or
  session; sign-in verifies against `null` for an unknown email; blocked with a wrong password →
  `INVALID_CREDENTIALS`, with the right one → `ACCOUNT_BLOCKED`; a sign-in losing the race to a
  block → `ACCOUNT_BLOCKED`, no session; forgot password for unknown and blocked customers issues
  and queues nothing; reset on a blocked customer → `ACCOUNT_BLOCKED`, nothing written; resend
  for a verified customer issues nothing; refresh's owner check.
- `customer-profile.service.test.ts`: a wrong current password → `VALIDATION_FAILED` on
  `currentPassword`, no hash written; success revokes with `exceptSessionId`; a no-op update
  writes nothing.
- `customer.service.test.ts`: `setStatus` no-op, `NOT_FOUND`, blocking revokes with
  `account_blocked` and audits; `issuePasswordReset` `NOT_FOUND`.
- `templates/customer-templates.test.ts`: the storage render holds `REDACTED_LINK` and no token;
  the delivery render holds `<FRONTEND_BASE_URL>/verify-email?token=<t>` and
  `/reset-password?token=<t>`; `secretParams` is `['token']`; the name is HTML-escaped.
- `dto/update-profile.request.test.ts`: phones (`+201012345678` and `01012345678` accepted, the
  latter normalised; `0101234567`, `+0…`, 16 digits refused), `null` accepted, empty body refused,
  `fullName` trimmed.
- `common/rate-limit`, `common/swagger`: `verificationResendCustomer` read from config and keyed
  by customer; customer routes document `SESSION_EXPIRED`.
- `modules/auth/session.service.test.ts`: `revokeAllFor` passes the excepted family to the
  repository.

**Integration** (`test/integration/modules/customers/` — `customer-auth.controller.test.ts`,
`me.controller.test.ts`, `audiences.test.ts`, `rate-limit.test.ts`, `logging.test.ts` — and
`test/integration/migrations/0100_customers.test.ts`; the real app and Postgres, `EmailSender`
replaced by `RecordingEmailSender`, a `TestClock`):

- Registration then verification: `201`, the tokens open `GET /me` (`emailVerified: false`); one
  `customers` row, one `verify_email` token, one `messages` row (`customer.verify_email`,
  `related_customer_id` the customer) whose stored subject and bodies hold
  `[one-time link hidden]` and not the token; after the drain the sent email holds the real link;
  its token at `POST /auth/email-verifications` → `204`, `GET /me` → `emailVerified: true`; the
  same token again → `INVALID_TOKEN`; a fresh token after 24 hours → `INVALID_TOKEN`.
- Resend: `202`; the earlier link → `INVALID_TOKEN`, the new one works; once verified, resend
  queues nothing.
- Duplicate email: the same email in another case → `409 EMAIL_TAKEN`, no second row, token,
  message or session; two concurrent registrations of one email → one `201`, one `409`.
- Sign-in: success `201` (`last_sign_in_at` set); a wrong password and an unknown email →
  `401 INVALID_CREDENTIALS`; a blocked customer with the right password → `403 ACCOUNT_BLOCKED`,
  with a wrong one → `INVALID_CREDENTIALS`; no session row on any failure; blocking a signed-in
  customer makes their access token and their refresh answer `ACCOUNT_BLOCKED`.
- Refresh: rotation (new pair, old row `rotated_at` and `replaced_by_id`, the new access token
  works, `refreshTokenExpiresAt` unchanged); the old token at +10 s → `409 REFRESH_CONFLICT`,
  family live; at +31 s → `401 SESSION_REVOKED`, every family row revoked and committed; a staff
  refresh token at `/auth/tokens` and a customer one at `/admin/auth/tokens` →
  `401 UNAUTHENTICATED`; after 30 days → `SESSION_EXPIRED` on both refresh and `GET /me`.
- Sign-out: `204`; the access token and the refresh token then → `SESSION_REVOKED`.
- Password reset: forgot for unknown, blocked and active emails all answer `202` with an empty
  body; only the active one creates a token and a `customer.password_reset` message (redacted
  when stored, real when sent). Reset → `204`; the old password → `INVALID_CREDENTIALS`; the new
  one signs in; every earlier access token → `SESSION_REVOKED`; `email_verified_at` set; the token
  again → `INVALID_TOKEN`; a second forgot request voids the first link; past 1 hour →
  `INVALID_TOKEN`; a weak password → `VALIDATION_FAILED` and the token still works; a customer
  blocked after the request → `ACCOUNT_BLOCKED` and the token still unused.
- Password change: a wrong current password → `400 VALIDATION_FAILED` (`currentPassword`),
  password unchanged; a weak new one → `VALIDATION_FAILED`; success → `204`, the old password
  fails sign-in, the new one works, the current access and refresh tokens still work, a second
  device's tokens → `SESSION_REVOKED`.
- Profile: `PATCH /me` sets `fullName` (trimmed) and `phone` (local form stored as E.164), clears
  `phone` with `null`; `email` in the body, a bad phone or an empty body → `VALIDATION_FAILED`;
  the same `Idempotency-Key` replays.
- Audiences: a staff token on every `customer` route from `listHttpRoutes()` →
  `401 UNAUTHENTICATED` (the list asserted to contain `GET /api/v1/me`); a customer token on every
  `staff` and `admin` route → `401 UNAUTHENTICATED` (the list contains `GET /api/v1/admin/me`).
- Rate limits (low limits by test config): the 6th registration from one address → `429` with
  `Retry-After`; the 6th sign-in for one email → `429`; the 4th resend for one customer → `429`
  while another customer's still answers `202`; the 4th forgot-password request for one email →
  `429`.
- No personal data in logs: a registration, sign-in, forgot, reset and profile edit leave no
  email, name, phone, password or token in any log line.
- Migration: a `sessions`, `one_time_tokens`, `messages` or `audit_events` row with an unknown
  customer id fails on the named `fk_…` constraint; the CHECK refuses a live row without an email
  and an anonymised row with one; two live rows with one email (any case) fail on
  `uq_customers_email_live`, while a live and an anonymised one coexist.
- Contract: `npm run contract` adds the 11 operations with the `Auth` and `Profile` tags and
  leaves no diff after commit.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass, proving issue #10's list: registration then the verification email
  queued with a redacted body then verification with the real token; duplicate email refused;
  sign-in success, wrong password and blocked customer; refresh rotation and `REFRESH_CONFLICT`;
  password reset works once and revokes sessions; password change requires the current password;
  a staff token cannot reach customer routes and a customer token cannot reach admin routes.
- `docs/system-design.md` updated: §6.2 `customers` columns; §10.5 (a reset verifies the email;
  who receives a reset; resend answers `202`); §10.6 (`verificationResendCustomer`; the token
  routes and the password change under `signInIp`); §11 (phone normalisation).
- Follow-ups recorded: U10 claims a hold with a token from these routes; U12 adds `bookingCount`
  to `GET /me`; merge `customerLinkToken` with U2b's helper; whether customer password changes
  belong in the Activity log (product owner).

## Follow-ups

- **U10**: claim the anonymous hold after `POST /auth/sessions` or `POST /auth/registrations`
  (`POST /holds/{ref}/claims`); its test should sign in through these routes.
- **U12**: add `bookingCount` to `GET /me` (recommended: Confirmed and Completed bookings).
- **U15**: the admin block, unblock and "send a reset email" routes call
  `CustomerService.setStatus()` and `issuePasswordReset()`; anonymisation deletes the customer's
  sessions, one-time tokens and messages before clearing the row (the new foreign keys require
  that order).
- **After U2b merges**: fold `customerLinkToken` and U2b's link helper into one test helper.
- **Product owner**: whether customer password changes and resets should appear in the admin
  Activity log (§13.5 currently excludes them).
- `signInIp` is shared by sign-in, the two token routes and the password change; a busy shared
  address (carrier NAT) meets it sooner. Revisit with real traffic.
