---
title: U2a — Staff access core - staff users, sessions, sign-in, refresh, roles
owner: Mohamed Tarek
status: Implemented
last_verified: 2026-10-20
tags: [staff, auth, sessions, refresh-tokens, passwords, one-time-tokens, rbac, last-admin]
---

# U2a — Staff access core: staff users, sessions, sign-in, refresh, roles

Issue: #4 (first half; U2b is the second). Docs folder: `docs/gh-4-staff-access/`. Migration
prefix `0040`. Depends on U1 (`docs/gh-2-foundations/spec.md`). Design: `docs/system-design.md`
§5, §6.1, §6.2 (identity tables), §10, §11 (admin auth and staff routes), §13.5, §14, §15; PRD v2
"Roles", "Accounts", "New admin screens: Staff sign-in, Staff".

## Goal

Staff can sign in, stay signed in through refresh-token rotation, sign out, and be managed by
admins. Every staff-audience request is resolved against the database on every call, so
sign-out, deactivation and demotion take effect on the next request. Passwords, sessions and
one-time tokens are built once, here, as services that U2b (invites, resets) and U9 (customers)
reuse unchanged. Later units get a test helper that hands them a real token of either role.

## Scope

- Migrations: `staff_users`, `sessions`, `one_time_tokens`, and the `audit_events` → `staff_users`
  foreign key.
- `src/modules/auth/` (`CredentialsModule`): `PasswordService` (scrypt), the password policy
  validator, `SessionService` (open, refresh with rotation and grace, revoke), `OneTimeTokenService`
  (issue, consume), shared token DTOs.
- `src/modules/staff/` (`StaffModule`): `StaffRepository`, `StaffService`, `StaffAuthService`,
  `StaffPrincipalResolver` (registered for the `staff` audience), `StaffBootstrapService`, three
  controllers, `runAdminCreate()`.
- Routes: `POST /admin/auth/sessions`, `POST /admin/auth/tokens`,
  `DELETE /admin/auth/sessions/current`, `GET /admin/me`, `GET /admin/staff`,
  `PATCH /admin/staff/{id}`.
- `npm run admin:create` (`src/cli/admin-create.ts`).
- `test/support/staff-auth.ts` and `test/support/routes.ts` for later units.
- Audit events for every staff write (table below).

## Out of scope

- U2b: `POST /admin/staff` (invite), `POST /admin/staff/{id}/invitations`,
  `POST /admin/auth/password-reset-requests`, `POST /admin/auth/password-setups`, the staff email
  templates, the Message log API, and the `messages.related_staff_user_id` foreign key (see
  Decisions).
- U9: `customers`, the customer resolver and routes, and the `customer_id` foreign keys on
  `sessions` and `one_time_tokens`.
- Changing one's own password while signed in (no staff route in §11).

## Decisions taken here

