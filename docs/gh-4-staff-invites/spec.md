---
title: U2b — Staff invites, password reset and setup, Message log API
owner: Mohamed Tarek
status: Implemented
last_verified: 2026-10-20
tags: [staff, invites, password-reset, one-time-tokens, messaging, message-log, email-templates]
---

# U2b — Staff invites, password reset and setup, Message log API

Issue: #4 (second half; U2a is the first). Docs folder: `docs/gh-4-staff-invites/`. Migration
prefix `0045`. Depends on U2a (`staff_users`, `one_time_tokens`, `CredentialsModule`,
`StaffModule`, `docs/gh-4-staff-access/spec.md`) and U3 (`messages`, `MessagingService`,
`MessageTemplateRegistry`, `docs/gh-3-messaging/spec.md`). Design: `docs/system-design.md` §5,
§6.1, §10.1, §10.5, §10.6, §11 (admin auth, staff and messages routes), §13.1, §13.5, §14.1,
§14.3; ADR 0004; PRD v2 "Users and roles", "Accounts", "New admin screens" (Set your password,
Staff, Message log), "Email and SMS", "Frontend integration contract".

## Goal

An admin invites a staff member by name, email and role; the member receives a real email with
a 72-hour set-password link, sets a password and signs in. A staff member who forgot their
password gets a 1-hour link the same way. Admins read every email and SMS in the Message log,
with its delivery status, and never see a usable one-time link there.

## Scope

- Migration `0045_01`: the `fk_messages_related_staff_user_id` foreign key.
- Routes: `POST /admin/staff`, `POST /admin/staff/{id}/invitations`,
  `POST /admin/auth/password-reset-requests`, `POST /admin/auth/password-setups`,
  `GET /admin/messages`, `GET /admin/messages/{id}`.
- Templates `staff.invite` and `staff.password_reset`, registered in U3's registry by
  `StaffModule`, linking to `/admin/set-password?token=` on `FRONTEND_BASE_URL`.
- `StaffOnboardingService` (invite, resend, reset request, password setup) in
  `src/modules/staff/`.
- `MessageLogService`, its repository and controller in `src/modules/messaging/`.
- One new error code, `NOT_INVITED`.
- `OneTimeTokenService.findLive()` in U2a's `CredentialsModule` (see "Changes to earlier code").
- Rate limits on the two public routes; an audit event for every staff write.
- `test/support/messaging/one-time-link.ts`, the token extractor U9 can reuse.

## Out of scope

- Sign-in, refresh, sign-out, `GET /admin/me`, the staff list and `PATCH` (U2a).
- Customer templates, reset and verification (U9); `POST /admin/customers/{id}/password-reset-requests` (U15).
- Booking references or customer names in the Message log: the log returns the related ids;
  resolving them belongs to the units that own those tables (U9, U10). Follow-up.
- Retrying a `failed` message from the Message log (U3: `failed` is terminal; no route in §11).
- Changing one's own password while signed in (no staff screen in the PRD).
- Arabic email copy: PRD "Scope" puts multiple languages out of v1 (English UI).

## Open questions from the draft, decided

