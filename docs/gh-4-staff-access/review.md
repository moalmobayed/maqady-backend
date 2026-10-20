---
title: U2a — Review of the staff access core
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, staff, auth, sessions, refresh-tokens, last-admin, locking]
---

# U2a — Review of the staff access core

Issue #4, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`c5c7c79..7e39253` on `unit/gh-4-staff-access`, against design §6.2, §10 (all), §11 (admin auth
and staff routes) and §15, PRD v2.0, the spec, and the `CLAUDE.md` stack rules, anti-patterns and
testing policy.

Each finding was reproduced before it was fixed. Every fix has a test that failed before it, on
this worktree's own test database (`maqady_u2a_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **A staff change deadlocked with a refresh in flight for the same member.** The last-admin lock and the target lock in `StaffRepository` took `FOR UPDATE`. That blocks the `FOR KEY SHARE` that the foreign-key check of a new `sessions` row (and of an `audit_events` actor) takes. A refresh holds the presented session row and then inserts the next one. A deactivation or demotion of that member already held the member row and was queued on that session row in `lockLiveHeads`. Postgres aborted one of them after a second: the `PATCH` is retried once by the write interceptor, but the refresh runs outside it and answered `500`. Sign-out (audit row naming the member) racing a demotion of that member had the same cycle. | A new integration test (`test/integration/modules/staff/staff.service.test.ts`): the real `SessionService.refresh`, paused in its account check, then `StaffService.updateMember` deactivating the member, then the refresh released. It failed with `deadlock detected` on the `lockLiveHeads` select. | Fixed in `989fe23`. Both locks are `FOR NO KEY UPDATE`. That still serializes every staff change, as the last-admin rule needs, and lets the foreign-key checks through. The test now passes and also proves that the token the refresh issued is revoked. Design §10.1, the spec and the index comment of `idx_staff_users_active_admins` say `FOR NO KEY UPDATE`. |
| R2 | minor | **A sign-in racing the member's deactivation opened a session that escaped the revocation.** Sign-in read the status, opened the session, and only then recorded the sign-in. A deactivation committing in between revoked every session it could see, but not the uncommitted new one, and sign-in still answered `201`. The resolver refuses the token while the member is deactivated. But the session row stayed live for 12 hours, so a reactivation within that time brought it back. | A new integration test (`test/integration/modules/staff/staff-auth.service.test.ts`): the real `updateMember` deactivation held open before its commit, a real sign-in started beside it, then the commit. The sign-in resolved with tokens and left a live session. | Fixed in `f1bab6e`. Sign-in now records itself first, with `UPDATE … WHERE id = ? AND status = 'active' RETURNING …`. The update waits for the deactivation and re-checks the status against it, so the sign-in answers `ACCOUNT_DEACTIVATED` and opens nothing. The member returned is the row as updated. A unit test covers the refusal. Design §10.1 and the spec's sign-in steps are updated. |
| R3 | minor | **Two replays of different old refresh tokens of one family deadlocked, and one answered `500`.** The reuse path revoked the family inside the transaction that had locked the presented old row. Each replay held its own old row, queued on the live head (`lockLiveHeads`), then needed the other's old row for the family `UPDATE`. A replay racing a sign-out of the same family had the same cycle. The surviving transaction still revoked the family, so the protection held, but the other caller got `INTERNAL`. | A new integration test in `test/integration/modules/auth/session.service.test.ts`: three tokens of one family, the clock 31 s on, the live head held, two replays queued on it, then released. One replay failed with `deadlock detected`. | Fixed in `1811fd6`. The rotation transaction now only decides `reused` (family and presented row). The revocation and its `session.reuse_detected` audit run in a second transaction, which locks the live heads first like every revocation. `SESSION_REVOKED` is still thrown only after that commit. Both replays now answer `SESSION_REVOKED`. The unit test asserts that the revocation runs in the second transaction. Design §10.2 and the spec are updated. |
| R4 | minor | **`admin:create` accepted an email that the staff sign-in refuses.** The command checked only `something@something`, while `POST /admin/auth/sessions` validates with class-validator's `isEmail`. `BOOTSTRAP_ADMIN_EMAIL=admin@localhost` (or `first..last@…`) created the first admin, and every sign-in then answered `400 VALIDATION_FAILED`. The operator was locked out, and a second run would not help, because an active admin now exists. | `isEmail('admin@localhost')` is false and the old shape check is true. Then a new unit test on `parseBootstrapAdminEnv` with both addresses, which failed. | Fixed in `bcc79d0`. The command uses the same `isEmail` check, and the unused `EMAIL_SHAPE` constant is removed. |
| R5 | minor | **`CLAUDE.md`'s source-directories row still lists `src/cli/` as (`migrate`, `contract`).** `admin-create.ts` is a third CLI there. | Read against `src/cli/`. The builder flagged it too. | **Open.** This review does not edit `CLAUDE.md`. The integrator, or the next `/update-docs`, adds `admin-create` to the row. |