| Decision | Why |
|---|---|
| `src/modules/auth/` holds `CredentialsModule` (passwords, sessions, one-time tokens) and depends on nothing but `common/*`; `staff` (and later `customers`) import it | §5 lists `auth` as using customers, staff and messaging; that would be a cycle once staff and customers use sessions. The account check is passed in by the caller instead. §5 is updated to say so. The class is not called `AuthModule`, which `common/auth` already uses. |
| One `sessions` row per refresh token; `family_id UUID` groups a sign-in's chain; `sid` in the access token is the row id of the newest token | Rotation keeps history (`rotated_at`, `replaced_by_id`) and reuse detection needs the old row. Revoking sets `revoked_at` on every row of the family, so any access token of the family is refused at once. |
| Session expiry is absolute: a rotated row inherits the family's `expires_at` (sign-in + 12 h for staff, + 30 days for U9's customers) | §10.2 says a refresh token "lasts" 12 hours / 30 days. Read literally, the lifetime belongs to the sign-in, not to each rotation, and a sliding window would let a stolen token live forever by refreshing every 15 minutes. A staff session is a shift; a customer signs in again monthly. One rule for both audiences, recorded in §10.2. |
| `POST /admin/auth/tokens` is `@NoRequestTransaction()` + `@NoIdempotencyStorage()`; `SessionService.refresh()` opens its own transaction and throws `SESSION_REVOKED` only after the family revocation committed | Inside the request transaction the error would roll the revocation back, and reuse detection would never stick. Accepted deviation from §10.2/§14.1 ("auth routes run in the transaction"); both sections now say refresh routes are the exception. U9's `POST /auth/tokens` uses the same two decorators. |
| Refresh order of checks: unknown (or the other audience's) → `UNAUTHENTICATED`; revoked → `SESSION_REVOKED`; expired → `SESSION_EXPIRED`; already rotated and `now < rotated_at + 30 s` → `REFRESH_CONFLICT` (no write); rotated later → revoke the family, `SESSION_REVOKED`; then the caller's account check | Expired or revoked families need no reuse handling; the grace window never revokes (§10.2). An unknown well-formed token is `UNAUTHENTICATED`, not `SESSION_REVOKED`: there is no session to call revoked, and the frontend sends the user to sign-in on any 401. |
| The presented row is read `FOR UPDATE` | Two concurrent refreshes of one token serialize: the second sees `rotated_at` and gets `REFRESH_CONFLICT`. |
| Sign-in is `@NoIdempotencyStorage()` and runs in the request transaction; sign-out also `@NoIdempotencyStorage()` | §10.2: auth responses are never stored. Sign-out is naturally idempotent. |
| Sign-in: unknown email, or an `invited` member without a password, still runs one scrypt against a fixed dummy hash and answers `INVALID_CREDENTIALS` | Timing and answer never reveal whether the email exists. |
| `ACCOUNT_DEACTIVATED` at sign-in only after the password matched | A wrong password never learns the account state. |
| Resolver order: no row → `null` (`UNAUTHENTICATED`); member not `active` → `ACCOUNT_DEACTIVATED`; session revoked → `SESSION_REVOKED`; `expires_at <= now` → `SESSION_EXPIRED` | Deactivation also revokes the sessions; checking status first gives the deactivated member the clearer code the PRD asks for. |
| Demotion (admin → box office) and deactivation revoke all the member's live sessions in the same transaction (reason `role_changed` / `account_deactivated`) | Task rule. A demoted admin signs in again and lands in the box-office dashboard, instead of a shell whose admin screens suddenly answer `FORBIDDEN`. The role is still read from the database on every request, so the change holds even for a request already past the guard. Promotion revokes nothing. |
| Revoking (a family or all of an owner's sessions) first locks the live head rows (`rotated_at IS NULL AND revoked_at IS NULL`) `FOR UPDATE`, then updates in a second statement | A refresh in flight holds the head's lock; waiting for it and then updating in a new statement (a fresh READ COMMITTED snapshot) also revokes the token that refresh just inserted. Without it, sign-out racing a refresh in another tab could leave the new token live. |
| Deactivation also deletes the member's unused one-time tokens (`OneTimeTokenService.invalidateAllFor`) | An invite or reset link must not outlive the account: "deactivating takes effect immediately" (PRD). |
| Last-admin rule: every `PATCH /admin/staff/{id}` first locks `SELECT id FROM staff_users WHERE role = 'admin' AND status = 'active' ORDER BY id FOR NO KEY UPDATE`, then the target `FOR NO KEY UPDATE` | One lock order for every update, so two demotions never deadlock; `NO KEY` so the foreign-key checks of a refresh's new session row and of audit rows naming the member are not blocked (a `FOR UPDATE` here deadlocked with an in-flight refresh); the second waits, re-reads the set without the first's target, and gets `LAST_ADMIN`. |
| `PATCH` accepts `status` `active` or `deactivated` only. Reactivating (`active`) a deactivated member who never set a password returns them to `invited`, so U2b's "Resend invite" works for them; `active` on an `invited` member is `VALIDATION_FAILED` on `status` | `invited` is otherwise set only by U2b's invite; a member without a password can't be active (CHECK). Reactivation means "undo the deactivation", which for a never-activated member is the invited state; refusing it would leave such a member stuck. An invited member becomes active only by setting a password (U2b). |
| A `PATCH` that changes nothing answers `200` with the member, writes no audit row and revokes nothing | Retries and double clicks are harmless. |
| Admins may demote or deactivate themselves, within the last-admin rule | Design and PRD are silent; the last-admin rule is what protects the system, and refusing would make a second admin necessary just to step down. Their own sessions are revoked like anyone's. |
| The bootstrap admin's password is used as given; v1 forces no change on first sign-in | §10.1's "one-time" means the variable is used once, by the command. The admin changes it through "Forgot password" (U2b) when wanted; the README says to remove the variable after the run. A forced change needs a screen the PRD does not have. |
| Password hash text: `scrypt$16384$8$5$<salt base64url>$<key base64url>`, 16-byte salt, 64-byte key | Self-describing, so the profile can change later without a migration. |
| Password policy: 8–128 characters, at least one ASCII digit `[0-9]` | §10.1; the upper bound caps hashing work per request. |
| One-time tokens: issuing deletes the owner's earlier **unused** tokens of the same purpose; consuming is one `UPDATE … WHERE used_at IS NULL AND expires_at > :now RETURNING` | "Invalidates the previous one" (§10.5) without a new column; single use is enforced by the database row. |
| Refresh success is not audited; sign-in, sign-out, reuse detection and every staff change are | A refresh every 15 minutes would drown the Activity log. |
| `messages.related_staff_user_id` FK is added by U2b, not here | U2a does not depend on U3 and may merge before `messages` exists. U3's draft says U2a; U2b (deps U2a, U3) owns it instead. |
| `admin:create` boots the app context like `npm run migrate`, migrates, then takes `pg_advisory_xact_lock(hashtext('maqady-backend:admin-create'))` | Two concurrent runs create one admin. |
| `admin:create` does nothing when any `staff_users` row has `role = 'admin'` | "Creates an active admin if none exists"; the last-admin rule keeps at least one active. |
| Times in responses are `formatCairoIso()` | §11 "ISO 8601 with offset", same as every unit. |
| Token responses answer `201` | Both routes create a resource (a session, a token). |

### Open questions of the draft, decided

| Question | Decision (row above) |
|---|---|
| Absolute or sliding session expiry, for customers too? | Absolute for both audiences |
| Who adds `messages.related_staff_user_id`? | U2b (depends on U2a and U3); U2a never touches `messages` |
| Refresh outside the request transaction? | Yes; recorded in §10.2 and §14.1 |
| May an admin demote or deactivate themselves? | Yes, within the last-admin rule |
| Is the bootstrap password "one-time" enough without a forced change? | Yes for v1; change it through "Forgot password" |
| Reactivating a member who never set a password | Returns them to `invited` |
| Unknown well-formed refresh token | `UNAUTHENTICATED` |
| Demotion signs the member out | Yes |

## Modules and files

**`src/modules/auth/`** — `CredentialsModule` (not global). Providers and exports:
`PasswordService`, `SessionService`, `OneTimeTokenService`. Imports nothing (the U1 global modules
are global).

| File | Holds |
|---|---|
| `enums.ts` | `SESSION_REVOKE_REASONS = ['sign_out','refresh_reuse','account_deactivated','role_changed','password_changed','account_blocked']`, `ONE_TIME_TOKEN_PURPOSES = ['verify_email','customer_password_reset','staff_invite','staff_password_reset']` |
| `types.ts` | `SessionOwner`, `OpenSessionInput`, `IssuedSession`, `RefreshSessionInput`, `RefreshedSession`, `RefreshOutcome`, `SessionRow`, `NewSessionRow`, `SessionScope`, `SessionRevokeReason`, `OneTimeTokenPurpose`, `OneTimeTokenOwner`, `IssueOneTimeTokenInput`, `IssuedOneTimeToken`, `ConsumeOneTimeTokenInput`, `ConsumedOneTimeToken`, `NewOneTimeTokenRow`, `ConsumedOneTimeTokenRow`, `ScryptProfile`, `ParsedPasswordHash` |
| `auth.constants.ts` | `SESSION_LIFETIME_SECONDS = { staff: 43_200, customer: 2_592_000 }`, `REFRESH_REUSE_GRACE_SECONDS = 30`, `ONE_TIME_TOKEN_LIFETIME_SECONDS = { verify_email: 86_400, customer_password_reset: 3_600, staff_invite: 259_200, staff_password_reset: 3_600 }`, `ONE_TIME_TOKEN_OWNER_KIND`, `SCRYPT_PROFILE = { N: 16_384, r: 8, p: 5, maxmem: 67_108_864, keyLength: 64, saltBytes: 16 }`, `PASSWORD_HASH_PATTERN`, `DUMMY_PASSWORD_HASH` (a fixed valid hash of a random value), `PASSWORD_MIN_LENGTH = 8`, `PASSWORD_MAX_LENGTH = 128`, `PASSWORD_POLICY_MESSAGE`, `OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/` (refresh and one-time tokens), `OWNER_COLUMN` |
| `password-policy.ts` | `isAllowedPassword(value)`, `@IsAllowedPassword()` (class-validator; message "password must be 8 to 128 characters and include a digit") |
| `password.service.ts` | `PasswordService` |
| `sessions.repository.ts` | `insert`, `findByTokenHashForUpdate`, `markRotated`, `familyOf`, `lockLiveHeads`, `revoke` |
| `session.service.ts` | `SessionService` |
| `one-time-tokens.repository.ts` | `deleteUnused`, `insert`, `consume` |
| `one-time-token.service.ts` | `OneTimeTokenService` |
| `dto/refresh-tokens.request.ts` | `RefreshTokensRequest` |
| `dto/session-tokens.response.ts` | `SessionTokensResponse` |
| `credentials.module.ts` | the module |

**`src/modules/staff/`** — `StaffModule`, imports `CredentialsModule`; exports `StaffService` and `StaffBootstrapService` (for the command).

| File | Holds |
|---|---|
| `enums.ts` | `STAFF_STATUSES = ['invited','active','deactivated']`, `SETTABLE_STAFF_STATUSES = ['active','deactivated']` (roles reuse `STAFF_ROLES` from `common/auth/enums.ts`) |
| `types.ts` | `StaffStatus`, `SettableStaffStatus`, `StaffUserRow`, `NewStaffUserRow`, `StaffUserUpdate`, `StaffMember`, `StaffPrincipalRow`, `StaffListFilter`, `StaffMemberChanges`, `CreateActiveStaffInput`, `StaffSignInInput`, `StaffSignInResult`, `StaffTokens`, `BootstrapAdminInput`, `BootstrapAdminResult`, `BootstrapAdminParse` |
| `staff.constants.ts` | `STAFF_FULL_NAME_MAX_LENGTH = 100`, `EMAIL_MAX_LENGTH = 320`, `SIGN_IN_PASSWORD_MAX_LENGTH = 128`, `ADMIN_CREATE_LOCK_KEY = 'maqady-backend:admin-create'`, `BOOTSTRAP_ADMIN_VARIABLES`, `EMAIL_SHAPE` |
| `staff-member.mapper.ts` | `toStaffMember(row)` (never the hash) |
| `staff.repository.ts` | `findById`, `findByIdForUpdate`, `findByEmail`, `lockActiveAdmins`, `anyActiveAdminExists`, `list`, `count`, `insert` (`ON CONFLICT (email) DO NOTHING`), `update`, `recordSignIn`, `findPrincipalBySession`, `takeAdminCreateLock` |
| `staff.service.ts` | `StaffService` |
| `staff-auth.service.ts` | `StaffAuthService` |
| `staff-principal.resolver.ts` | `StaffPrincipalResolver` (`OnModuleInit` → `registry.register('staff', this)`) |
| `staff-bootstrap.service.ts` | `StaffBootstrapService` |
| `admin-create.command.ts` | `parseBootstrapAdminEnv(env)`, `runAdminCreate(app, env, write)` |
| `staff-auth.controller.ts` | `@Controller('admin/auth')` |
| `staff-me.controller.ts` | `@Controller('admin/me')` |
| `staff.controller.ts` | `@Controller('admin/staff')` |
| `dto/staff-sign-in.request.ts`, `dto/staff-list.query.ts`, `dto/staff-member.params.ts`, `dto/update-staff-member.request.ts` | request DTOs |
| `dto/staff-profile.response.ts`, `dto/staff-member.response.ts`, `dto/staff-session.response.ts`, `dto/staff-member-page.response.ts` | response DTOs |
| `staff.module.ts` | the module |

Also: `src/cli/admin-create.ts` (thin `main()` like `migrate.ts`); `package.json` script
`"admin:create": "nest build && node --enable-source-maps dist/cli/admin-create.js"`;
`AppModule` imports `StaffModule`; `.env.example` and README list the three `BOOTSTRAP_ADMIN_*`
variables (read only by the command, not by `loadConfig()`); `CLAUDE.md` source table unchanged.

## Migrations (prefix `0040`)

Every table: `ALTER TABLE … ENABLE ROW LEVEL SECURITY`. No defaults; all times from the `Clock`.

**`0040_01_create_staff_users`**

```sql
CREATE TABLE staff_users (
  id BIGSERIAL PRIMARY KEY,
  email CITEXT NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  password_hash TEXT NULL,
  last_sign_in_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_staff_users_email UNIQUE (email),
  CONSTRAINT chk_staff_users_email CHECK (length(email) <= 320 AND email ~ '^[^\s@]+@[^\s@]+$'),
  CONSTRAINT chk_staff_users_full_name CHECK (btrim(full_name) <> ''),
  CONSTRAINT chk_staff_users_role CHECK (role IN ('admin', 'box_office')),
  CONSTRAINT chk_staff_users_status CHECK (status IN ('invited', 'active', 'deactivated')),
  CONSTRAINT chk_staff_users_password CHECK (
    (status = 'invited' AND password_hash IS NULL)
    OR (status = 'active' AND password_hash IS NOT NULL)
    OR status = 'deactivated'),
  CONSTRAINT chk_staff_users_password_hash CHECK (password_hash ~ '^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$')
);
```

| Index | Columns | Query it serves (index comment) |
|---|---|---|
| `uq_staff_users_email` | `(email)` | Sign-in lookup by email; `admin:create` and U2b invite duplicate check |
| `idx_staff_users_active_admins` | `(id) WHERE role = 'admin' AND status = 'active'` | The last-admin lock `… WHERE role = 'admin' AND status = 'active' ORDER BY id FOR NO KEY UPDATE` |
| `idx_staff_users_full_name_id` | `(full_name, id)` | `GET /admin/staff` ordered by `full_name, id`, cursor `(full_name, id) > (?, ?)` |

**`0040_02_create_sessions`**

```sql
CREATE TABLE sessions (
  id BIGSERIAL PRIMARY KEY,
  family_id UUID NOT NULL,
  staff_user_id BIGINT NULL,
  customer_id BIGINT NULL,            -- FK added by U9
  token_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ NULL,
  replaced_by_id BIGINT NULL,
  revoked_at TIMESTAMPTZ NULL,
  revoked_reason VARCHAR(32) NULL,
  CONSTRAINT uq_sessions_token_hash UNIQUE (token_hash),
  CONSTRAINT fk_sessions_staff_user_id FOREIGN KEY (staff_user_id) REFERENCES staff_users (id),
  CONSTRAINT fk_sessions_replaced_by_id FOREIGN KEY (replaced_by_id) REFERENCES sessions (id),
  CONSTRAINT chk_sessions_one_owner CHECK (num_nonnulls(staff_user_id, customer_id) = 1),
  CONSTRAINT chk_sessions_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_sessions_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_sessions_rotation CHECK ((rotated_at IS NULL) = (replaced_by_id IS NULL)),
  CONSTRAINT chk_sessions_revocation CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT chk_sessions_revoked_reason CHECK (revoked_reason IN
    ('sign_out', 'refresh_reuse', 'account_deactivated', 'role_changed', 'password_changed', 'account_blocked'))
);
```

| Index | Columns | Query it serves (index comment) |
|---|---|---|
| `uq_sessions_token_hash` | `(token_hash)` | Refresh: find the presented token |
| `idx_sessions_family_id` | `(family_id)` | Revoke a family: `UPDATE … WHERE family_id = ? AND revoked_at IS NULL` |
| `idx_sessions_staff_user_id` | `(staff_user_id)` | Covers `fk_sessions_staff_user_id`; revoke all of a member's sessions |
| `idx_sessions_customer_id` | `(customer_id)` | Covers U9's future FK; revoke all of a customer's sessions |
| `idx_sessions_replaced_by_id` | `(replaced_by_id)` | Covers `fk_sessions_replaced_by_id` |

The per-request check reads by primary key (`sessions.id = :sid`).

**`0040_03_create_one_time_tokens`**

```sql
CREATE TABLE one_time_tokens (
  id BIGSERIAL PRIMARY KEY,
  purpose VARCHAR(32) NOT NULL,
  staff_user_id BIGINT NULL,
  customer_id BIGINT NULL,            -- FK added by U9
  token_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  CONSTRAINT uq_one_time_tokens_token_hash UNIQUE (token_hash),
  CONSTRAINT fk_one_time_tokens_staff_user_id FOREIGN KEY (staff_user_id) REFERENCES staff_users (id),
  CONSTRAINT chk_one_time_tokens_purpose CHECK (purpose IN
    ('verify_email', 'customer_password_reset', 'staff_invite', 'staff_password_reset')),
  CONSTRAINT chk_one_time_tokens_owner CHECK (
    (purpose IN ('staff_invite', 'staff_password_reset') AND staff_user_id IS NOT NULL AND customer_id IS NULL)
    OR (purpose IN ('verify_email', 'customer_password_reset') AND customer_id IS NOT NULL AND staff_user_id IS NULL)),
  CONSTRAINT chk_one_time_tokens_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_one_time_tokens_expiry CHECK (expires_at > created_at)
);
```

| Index | Columns | Query it serves (index comment) |
|---|---|---|
| `uq_one_time_tokens_token_hash` | `(token_hash)` | Consume: `UPDATE … WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?` |
| `idx_one_time_tokens_staff_user_id_purpose` | `(staff_user_id, purpose)` | Covers `fk_one_time_tokens_staff_user_id`; delete a member's unused tokens of a purpose before issuing |
| `idx_one_time_tokens_customer_id_purpose` | `(customer_id, purpose)` | Covers U9's future FK; same, for customers |

**`0040_04_add_audit_events_staff_fk`**

`ALTER TABLE audit_events ADD CONSTRAINT fk_audit_events_actor_staff_user_id FOREIGN KEY
(actor_staff_user_id) REFERENCES staff_users (id)` — covered by U1's
`(actor_staff_user_id, occurred_at DESC)` index.

## Behaviour

**Passwords.** `hash()`: 16 random bytes salt, `scrypt(password, salt, 64, { N, r, p, maxmem })`
(promisified, async), encoded as above. `verify(password, stored)`: `stored = null` verifies against
`DUMMY_PASSWORD_HASH` and returns `false`; otherwise parse (malformed → `INTERNAL`), derive with the
stored parameters, `timingSafeEqual` the keys.

**Sign-in** (`StaffAuthService.signIn`, in the request transaction):

1. `findByEmail(email)` (CITEXT, so case-insensitive).
2. `verify(password, row?.password_hash ?? null)`; false → `INVALID_CREDENTIALS`.
3. `status !== 'active'` → `ACCOUNT_DEACTIVATED`.
4. `SessionService.open({ owner: { audience: 'staff', id }, lifetimeSeconds: 43_200 })`.
5. `recordSignIn(id, now)` (`last_sign_in_at`, `updated_at`); audit `session.created`.
6. `AccessTokenService.sign({ audience: 'staff', subjectId: id, sessionId })`.

**Refresh** (`SessionService.refresh`, its own transaction; refuses with `INTERNAL` when a
transaction is already open): the order in Decisions. On success insert the new row (same
`family_id`, owner and `expires_at`, `created_at = now`), then mark the old row `rotated_at = now,
replaced_by_id = new.id`, call `assertOwnerLive(ownerId)` (staff: `ACCOUNT_DEACTIVATED` unless
`active`; a throw rolls the rotation back), and return. Reuse after the grace window revokes the
family with `refresh_reuse`, writes audit `session.reuse_detected` (actor system), commits, then
throws `SESSION_REVOKED`. `StaffAuthService.refresh` signs the new access token.

**Sign-out**: `SessionService.revokeFamilyOf(principal.sessionId, 'sign_out')`; audit
`session.revoked`; `204`.

**Principal resolver**: one query, `SELECT s.revoked_at, s.expires_at, u.role, u.status FROM
sessions s JOIN staff_users u ON u.id = s.staff_user_id WHERE s.id = :sid AND s.staff_user_id =
:sub`, then the order in Decisions, `now` from the `Clock`. Returns `{ kind: 'staff', id,
sessionId, role }`.

**Update member** (`StaffService.updateMember`, request transaction): lock active admins; lock
target (missing → `NOT_FOUND`); compute the changed fields; if the target is in the locked set and
the change sets `role = box_office` or `status = deactivated`, and the set has one member →
`LAST_ADMIN`; `status = active` on an `invited` member → `VALIDATION_FAILED` on `status`, on a
deactivated member without a password → `invited`; update with `updated_at = now`; revoke sessions
(deactivated → `account_deactivated`, admin → box office → `role_changed`); on deactivation also
`OneTimeTokenService.invalidateAllFor`; audit `staff_user.updated`.

**`admin:create`**: `parseBootstrapAdminEnv(env)` validates `BOOTSTRAP_ADMIN_EMAIL` (email, ≤ 320),
`BOOTSTRAP_ADMIN_NAME` (1–100 after trim), `BOOTSTRAP_ADMIN_PASSWORD` (`isAllowedPassword`); a
failure names only the variable and the rule, never a value. `runAdminCreate` migrates, then
`StaffBootstrapService.ensureFirstAdmin(input)` (lock, `anyActiveAdminExists` → `{ created: false }`;
email taken by anyone → `EMAIL_TAKEN`; else insert `role = admin, status = active`, audit
`staff_user.created`). Output: `Created admin #<id>. Sign in at /admin/login, then remove
BOOTSTRAP_ADMIN_PASSWORD from the environment.` or `An active admin already exists. Nothing
changed.`; exit 0 for both, 1 on failure with a JSON `fatal` line through `serializeError`. Neither
the email nor the password is printed or logged.

**Audit events** (all via `AuditService.record`, inside the write's transaction):

| Action | Actor | Entity | Changed fields / metadata |
|---|---|---|---|
| `session.created` | staff (self) | `session`, new id | `{ audience: 'staff' }` |
| `session.revoked` | staff (self) | `session`, `sid` | `{ reason: 'sign_out' }` |
| `session.reuse_detected` | system | `session`, presented id | `{ audience }` |
| `staff_user.updated` | staff (admin) | `staff_user`, id | changed `role`/`status`; `{ role, status }` (new values) |
| `staff_user.created` | system | `staff_user`, id | `{ role, status }` (bootstrap admin, test fixtures) |

## Endpoints

All under `/api/v1`, `@ApiTags('Admin: auth')` / `('Admin: staff')`, every operation with summary,
description, `@ApiErrorResponses(...)` for the codes below (U1 adds `RATE_LIMITED` and the access
errors automatically). No new error codes.

| Route | Access | Idempotency | Request | Response | Errors |
|---|---|---|---|---|---|
| `POST /admin/auth/sessions` | `@Public()`, `@RateLimit('signInEmail','signInIp')` | `@NoIdempotencyStorage()` | `StaffSignInRequest` | `201 StaffSessionResponse` | `VALIDATION_FAILED`, `INVALID_CREDENTIALS`, `ACCOUNT_DEACTIVATED`, `RATE_LIMITED` |
| `POST /admin/auth/tokens` | `@Public()` | `@NoRequestTransaction()`, `@NoIdempotencyStorage()` | `RefreshTokensRequest` | `201 SessionTokensResponse` | `VALIDATION_FAILED`, `UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `REFRESH_CONFLICT`, `ACCOUNT_DEACTIVATED` |
| `DELETE /admin/auth/sessions/current` | `@Staff()` | `@NoIdempotencyStorage()` | — | `204` | access errors |
| `GET /admin/me` | `@Staff()` | — | — | `200 StaffProfileResponse` | access errors |
| `GET /admin/staff` | `@Admin()` | — | `StaffListQuery` | `200 StaffMemberResponsePage` | `VALIDATION_FAILED` |
| `PATCH /admin/staff/{id}` | `@Admin()` | optional key, stored (not strict) | `UpdateStaffMemberRequest` | `200 StaffMemberResponse` | `VALIDATION_FAILED`, `NOT_FOUND`, `LAST_ADMIN` |

**DTOs**

- `StaffSignInRequest`: `email` (`IsEmail`, max 320), `password` (string, 1–128; the policy is not
  applied at sign-in).
- `RefreshTokensRequest` (auth module, reused by U9): `refreshToken` (matches
  `OPAQUE_TOKEN_PATTERN`).
- `SessionTokensResponse` (auth module, reused by U9): `accessToken`, `accessTokenExpiresAt`,
  `refreshToken`, `refreshTokenExpiresAt` (ISO with offset).
- `StaffSessionResponse`: `SessionTokensResponse` fields plus `staff: StaffProfileResponse`.
- `StaffProfileResponse`: `id`, `fullName`, `email`, `role` (`admin` | `box_office`).
- `StaffListQuery` extends `PageQuery`: optional `role`, optional `status` (`invited` | `active` |
  `deactivated`). Order `full_name, id`; cursor sort key `full_name`; `total` with the same filters.
- `StaffMemberResponse`: `id`, `fullName`, `email`, `role`, `status`, `lastSignInAt` (nullable),
  `createdAt`.
- `StaffMemberResponsePage` = `PageResponseOf(StaffMemberResponse)`.
- `UpdateStaffMemberRequest`: optional `role` (`IsIn(STAFF_ROLES)`), optional `status`
  (`IsIn(SETTABLE_STAFF_STATUSES)`); at least one present, else `VALIDATION_FAILED`. `id` path param
  `ParseIntPipe`-equivalent positive integer, else `VALIDATION_FAILED`.

## Services

**Exported by `CredentialsModule`** (for U2b and U9):

```ts
class PasswordService {
  hash(password: string): Promise<string>;
  verify(password: string, storedHash: string | null): Promise<boolean>; // null → dummy work, false
}
function isAllowedPassword(value: unknown): boolean;
const IsAllowedPassword: (options?: ValidationOptions) => PropertyDecorator;

type SessionOwner = { readonly audience: TokenAudience; readonly id: number };
class SessionService {
  open(input: { owner: SessionOwner; lifetimeSeconds: number }): Promise<IssuedSession>;
  //   IssuedSession = { sessionId; familyId; refreshToken; expiresAt: Date }
  refresh(input: {
    audience: TokenAudience;
    refreshToken: string;
    assertOwnerLive(ownerId: number): Promise<void>;
  }): Promise<RefreshedSession>; // { sessionId; ownerId; refreshToken; expiresAt }; own transaction
  revokeFamilyOf(sessionId: number, reason: SessionRevokeReason): Promise<number>;
  revokeAllFor(owner: SessionOwner, reason: SessionRevokeReason): Promise<number>;
}

type OneTimeTokenOwner = { readonly kind: 'staff' | 'customer'; readonly id: number };
class OneTimeTokenService {
  issue(input: { purpose: OneTimeTokenPurpose; owner: OneTimeTokenOwner; lifetimeSeconds: number }):
    Promise<IssuedOneTimeToken>; // { id; token (raw, 43 chars); expiresAt }; deletes earlier unused ones
  consume(input: { purpose: OneTimeTokenPurpose; token: string }):
    Promise<ConsumedOneTimeToken>; // { id; owner }; unknown, used, expired or other purpose → INVALID_TOKEN
  invalidateAllFor(owner: OneTimeTokenOwner): Promise<number>; // deletes every unused token of the owner
}
```

`open`, `revoke*`, `issue` and `consume` run through `TransactionRepository.run()` (join the open
transaction). Constants `SESSION_LIFETIME_SECONDS`, `ONE_TIME_TOKEN_LIFETIME_SECONDS`,
`REFRESH_REUSE_GRACE_SECONDS` are exported from `auth.constants.ts`.

**Exported by `StaffModule`** (for U2b and later units):

```ts
class StaffService {
  findById(id: number): Promise<StaffMember | null>;
  findByEmail(email: string): Promise<StaffMember | null>;
  list(filter: StaffListFilter, page: PageRequest): Promise<Page<StaffMember>>;
  updateMember(actor: StaffPrincipal, id: number, changes: StaffMemberChanges): Promise<StaffMember>;
  createActiveMember(input: CreateActiveStaffInput): Promise<StaffMember>; // bootstrap and tests
}
// StaffMember = { id; email; fullName; role: StaffRole; status: StaffStatus; hasPassword: boolean;
//   lastSignInAt: Date | null; createdAt: Date; updatedAt: Date }
```

`StaffAuthService` (`signIn`, `refresh`, `signOut`, `profile`) and `StaffBootstrapService` are
module-internal. U2b adds `StaffService.invite`, `setPassword` and its own routes inside this
module.

**Consumed from U1** (exact names): `TransactionRepository.run()`, `TransactionContext.executor()`
and `.isActive()`, `AccessTokenService.sign()`, `ACCESS_TOKEN_TTL_SECONDS`,
`PrincipalResolverRegistry.register('staff', resolver)`, `PrincipalResolver`, `StaffPrincipal`,
`StaffRole`, `STAFF_ROLES`, `TokenAudience`, `@Public()`, `@Staff()`, `@Admin()`,
`@CurrentPrincipal()`, `@RateLimit('signInEmail', 'signInIp')`, `@NoIdempotencyStorage()`,
`@NoRequestTransaction()`, `AuditService.record()`, `sha256Hex()`, `randomToken()`, `Clock`,
`addToInstant()`, `subtractFromInstant()`, `formatCairoIso()`, `PageQuery`, `toPageRequest()`,
`toPage()`, `PageResponseOf()`, `AppError`, `ApiErrorResponses()`, `MigrationRepository.migrateLatest()`,
`loadDotenv()`, `loadConfig()`, `serializeError()`. Nothing from U3 or any other feature unit.

## Changes to earlier code

- `test/support/test-app.ts` and `types.ts`: `TestAppOptions.overrides` replaces providers by
  value. U1's guard, interceptor and logging suites register fake resolvers for both audiences
  (`TestPrincipalResolversModule`); the real `StaffPrincipalResolver` now registers `staff` too, and
  the registry refuses a second registration, so those suites pass `REAL_RESOLVERS_OFF`
  (exported from `foundations-probe.module.ts`, replacing `StaffPrincipalResolver` with an inert
  value). U9 adds its resolver to the same list.
- `test/integration/common/audit/audit.service.test.ts`: the new
  `fk_audit_events_actor_staff_user_id` needs a real staff row, so the suite creates one with
  `createStaffMember` instead of using a made-up id.
- `test/integration/common/swagger/openapi-document.test.ts`: the paths list now holds the admin
  routes, and the per-operation checks iterate every method, not only `get`.
- `src/common/swagger/swagger.constants.ts`: the `Admin: auth` and `Admin: staff` tags.
- `src/common/swagger/cross-cutting-docs.ts`: staff and admin routes also document
  `SESSION_EXPIRED`, which the staff resolver answers once a session is past its 12 hours
  (guest and customer routes are left to U9).
- `test/support/database.ts`: `resetDatabase` unchanged (`TRUNCATE … CASCADE` covers the new
  tables); `waitForLockWaiters` added.
- Long suites set `jest.setTimeout(60_000)`: the project-level `testTimeout` in
  `jest.config.js` is not applied by Jest (follow-up).

## Test support for later units

`test/support/staff-auth.ts`:

```ts
createStaffMember(testApp: TestApp, fixture: { role: StaffRole; email?: string; fullName?: string;
  password?: string }): Promise<CreatedStaffMember>; // { id, email, password, role }
// StaffService.createActiveMember; unique default email `staff-<role>-<8 hex>@test.maqady.local`,
// default password DEFAULT_STAFF_PASSWORD ('Passw0rd-staff')
signInStaff(testApp: TestApp, email: string, password: string): Promise<StaffSession>;
// StaffAuthService.signIn (no HTTP, so no rate limit)
staffSession(testApp: TestApp, role: StaffRole, fixture?): Promise<StaffSession>;
// StaffSession = { staffUserId, sessionId, email, password, accessToken, refreshToken,
//   authorization: 'Bearer …' }
```

`test/support/database.ts` also gains `waitForLockWaiters(knex, count)`, for race tests that
release a lock only once every contender queues on it.

`test/support/routes.ts`: `listHttpRoutes(testApp): HttpRoute[]` (`{ method; path; access; handler }`)
from `DiscoveryService.getControllers()`, `MetadataScanner`, `PATH_METADATA`, `METHOD_METADATA`,
U1's `accessDeclarationsOf()` and the global prefix; `samplePath(path)` replaces `:param` with `1`.

## Tests

**Unit** (`test/unit/modules/auth/`, `test/unit/modules/staff/`):

- `password.service.test.ts`: hash format and parameters; verify true/false; two hashes of one
  password differ; `null` hash returns false; malformed stored hash → `INTERNAL`.
- `password-policy.test.ts`: 7 chars, no digit, 129 chars refused; `abcdefg1` accepted.
- `session.service.test.ts` (repository mocked, fixed `Clock`): every refresh branch in order,
  including 29 s → `REFRESH_CONFLICT` without a write and 31 s → `revokeFamily('refresh_reuse')`
  then `SESSION_REVOKED`; refused inside an open transaction; rotated row keeps `expires_at`.
- `one-time-token.service.test.ts`: issue deletes earlier unused of the same owner and purpose;
  consume miss → `INVALID_TOKEN`.
- `staff-principal.resolver.test.ts`: no row → null; deactivated/invited → `ACCOUNT_DEACTIVATED`;
  revoked → `SESSION_REVOKED`; expired → `SESSION_EXPIRED`; role from the row.
- `staff.service.test.ts`: last-admin decision table; no-op change; activate without password.
- `admin-create.command.test.ts`: env parsing errors name the variable and never the value.

- `staff-auth.service.test.ts`: sign-in runs the dummy hash for unknown and password-less members;
  `ACCOUNT_DEACTIVATED` only after the password matched.

**Integration** (`test/integration/modules/staff/`, `…/auth/`, real app and Postgres):

- Sign-in: success (`201`, tokens work on `GET /admin/me`, `last_sign_in_at` set, one
  `session.created` audit row); wrong password and unknown email → `INVALID_CREDENTIALS`;
  deactivated with the right password → `ACCOUNT_DEACTIVATED`, with a wrong one →
  `INVALID_CREDENTIALS`; no session row on any failure; email case-insensitive.
- Refresh: rotation (new pair, old row `rotated_at`/`replaced_by_id`, new access token works);
  the old token again at +10 s (Clock moved) → `409 REFRESH_CONFLICT`, family still live; at
  +31 s → `401 SESSION_REVOKED`, every family row revoked, the newest access token now
  `SESSION_REVOKED`, and the revocation is committed (read back); expired family →
  `SESSION_EXPIRED`; garbage token → `VALIDATION_FAILED`, unknown well-formed → `UNAUTHENTICATED`;
  two concurrent refreshes of one token → one `201`, one `REFRESH_CONFLICT`.
- Next-request effect: after sign-out the access token → `SESSION_REVOKED`; after an admin
  deactivates a member, the member's token → `ACCOUNT_DEACTIVATED` and refresh fails; after
  demotion, the member's sessions are revoked and its token is refused on an Admin route.
- Last admin: deterministic — two parallel `StaffService.updateMember` calls in separate
  transactions demoting the last two admins → one succeeds, one `LAST_ADMIN`, exactly one active
  admin; over HTTP — admins A and B demote each other in parallel, 10 rounds: exactly one `200`
  per round and exactly one active admin; demoting or deactivating the only admin → `409 LAST_ADMIN`.
- `GET /admin/staff`: pagination across 3 pages with `nextCursor`, `total`, role and status
  filters, ordering by name then id.
- `PATCH /admin/staff/{id}`: role and status changes, `NOT_FOUND`, empty body, `status: invited`
  refused, reactivation of a never-activated member returns `invited`, deactivation deletes unused
  one-time tokens, audit row with changed field names only.
- Sign-out racing a refresh of the same family: the token the refresh issued is revoked too.
- Admin routes: every route from `listHttpRoutes()` whose access is `admin` gets a box-office
  token and answers `403 FORBIDDEN`; the list is asserted non-empty and to contain
  `GET /api/v1/admin/staff` and `PATCH /api/v1/admin/staff/:id`, so new modules are covered
  without editing the test. A customer-audience token (signed with `AccessTokenService`) on
  `GET /admin/me` → `UNAUTHENTICATED`.
- Rate limit: an app with `RATE_LIMIT_SIGN_IN_EMAIL=5/1m` and `RATE_LIMIT_SIGN_IN_IP=20/1m`: the
  6th sign-in for one email → `429 RATE_LIMITED` with `Retry-After`; 21 sign-ins with distinct
  emails from one IP → the 21st `RATE_LIMITED`.
- `admin:create`: `runAdminCreate` twice → one admin row, second run "Nothing changed"; two
  concurrent runs → one admin; captured output and logs contain neither the password nor the email.
- Contract: `npm run contract` regenerates `contracts/openapi.yaml` with the six operations and
  leaves no diff after commit.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (non-zero passes, no failures, no skips),
  `npm run build`, `npm run contract` and a clean `git status`.
- The tests above pass, proving issue #4's U2a list: sign-in success, wrong password and
  deactivated member; refresh rotation, `REFRESH_CONFLICT` within the grace window and family
  revocation after it; sign-out, deactivation and demotion take effect on the next request; two
  parallel demotions of the last two admins leave exactly one admin; every Admin route refuses a
  box-office token with `FORBIDDEN`, enumerated from the Nest router; the sign-in rate limit
  answers `RATE_LIMITED`; `admin:create` is idempotent.
- `docs/system-design.md` §5 (auth module dependencies), §6.2 (`sessions.revoked_reason`,
  `family_id UUID`), §10.2 (absolute session expiry; refresh outside the request transaction) and
  §14.1 updated; `.env.example` and README list the `BOOTSTRAP_ADMIN_*` variables.