| Question | Decision | Why |
|---|---|---|
| An invited member whose invite expired uses "Forgot password": re-send the invite? | **No.** Reset requests send only to `active` members; `invited`, `deactivated` and unknown emails get the same `202` and nothing is sent. The admin resends the invite. | The 72-hour invite limit (PRD "Accounts" 7) would mean nothing if anyone could re-issue it from the public page. Onboarding stays an admin action, and the answer is identical, so nothing is revealed. |
| A member deactivated before setting a password: resend? | **Already solved by U2a.** `PATCH status=active` returns a member without a password to `invited`, and resend then works. Resend accepts only `invited`; any other status is `409 NOT_INVITED`. | U2a spec "Decisions". No new state transition is needed here. |
| Should deactivating delete unused invite and reset tokens? | **Already done by U2a** (`OneTimeTokenService.invalidateAllFor`). Password setup also re-checks the member's status under its row lock and answers `403 ACCOUNT_DEACTIVATED` without spending the token. | Belt and braces: the lock order below makes the race impossible, the check makes it harmless anyway. |
| Related booking or customer in the Message log | **Ids only** (`related.customerId`, `.staffUserId`, `.bookingId`). | `customers` and `bookings` do not exist yet, and `messaging` depends on no feature module. Follow-up for U9/U10/U12. |
| Shared rate-limit buckets | **Accepted.** Reset requests use `emailRequestEmail` + `emailRequestIp`, shared with U9's forgot-password and resend-verification routes; setups use `signInIp`. | Design §10.6 says a named limit shares one count across routes ("both forgot-password routes, for example"). A setup is guessing a 256-bit token, so the sign-in IP limit is plenty. |
| Arabic email copy | **English only.** | PRD "Scope": multiple languages are out of v1. |

## Decisions taken here

| Decision | Why |
|---|---|
| Invite, resend, reset request and password setup live in `StaffOnboardingService` in `src/modules/staff/`, not in `StaffService` | U2a's note said "`StaffService.invite`, `setPassword`". A separate file keeps `StaffService` the read/update service it is. Both stay in `StaffModule`; nothing outside the module calls them. |
| Invite reuses U2a's `StaffRepository.insert()` (`ON CONFLICT (email) DO NOTHING`); no row → `409 EMAIL_TAKEN` | §10.5: a taken email never raises `23505` inside the request transaction. Applies to every status, `deactivated` included (`citext`, so case does not matter). |
| An invited member is `status = 'invited'`, `password_hash = NULL` | U2a's `chk_staff_users_password`. An expired invite changes nothing on the row (no timer); the admin resends. |
| One link path for both purposes: `/admin/set-password?token=<token>` | PRD "Frontend integration contract". The page does not know the purpose, so `password-setups` takes only `token` and `password`. |
| **Lock order of a password setup: the token's owner first, then the token.** `OneTimeTokenService.findLive(token)` reads the live token without locking; the service locks the member row (`FOR NO KEY UPDATE`), then `consume({ purpose, token })` uses it atomically | Every staff change locks the member before touching their tokens (U2a's deactivation deletes tokens after locking the row). Consuming first would hold the token row and then wait on the member row: a deadlock with a concurrent deactivation. A token used or deleted between the two steps fails `consume` with `INVALID_TOKEN`, so the check is still single-use. |
| The `token` field is validated only as a string of 1–128 characters; anything that matches no live token is `400 INVALID_TOKEN`, not `VALIDATION_FAILED` | A mangled link shows "this link is invalid or has expired", the same as an old one. |
| The password policy is checked by the DTO (`@IsAllowedPassword()`) before the token is touched | A weak password never spends the token. |
| Invite token: the member must be `invited`, else `INVALID_TOKEN` (`active`, defensive: unreachable while U2a deletes tokens on every change) or `403 ACCOUNT_DEACTIVATED` (`deactivated`). Success sets the hash and `status = 'active'` | "Turns an invited member active." A throw rolls the request back, so the token is not spent. |
| Reset token: the member must be `active`, else `ACCOUNT_DEACTIVATED` (`deactivated`) or `INVALID_TOKEN` (`invited`). Success sets the hash and revokes every live session (`password_changed`) | §10.5; a reset ends sessions an attacker may hold. |
| `password-setups` answers `204` and opens no session | Acceptance: "set password, then sign in"; the frontend sends the member to `/admin/login`. Credentials never come from a link alone. |
| Resend for any status but `invited` is `409 NOT_INVITED` (new code) | `CONFLICT` means "a database constraint refused the change" and names a constraint; the Staff screen needs its own code to say "this member already set a password". |
| Resend and reset request rely on U2a's `issue()` deleting the owner's earlier unused tokens of the same purpose | §10.5 "requesting a new token invalidates the previous one". |
| Reset requests lock the member row before issuing | The same order as every staff change (member, then tokens), so a reset request racing a deactivation either sees `deactivated` and sends nothing, or finishes first and its token is deleted by the deactivation. |
| Every write runs in the request transaction; the token, the `messages` row and the audit row commit or roll back together | §13.1 outbox. `MessagingService.queue()` joins the open transaction; U3's interceptor drains after the response. |
| `password-reset-requests` and `password-setups` are `@NoIdempotencyStorage()` | §10.2 / §14.1: auth routes never store responses. A repeated setup is `INVALID_TOKEN`; a repeated request reissues (and is rate-limited). |
| `POST /admin/staff` and `/invitations` are `@Strict()` | §11 "S". Their stored responses hold no token. |
| Template params: invite `{ fullName, role, token }`, reset `{ fullName, token }`; `secretParams: ['token']`; the link is `links.oneTime('/admin/set-password', token)` | U3's contract: the stored copy holds `[one-time link hidden]`, and `queue()` refuses a render that leaks the token. |
| The Message log reads through `MessageLogRepository` in `messaging`, which never selects `payload_ciphertext` and never decrypts | §13.1, ADR 0004. The stored bodies are already redacted by U3. |
| Date filter: `from` (inclusive) and `to` (exclusive), ISO 8601 instants with an offset; `from < to`, else `VALIDATION_FAILED` on `to` | The admin picks Cairo days and the frontend sends their 06:00 or midnight instants. Instants avoid wall-clock conversion (and its summer-time gap) on the server. |
| Order `created_at DESC, id DESC`; the cursor's sort key is `created_at.toISOString()` (kind `instant`) | U3's `idx_messages_created_at` serves it. `formatCairoIso` drops milliseconds, so it cannot be the cursor key. |
| No new index for the `channel` / `status` filters | Around 100 messages a day; a filtered walk of `idx_messages_created_at` is enough. Add `(status, created_at DESC, id DESC)` if the log grows. |
| The Message log is its own `MessageLogModule`, imported after `StaffModule`, not part of the global `MessagingModule` | `MessagingModule` is imported before the feature modules because they all queue through it; routes on it would come first in the generated contract and reorder every path. Its own module keeps `messaging` route-free and the contract diff additive. |
| `bodyHtml` is returned as stored | U3 escapes every value in `renderSimpleHtml`, and the stored copy has no link. The description tells the frontend to show it in a sandboxed `iframe`. |
| Audit actor for a reset request is `system`; for a password setup it is the member (`staff`, own id) | The requester is not signed in; the setup proves control of the mailbox. |