## Checked, with nothing to report

- **Refresh rotation.** The presented row is read `FOR UPDATE`, so two refreshes of one token run
  in turn, and the second sees `rotated_at` (`REFRESH_CONFLICT`). The checks run in this order:
  unknown or other audience, revoked, expired, grace window, reuse, then the account check. A
  rotated row keeps the family's `expires_at`. A sign-out racing a refresh revokes the new token
  too, because `lockLiveHeads` waits for the refresh and the `UPDATE` that follows starts a new
  snapshot.
- **Last-admin rule.** Every change locks the active admins in id order, then the target. A
  concurrent change re-reads the locked set without the row the first change removed. A promotion
  racing a demotion can only be refused too eagerly (the new admin is not in the snapshot), never
  leave no admin.
- **Per-request check.** One query joins the session to its member by primary key. The role
  comes from the database, a token of another member's session is `UNAUTHENTICATED`, and a
  customer session is never found by the staff resolver.
- **Secrets and personal data.** Only SHA-256 hashes of refresh and one-time tokens are stored,
  and passwords are scrypt hashes. The throttler keys hash the email, request bodies and URLs are
  never logged, and audit metadata carries roles and statuses only. `admin:create` prints neither
  the email nor the password, and its problems name variables only.
- **Timing.** An unknown email, a member without a password and a wrong password all do the
  same scrypt work and answer `INVALID_CREDENTIALS`. `ACCOUNT_DEACTIVATED` comes only after a
  matching password.
- **Access.** Every route declares its access. The Admin routes are enumerated from the Nest
  router in the tests, the refresh route has the default rate limit, and sign-in has both named
  limits.
- **Conventions.** No `SELECT *`, no N+1, no inline types outside `types.ts`, no
  `HttpException`. Services throw `AppError` only. The plain `Error` in `runAdminCreate` sits at
  the CLI boundary, where it becomes the `fatal` line. Every index has its query-path comment,
  and every FK is named and covered.
- **Time.** Durations are added to instants with `addToInstant`, and responses use
  `formatCairoIso`. Nothing does offset arithmetic by hand.
- **Contract.** All six operations have a summary, a description, examples, enum names and the
  error codes the spec lists. The contract does not change with these fixes.

## Notes for later units

- **Lock staff and customer rows `FOR NO KEY UPDATE`, never `FOR UPDATE`.** Design §7.1 (lock
  order, item 4) and §7.3 (step 4) still say the principal row is locked `FOR UPDATE` when
  enforcing "one live hold". Done
  literally, a counter hold would deadlock with that staff member's refresh or audit writes,
  exactly as in R1 (and a customer hold likewise once U9 adds `fk_sessions_customer_id`). The
  unit that writes holds should use `FOR NO KEY UPDATE` and correct §7.1 and §7.3.
- **The builder's QA ran `pkill -f "node dist/main.js"`.** That pattern is not limited to this
  worktree, so another agent's local server started the same way may have been stopped at that
  moment. Nothing in this branch depends on it.
