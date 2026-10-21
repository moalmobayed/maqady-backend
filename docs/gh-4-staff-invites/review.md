---
title: U2b — Review of staff invites, password setup and the Message log
owner: Mohamed Tarek
status: Passed — 2026-10-20, no open blocker or major findings
last_verified: 2026-10-20
tags: [review, staff, invites, password-reset, one-time-tokens, message-log, locking]
---

# U2b — Review of staff invites, password setup and the Message log

Issue #4, spec [`spec.md`](spec.md), QA [`qa.md`](qa.md). Reviewed range:
`8ea8887..d14a4ae` on `unit/gh-4-staff-invites`. It was checked against design §10.1, §10.5,
§10.6, §11 (admin auth, staff and messages routes), §13.1 and §14.3, ADR 0004, PRD v2, the spec,
and the `CLAUDE.md` stack rules, anti-patterns and testing policy.

Each finding was reproduced before it was fixed. Every fix has a test that failed before it, run
on this worktree's own test database (`maqady_u2b_test`).

## Findings

| # | Severity | Finding | Verified by | Resolution |
|---|---|---|---|---|
| R1 | major | **A sign-in with the old password, racing a password reset, opened a session that outlived the reset.** Staff sign-in reads the member, checks the password against that hash, then records itself with `UPDATE … WHERE id = ? AND status = 'active'`. A password setup holds the member's row from its lock until it commits. A sign-in that had already checked the old password queued its update behind the setup. When the setup committed (new hash, every session revoked), the update matched again (the member was still `active`) and opened a fresh session. That session was never revoked. So a reset did not end the access of someone who knew the old password, which is the point of revoking sessions on reset (design §10.5). | A new integration test in `test/integration/modules/staff/staff-onboarding.service.test.ts`. A test transaction holds the member's row. The real setup queues on it first, then a real sign-in with the old password. Then the row is released. The sign-in answered `201` and left one live session. | Fixed in `c2baf0f`. `StaffRepository.recordSignIn` now also matches the password hash the password was checked against. When it misses, `StaffAuthService.signIn` re-reads the member: still `active` gives `INVALID_CREDENTIALS`, otherwise `ACCOUNT_DEACTIVATED` as before. The integration test now gets `401 INVALID_CREDENTIALS` and finds no live session. A new unit test covers the `INVALID_CREDENTIALS` branch, and the deactivated branch's unit test now states the re-read status. Design §10.1 records the rule. |
| R2 | minor | **`GET /admin/messages` answered `500 INTERNAL` for an instant with an out-of-range offset.** `isIsoInstant` (used by the new `IsIsoInstant` validator and by the cursor's `instant` kind) accepted any `±HH:MM` that Luxon parses. `from=…+99:00` and `to=…+24:00` became an invalid `Date`, which Postgres refused. A cursor whose instant had `+16:00` … `+23:59` passed `Date` but was bound as text, and Postgres refused it ("time zone displacement out of range"). | A new integration test in `test/integration/modules/messaging/message-log.controller.test.ts` (`from` `+99:00`, `to` `+24:00`, a cursor with `+99:00`): the first case answered `500 INTERNAL`. Then `psql` showed that Postgres accepts `+15:59` and refuses `+16:00`. A new unit test in `test/unit/common/time/time.test.ts` listed the offsets that were accepted. | Fixed in `c94fea6`. `isIsoInstant` now also requires an offset of at most 14 hours (`MAX_UTC_OFFSET_MINUTES`, the range real time zones use) and a value `Date` can parse. `MessageLogRepository.list` binds the cursor's instant as a `Date`, so Postgres never parses client text. All three cases are now `400 VALIDATION_FAILED`. |

## Checked, with nothing to report

- **Password setup lock order.** `findLive` reads without a lock, then the member's row is locked
  `FOR NO KEY UPDATE`, then the token is consumed, and the consume re-checks `used_at` and
  `expires_at`. The traces below found no cycle:
  - Setup and deactivation: the builder's test, re-read.
  - Setup and resend: whichever goes first wins. The resend deletes the old token, so the setup
    gets `INVALID_TOKEN`; or the setup activates the member, so the resend gets `NOT_INVITED`.
  - Two setups with one link: one `204`, one `INVALID_TOKEN`.
  - A reset setup for an admin and `updateMember` on another member: the change queues in
    `lockActiveAdmins` on the setup's row, and the setup needs nothing the change holds.
  - A reset setup and a refresh: the refresh's new session row takes `FOR KEY SHARE`, which
    `FOR NO KEY UPDATE` lets through, and the revocation's `lockLiveHeads` waits for the refresh,
    then revokes the new row.
- **Last-admin rule.** Invite, resend, reset request and setup take only the member's own row,
  not the active-admin lock. That is safe: none of them can remove an active admin. An invite
  setup can only add one, and a concurrent demotion that misses the new admin is refused too
  eagerly, never wrongly allowed.
- **Reset requests.** Only an `active` member gets a link. The request locks the row before
  issuing, so a racing deactivation either sees the new token and deletes it, or is seen first.
  The answer is `202` with an empty body for every case. The rate-limit key lower-cases and
  hashes the email. One observation, not a finding: the active-member path does more database
  work (token, message and audit inserts) than the others. That could in principle be told apart
  by timing. It was not measured, and the per-email and per-IP limits bound any probing. It is a
  candidate for U9, which builds the customer route in the same shape.
- **Secrets at rest and in the log.** The stored subject and bodies of both templates hold
  `[one-time link hidden]`, and `queue()` refuses a stored render that contains the token. The
  Message log repository names its columns and never selects `payload_ciphertext`. No new log
  line carries an email, name or token. Audit metadata holds only role, status and purpose.
- **Access.** Each of the six routes has one access decorator. The four Admin routes refuse
  box-office tokens (the builder's enumerated test). The two public routes are rate-limited
  (`emailRequestEmail` and `emailRequestIp`; `signInIp`), and their idempotency handling matches
  §11 (strict on invite and resend, never stored on auth routes).
- **Validation and errors.** Services throw only `AppError`. A malformed or unknown token is
  `INVALID_TOKEN`. A weak password fails in the DTO, so the link stays usable. The invite's
  `ON CONFLICT (email) DO NOTHING` on `citext` gives `EMAIL_TAKEN` in any letter case without
  raising `23505` inside the transaction.
- **Database.** Migration `0045_01` names the foreign key, and U3's
  `idx_messages_related_staff_user_id` covers it. `0045_02` only rewrites an index comment. There
  is no `SELECT *` and no per-row query. The Message log's keyset `(created_at, id) < (…)` matches
  `idx_messages_created_at (created_at DESC, id DESC)`. Its cursor uses `toISOString()`, which
  keeps the milliseconds that every `created_at` (from the `Clock`) has.
- **Types and Swagger.** No inline interface or type outside `types.ts`, and DTOs live in `dto/`.
  Every new operation lists its error codes. The contract shows `201`/`202`/`204`, `404`, `409`
  and the cross-cutting `401`/`403`/`413`/`422`/`429`/`500` where they apply. Nullable fields are
  marked and the enums are named (`MessageChannel`, `MessageStatus`, `StaffRole`).
- **Time.** Expiry is judged from `expires_at` at read and write time, with no timer. Lifetimes
  use `addToInstant`, and responses use `formatCairoIso`. The Message log's range is given as
  instants, so no wall-clock conversion runs on the server.

## Gates on the final state

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run contract` were run
fresh on the final commit of this review, followed by `git status`. The counts are in the review
hand-off.
