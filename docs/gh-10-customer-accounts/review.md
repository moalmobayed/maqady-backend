---
title: U9 — Review of customer accounts
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, customers, auth, sessions, password-reset, validation, contract]
---

# U9 — Review of customer accounts

Issue #10, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`8ea8887..ca0b8e5` on `unit/gh-10-customer-accounts`. It was checked against:

- design §6.2 (`customers`), §10 (all), §11 (customer auth and `/me`) and §13.1;
- PRD v2 "Accounts", C7, C12 and "New customer screens";
- the spec;
- the `CLAUDE.md` stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. Every behaviour fix has a test that failed first
on this worktree's own test database (`maqady_u9_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **A sign-in with the old password could outlive a password reset or change.** Sign-in reads the row, checks the password with scrypt, then records itself with `UPDATE … WHERE id = ? AND status = 'active'`. That update re-checked the status but not the hash. A reset (or `PUT /me/password`) that committed while the sign-in was checking first revoked every session. The sign-in then still matched, answered `201` and opened a live session with the old password. A reset exists to remove an attacker who knows the password, and this race let one stay. | A new integration test in `customer-auth.controller.test.ts` ("refuses a sign-in with the old password that raced the reset"). It holds the real `CustomerAuthService.resetPassword` uncommitted, sends a sign-in with the old password, and waits in `pg_stat_activity` until that sign-in is blocked on the row lock. Then it commits. Before the fix, the sign-in answered `201` and its session was live. | Fixed in `95b5eb9`. `recordSignIn` also matches `password_hash = <the hash checked>`. When the update matches nothing, sign-in reads the row again. A changed hash answers `INVALID_CREDENTIALS`, and a block with the same hash answers `ACCOUNT_BLOCKED`. Unit tests cover both cases. The spec's sign-in decision and steps are updated. |
| R2 | minor | **Registration with a quoted email address answered `500`.** `IsEmail` accepts RFC 5322 quoted local parts, such as `"weak user"@example.com` and `"weak@user"@example.com`. `chk_customers_email` (`^[^\s@]+@[^\s@]+$`) refuses them, so the insert failed with SQLSTATE 23514 and the route answered `500 INTERNAL`. | Two cases added to the registration validation test. Both answered `500 INTERNAL` where `400` was expected. | Fixed in `561ff57`. `RegisterCustomerRequest.email` is also checked against `STORED_EMAIL_PATTERN`, which is the CHECK's shape, and answers `VALIDATION_FAILED` with the usual message. Sign-in and forgot-password write nothing, so they are unchanged. |
| R3 | minor | **A `fullName` holding a NUL character answered `500`** on `POST /auth/registrations` and `PATCH /me`. Postgres text cannot hold NUL. | One case each in the registration and `PATCH /me` validation tests. Both answered `500 INTERNAL`. For registration, the NUL case also failed alone, with the R2 check in place and only the NUL check removed. | Fixed in `561ff57`. A NUL in the name is `VALIDATION_FAILED`: `@NotContains` on registration, and `fullNameProblem` on `PATCH /me`, which keeps one message per problem. |
| R4 | minor | **The refresh route's contract promised `ACCOUNT_BLOCKED` "once the customer was blocked".** Blocking revokes every session in the same transaction, so a blocked customer's refresh answers `SESSION_REVOKED`. A frontend built from the contract would wait for an answer that never comes. | The existing integration test "signs a blocked customer out at once" asserts `SESSION_REVOKED` on refresh after a block. The spec's refresh decision says the same. | Fixed in `413fc39`. The description now says that refresh answers `SESSION_REVOKED`, and that `ACCOUNT_BLOCKED` shows on the access token and at sign-in. `ACCOUNT_BLOCKED` stays in the listed errors for the owner check. `contracts/openapi.yaml` is regenerated. |

## Checked, with nothing to report

- **Registration.** `INSERT … ON CONFLICT (email) WHERE deleted_at IS NULL DO NOTHING` infers
  the partial unique index. Two concurrent registrations of one email give one `201` and one
  `409`, with no `23505` inside the request transaction. The password is hashed before the
  transaction opens.
- **Resolver order.** The order is: no row, another customer, or anonymised; then blocked; then
  revoked; then expired. It is one query by the session's primary key. A staff session cannot
  join `customers`, because its `customer_id` is NULL.
- **Locks.** `setStatus`, `changePassword`, `resetPassword` and `resendVerification` all lock the
  customer `FOR NO KEY UPDATE` before they revoke sessions or issue tokens. A refresh's
  foreign-key `FOR KEY SHARE` therefore passes, and no cycle with `lockLiveHeads` exists. A reset
  locks the token row, then the customer. Forgot-password takes no customer lock while it
  invalidates tokens, so the two cannot deadlock.
- **Password change.** The change keeps the caller's family through `exceptFamilyId`, and the
  revocation reaches every row of every other family, rotated rows included. With R1 fixed, a
  sign-in racing the change is also refused.
- **Reset.** A weak password is refused by the DTO before the token is touched. A block or an
  anonymisation throws inside the request transaction, so the consumed token rolls back.
- **Idempotency.** Every auth and password route is `@NoIdempotencyStorage()`. `POST /auth/tokens`
  is also `@NoRequestTransaction()`. `PATCH /me` keys are scoped per principal (U1's `scopeOf`),
  so one customer's key never replays another customer's profile.
- **Rate limits.** Email keys are trimmed, lower-cased and hashed, so changing the letter case of
  an email does not get round the per-email limit. `verificationResendCustomer` is skipped for
  anyone who is not a customer. That only happens for a token the access guard then refuses.
- **Personal data.** Nothing in the module logs. Database errors are logged by SQLSTATE and
  constraint only, so the failures R2 and R3 fixed did not leak the row either. The logging test
  covers every route that takes personal data.
- **Conventions.**
  - No inline types outside `types.ts`, no `HttpException`, plain `Error` or `SELECT *` in
    `src/modules/customers`.
  - No loop issues one query per row.
  - The migrations are raw SQL with named constraints, and every index has a comment.
  - Each new foreign key is covered by an existing index (checked in `pg_indexes`).
- **Time.** Times are formatted with `formatCairoIso`, and durations go through `addToInstant`.
  No code does arithmetic on raw milliseconds.
- **Tests.** The integration suites use the real app, Postgres and services, and replace only
  `EmailSender`. The unit suites mock collaborators only.

## Outside this unit (flagged, not fixed)

- **Staff sign-in has the same window as R1.** `StaffAuthService.signIn` re-checks only the
  status in its recorded update. Once U2b's password setup and reset routes exist, a staff
  sign-in with the old password can race them in the same way. This belongs to U2a/U2b's code,
  so U9 leaves it alone. The fix is the one used here: match the checked hash in the update.

## Gates (final, fresh)

These ran on the final committed state:

- `npm run typecheck` and `npm run lint` are clean.
- `npm test`: 622 unit and 234 integration tests pass, with no failures or skips.
- `npm run build` passes.
- `npm run contract` leaves no diff.
- `git status` is clean.