## Modules and files

**`src/modules/staff/`** (U2a's `StaffModule`; additions)

| File | Holds |
|---|---|
| `enums.ts` | adds `PASSWORD_SETUP_PURPOSES = ['staff_invite', 'staff_password_reset']` |
| `types.ts` | adds `InviteStaffInput`, `StaffInvitation`, `PasswordSetupInput`, `PasswordSetupPurpose`, `StaffPasswordUpdate`, `StaffInviteParams`, `StaffPasswordResetParams` |
| `staff.constants.ts` | adds `SET_PASSWORD_PATH`, `STAFF_ROLE_LABELS` |
| `staff.repository.ts` | adds `setPassword(id, update)` |
| `staff-onboarding.service.ts` | `StaffOnboardingService`; registers both templates in `onModuleInit()` |
| `templates/staff-invite.template.ts` | `staffInviteTemplate: MessageTemplate<StaffInviteParams>` |
| `templates/staff-password-reset.template.ts` | `staffPasswordResetTemplate: MessageTemplate<StaffPasswordResetParams>` |
| `staff.controller.ts` | adds `inviteStaffMember`, `resendInvitation` |
| `staff-auth.controller.ts` | adds `requestPasswordReset`, `setUpPassword` |
| `dto/invite-staff-member.request.ts`, `dto/staff-password-reset.request.ts`, `dto/staff-password-setup.request.ts` | request DTOs |
| `dto/staff-invitation.response.ts` | `StaffInvitationResponse` |
| `staff.module.ts` | adds `StaffOnboardingService` |

**`src/modules/messaging/`** (U3's folder; a new `MessageLogModule` beside `MessagingModule`)

| File | Holds |
|---|---|
| `types.ts` | adds `MessageLogFilter`, `MessageLogRow`, `MessageLogDetailRow`, `MessageLogEntry`, `MessageLogDetail` |
| `message-log.repository.ts` | `list(filter, page)`, `count(filter)`, `findById(id)` (named columns, never `payload_ciphertext`) |
| `message-log.service.ts` | `MessageLogService` |
| `message-log.controller.ts` | `@Controller('admin/messages')`, `@ApiTags('Admin: messages')` |
| `dto/message-log.query.ts`, `dto/message.params.ts` | query and path DTOs |
| `dto/message-summary.response.ts`, `dto/message-detail.response.ts`, `dto/message-related.response.ts`, `dto/message-summary-page.response.ts` | response DTOs |
| `message-log.module.ts` | `MessageLogModule`: the controller, repository and service, imported by `AppModule` after `StaffModule` |

**Elsewhere**

| File | Change |
|---|---|
| `src/migrations/0045_01_add_messages_staff_fk.ts` | the foreign key |
| `src/migrations/0045_02_comment_one_time_tokens_lookup.ts` | the token-hash index's comment names the `findLive` lookup |
| `src/modules/auth/one-time-token.service.ts`, `one-time-tokens.repository.ts`, `types.ts` | `findLive()` |
| `src/common/errors/error-catalogue.ts` | `NOT_INVITED` |
| `src/common/time/iso-instant.validator.ts` | `IsIsoInstant()` for query DTOs |
| `src/app.module.ts` | imports `MessageLogModule` after `StaffModule` |
| `src/common/swagger/swagger.constants.ts` | tag `Admin: messages`; `Admin: staff` and `Admin: auth` descriptions mention invites and password setup |
| `test/support/messaging/one-time-link.ts` | `oneTimeTokenFrom()` |

## Migration (prefix `0045`)

**`0045_01_add_messages_staff_fk`**

```sql
ALTER TABLE messages
  ADD CONSTRAINT fk_messages_related_staff_user_id
  FOREIGN KEY (related_staff_user_id) REFERENCES staff_users (id);
```

Covered by U3's `idx_messages_related_staff_user_id (related_staff_user_id)`, whose comment
already names this key. `down` drops the constraint.

**`0045_02_comment_one_time_tokens_lookup`**: `COMMENT ON INDEX uq_one_time_tokens_token_hash`
now names both queries it serves, `consume` and `findLive`. No other schema change: invites and
resets use U2a's `staff_users` and `one_time_tokens` as they are.

## Behaviour

**Invite** (`StaffOnboardingService.invite`, request transaction):

1. `StaffRepository.insert({ email, full_name, role, status: 'invited', password_hash: null, created_at = updated_at = now })` (both trimmed); no row → `EMAIL_TAKEN`.
2. `OneTimeTokenService.issue({ purpose: 'staff_invite', owner: { kind: 'staff', id }, lifetimeSeconds: ONE_TIME_TOKEN_LIFETIME_SECONDS.staff_invite })` (72 h).
3. `MessagingService.queue({ template: staffInviteTemplate, recipient: email, params: { fullName, role, token }, related: { staffUserId: id } })`.
4. Audit `staff_user.invited`. Return the member.

**Resend** (`resendInvite`): `findByIdForUpdate(id)` (missing → `NOT_FOUND`; status ≠ `invited`
→ `NOT_INVITED`); steps 2–3 with the stored email and name; audit `staff_user.invite_resent`;
return `{ staffUserId, expiresAt }`.

**Reset request** (`requestPasswordReset(email)`): `findByEmail(email.trim())`, then
`findByIdForUpdate(id)`; only when the member is `active`: issue `staff_password_reset` (1 h),
queue `staff.password_reset`, audit `staff_user.password_reset_requested`. Otherwise nothing.
The controller always answers `202` with no body.

**Password setup** (`setPassword({ token, password })`):

1. `OneTimeTokenService.findLive(token)`; none, or a purpose other than the two staff ones →
   `INVALID_TOKEN`.
2. `findByIdForUpdate(owner.id)`; then `consume({ purpose, token })` (a token used or deleted
   meanwhile → `INVALID_TOKEN`).
3. Apply the status rules in "Decisions" (a refusal rolls back, so the token stays live).
4. `PasswordService.hash(password)`; `setPassword(id, { password_hash, status: 'active', updated_at: now })`.
5. Reset only: `SessionService.revokeAllFor({ audience: 'staff', id }, 'password_changed')`.
6. Audit `staff_user.password_set`.

**Templates** (English, `renderSimpleHtml`, links from `FRONTEND_BASE_URL`):

| Name | Subject | Body |
|---|---|---|
| `staff.invite` | `You're invited to the Maqady dashboard` | "Hello {fullName}," / "An admin has invited you to the Maqady dashboard as {Admin \| Box office}." / "Set your password within 72 hours: {link}" / "The link works once. If you weren't expecting this invite, you can ignore this email." Action "Set your password". |
| `staff.password_reset` | `Reset your Maqady dashboard password` | "Hello {fullName}," / "We received a request to reset your Maqady dashboard password." / "Set a new password within 1 hour: {link}" / "The link works once. If you didn't ask for this, ignore this email; your password stays the same." Action "Set a new password". |

**Message log** (`MessageLogService`, no transaction): `list` = `WHERE` the filters, `AND
(created_at, id) < (:createdAt, :id)` after a cursor, `ORDER BY created_at DESC, id DESC LIMIT
:limit + 1`, plus `count` with the same filters, then `toPage()`. `get(id)` → `NOT_FOUND` when
missing.

**Audit events** (`AuditService.record`, inside the write's transaction):

| Action | Actor | Entity | Changed fields / metadata |
|---|---|---|---|
| `staff_user.invited` | staff (admin) | `staff_user`, new id | `{ role, status: 'invited' }` |
| `staff_user.invite_resent` | staff (admin) | `staff_user`, id | — |
| `staff_user.password_reset_requested` | system | `staff_user`, id | — |
| `staff_user.password_set` | staff (the member) | `staff_user`, id | `['password', 'status']` for an invite, `['password']` for a reset; `{ purpose }` |

## Endpoints

All under `/api/v1`; every operation has a summary, a description of its rules and who may call
it, and `@ApiErrorResponses(...)` for the codes below. The access codes (`UNAUTHENTICATED`,
`SESSION_*`, `ACCOUNT_DEACTIVATED`, `FORBIDDEN`), the idempotency codes, `413` and `429` come from
U1's cross-cutting documentation.

| Route | Access | Idempotency | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /admin/staff` | `@Admin()` | `@Strict()` | `InviteStaffMemberRequest` | `201 StaffMemberResponse` (U2a) | `VALIDATION_FAILED`, `EMAIL_TAKEN` |
| `POST /admin/staff/{id}/invitations` | `@Admin()` | `@Strict()` | — | `201 StaffInvitationResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `NOT_INVITED` |
| `POST /admin/auth/password-reset-requests` | `@Public()`, `@RateLimit('emailRequestEmail', 'emailRequestIp')` | `@NoIdempotencyStorage()` | `StaffPasswordResetRequest` | `202`, no body | `VALIDATION_FAILED` |
| `POST /admin/auth/password-setups` | `@Public()`, `@RateLimit('signInIp')` | `@NoIdempotencyStorage()` | `StaffPasswordSetupRequest` | `204` | `VALIDATION_FAILED`, `INVALID_TOKEN`, `ACCOUNT_DEACTIVATED` |
| `GET /admin/messages` | `@Admin()` | — | `MessageLogQuery` | `200 MessageSummaryResponsePage` | `VALIDATION_FAILED` |
| `GET /admin/messages/{id}` | `@Admin()` | — | — | `200 MessageDetailResponse` | `VALIDATION_FAILED`, `NOT_FOUND` |

**DTOs**

- `InviteStaffMemberRequest`: `fullName` (trimmed, 1–100), `email` (trimmed, `IsEmail`, ≤ 320),
  `role` (`admin` | `box_office`).
- `StaffInvitationResponse`: `staffUserId`, `expiresAt` (Cairo ISO).
- `StaffPasswordResetRequest`: `email` (trimmed, `IsEmail`, ≤ 320).
- `StaffPasswordSetupRequest`: `token` (string, 1–128), `password` (`@IsAllowedPassword()`).
- `MessageLogQuery` extends `PageQuery`: optional `channel` (`email` | `sms`), `status`
  (`queued` | `sent` | `failed`), `from`, `to` (ISO 8601 instants with an offset).
- `MessageSummaryResponse`: `id`, `channel`, `template`, `recipient`, `subject` (nullable),
  `status`, `attempts`, `lastErrorCode` (nullable), `nextAttemptAt` (nullable), `sentAt`
  (nullable), `createdAt`, `related: MessageRelatedResponse`.
- `MessageRelatedResponse`: `customerId`, `staffUserId`, `bookingId` (each nullable).
- `MessageDetailResponse`: the summary fields plus `bodyText`, `bodyHtml` (nullable),
  `providerMessageId` (nullable), `updatedAt`. No ciphertext or parameter field exists.
- `MessageSummaryResponsePage` = `PageResponseOf(MessageSummaryResponse)`.
- Path `id`: positive integer, else `VALIDATION_FAILED`. Times use `formatCairoIso()`.

**Error code added** (`src/common/errors/error-catalogue.ts`, design §14.3):

| Code | HTTP | Meaning |
|---|---|---|
| `NOT_INVITED` | 409 | The member is not waiting for an invite: they already set a password (they use "Forgot password"), or they are deactivated (reactivate them first). |

## Services

**Exported to other units:** none new. `StaffModule` still exports `StaffService` and
`StaffBootstrapService` (U2a); `MessagingModule` keeps U3's exports. `CredentialsModule`'s
`OneTimeTokenService` gains `findLive()`, available to U9.

```ts
// CredentialsModule (U2a), added here
class OneTimeTokenService {
  findLive(token: string): Promise<LiveOneTimeToken | null>;
  //   LiveOneTimeToken = { id: number; purpose: OneTimeTokenPurpose; owner: OneTimeTokenOwner }
  //   a malformed, unknown, used or expired token → null; no lock, so consume() still decides
}

// Module-internal
class StaffOnboardingService {
  invite(actor: StaffPrincipal, input: InviteStaffInput): Promise<StaffMember>;
  //   InviteStaffInput = { email: string; fullName: string; role: StaffRole }
  resendInvite(actor: StaffPrincipal, staffUserId: number): Promise<StaffInvitation>;
  //   StaffInvitation = { staffUserId: number; expiresAt: Date }
  requestPasswordReset(email: string): Promise<void>;
  setPassword(input: PasswordSetupInput): Promise<void>; // { token: string; password: string }
}
class MessageLogService {
  list(filter: MessageLogFilter, page: PageRequest): Promise<Page<MessageLogEntry>>;
  //   MessageLogFilter = { channel?; status?; from?: Date; to?: Date }
  get(id: number): Promise<MessageLogDetail>; // NOT_FOUND when missing
}
```

Test support: `oneTimeTokenFrom(text: string, path: string): string` in
`test/support/messaging/one-time-link.ts` (the `token` query value of the first link to
`FRONTEND_BASE_URL + path` in the text; throws when there is none). U9 can reuse it.

**Consumed** (exact names):

- U2a: `StaffRepository.insert()`, `.findById()`, `.findByIdForUpdate()`, `.findByEmail()` (same
  module); `toStaffMember()`; `PasswordService.hash()`; `IsAllowedPassword()`;
  `OneTimeTokenService.issue()`, `.consume()`; `SessionService.revokeAllFor()`;
  `ONE_TIME_TOKEN_LIFETIME_SECONDS`; `StaffMember`, `StaffMemberResponse`, `StaffMemberParams`;
  test support `createStaffMember`, `signInStaff`, `staffSession`, `listHttpRoutes`, `samplePath`.
- U3: `MessagingService.queue()`, `MessageTemplateRegistry.register()`, `MessageTemplate`,
  `renderSimpleHtml()`, `OutboxDrainService.whenIdle()`, `MESSAGE_CHANNELS`, `MESSAGE_STATUSES`,
  `REDACTED_LINK`; test support `RecordingEmailSender`, `readMessages`, `TestAppOptions.overrides`.
- U1: `TransactionRepository.run()`, `TransactionContext.executor()`, `AuditService.record()`,
  `Clock`, `formatCairoIso()`, `isIsoInstant()`, `PageQuery`, `toPageRequest()`, `toPage()`,
  `PageResponseOf()`, `AppError`, `ApiErrorResponses()`, `REQUEST_ID_RESPONSE_HEADER`,
  `@Public()`, `@Admin()`, `@CurrentPrincipal()`, `@Strict()`, `@NoIdempotencyStorage()`,
  `@RateLimit()`, `StaffPrincipal`, `STAFF_ROLES`.

## Changes to earlier code

- `OneTimeTokenService.findLive()` and `OneTimeTokensRepository.findLive()` (U2a): needed for the
  lock order of a password setup. Additive; U2a's tests stay green.
- `ERROR_CATALOGUE` gains `NOT_INVITED`; `test/unit/common/errors/error-catalogue.test.ts`'s
  list and design §14.3's table gain it.
- `API_TAGS`: `Admin: messages` added; the staff and auth descriptions widened.
- `AppModule` imports `MessageLogModule`; `StaffService`'s and `StaffModule`'s comments no longer
  say U2b adds invites to them.
- Migration `0045_02` only rewrites the comment of U2a's `uq_one_time_tokens_token_hash` to name
  the `findLive` lookup it now also serves (an earlier migration is never edited).
- `staff.controller.test.ts`'s enumerated box-office test also asserts the four new Admin routes
  are listed.

## Tests

**Unit** (`test/unit/…`, collaborators mocked, fixed `Clock`):

- `modules/staff/staff-onboarding.service.test.ts`: invite → `EMAIL_TAKEN` and nothing issued
  when the insert returns nothing; invite issues a 72-hour token and queues with the member
  related; resend `NOT_FOUND`, `NOT_INVITED`; setup locks the member before consuming; the
  status table (invite token on `active` → `INVALID_TOKEN`, on `deactivated` →
  `ACCOUNT_DEACTIVATED`; reset token on `invited` → `INVALID_TOKEN`); reset revokes sessions with
  `password_changed`, invite does not; a customer-purpose or unknown token → `INVALID_TOKEN`
  with nothing locked; reset request for unknown, invited and deactivated sends nothing.
- `modules/staff/templates/staff-invite.template.test.ts` and
  `staff-password-reset.template.test.ts`: with the storage links the render holds
  `REDACTED_LINK` and not the token; with the delivery links it holds
  `<FRONTEND_BASE_URL>/admin/set-password?token=<token>`; `secretParams` is `['token']`; the name
  is HTML-escaped; the role label.
- `modules/messaging/message-log.service.test.ts`: the cursor from `created_at.toISOString()` and
  `id`; a non-instant cursor and `from >= to` → `VALIDATION_FAILED`; `NOT_FOUND`; mapping.
- `modules/auth/one-time-token.service.test.ts`: `findLive` for a malformed token returns null
  without a query; maps the owner.
- `common/time/iso-instant.validator.test.ts`; `common/errors/error-catalogue.test.ts`.

**Integration** (real app and Postgres; only `EmailSender` replaced by `RecordingEmailSender`):

- `modules/staff/staff-onboarding.service.test.ts`:
  - invite flow: `POST /admin/staff` with `Idempotency-Key` → `201`, member `invited`, one
    `staff_invite` token, one `messages` row (`staff.invite`, related to the member) whose stored
    subject and bodies contain `[one-time link hidden]` and not the token; after `whenIdle()` the
    recorded email holds the real link; `POST /admin/auth/password-setups` with it → `204`,
    member `active`; `POST /admin/auth/sessions` with the new password → `201`; audit rows;
  - no key → `IDEMPOTENCY_KEY_REQUIRED`; a replay returns the same `201` with
    `Idempotent-Replayed: true` and queues nothing more; a taken email in any case →
    `EMAIL_TAKEN` with no token or message;
  - resend: the old token → `INVALID_TOKEN`, the new one → `204`; an active member →
    `NOT_INVITED`; unknown id → `404`;
  - expiry: the clock past 72 hours → `INVALID_TOKEN`, member still `invited`; resend then works;
  - setup edges: the token twice → `INVALID_TOKEN`; two concurrent setups with one token → one
    `204`, one `INVALID_TOKEN`; a weak password → `VALIDATION_FAILED` and the token still works;
    a member deactivated after the invite → the link is gone (`INVALID_TOKEN`); a setup racing a
    deactivation never deadlocks;
  - forgot password: unknown, invited, deactivated and active emails all answer `202` with an
    empty body; only the active one creates a token and a `staff.password_reset` message. The
    reset token works once: `204`, the old password → `INVALID_CREDENTIALS`, the new one signs in,
    the earlier access token → `SESSION_REVOKED`, the token again → `INVALID_TOKEN`; the clock
    past 1 hour → `INVALID_TOKEN`; a second request invalidates the first token;
  - the foreign key: a `messages` row naming a missing staff member is refused by
    `fk_messages_related_staff_user_id`.
- `modules/staff/rate-limit.test.ts` (production limits): the 4th reset request for one email
  → `429 RATE_LIMITED` with `Retry-After`; the 21st setup from one address → `429`.
- `modules/messaging/message-log.controller.test.ts`: after an invite, a resend and a reset
  (queued, then sent), the JSON of the list and of every detail contains none of the tokens and
  no `token=`, does contain `[one-time link hidden]`, and has no ciphertext-like field; newest
  first across pages with `nextCursor` and `total`; `channel`, `status`, `from` / `to` (from
  inclusive, to exclusive); `from >= to`, a bad instant and a bad cursor → `VALIDATION_FAILED`;
  unknown id → `404`; box-office tokens → `403 FORBIDDEN`.
- `modules/staff/staff.controller.test.ts`: the enumerated box-office test includes the four new
  Admin routes.
- Contract: `npm run contract` publishes the six operations and leaves no diff after commit.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass, proving issue #4's U2b list: invite → email queued with a redacted body
  → set password with the real token → sign in; resend invalidates the old token; forgot
  password always answers `202` and the reset token works once; the Message log never contains a
  usable token; Admin-only routes refuse box-office tokens.
- `docs/system-design.md` updated: §10.1 and §10.5 (one set-password page consuming either
  purpose, its lock order, who receives a reset), §10.6 (setups under the sign-in IP limit),
  §13.1 (the Message log's filters and fields), §14.3 (`NOT_INVITED`).
