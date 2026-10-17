# maqady-backend — Claude project context

Repo: `moalmobayed/maqady-backend` · Default branch: `main` · Integration branch:
`staging` (defaults to the default branch above when this repo has no
separate integration branch — `/ship` bases its PR on this) · Tracking:
**GitHub Issues** on this repo — no Linear project (see **Tracking** below).

This repo runs the **Catalyst AI Starter Kit**. Run `/kit-doctor` if anything here looks
stale.

## How we work

`/flow <unit>` runs the workflow. Each phase is also callable on its own:
`/kickoff` → `/brainstorm` → `/construct-spec` → `/develop` → `/write-tests` →
`/manual-qa` → `/review-code` → `/update-docs` → `/ship`.

`/flow` drives phases 0–7 and then stops. **`/ship` is yours to run** — it pushes the branch
and opens the pull request, so it stays a deliberate action rather than something a run
performs on your behalf.

Documentation lives in per-unit folders (`docs/<unit>/`) plus the stable layers
(`docs/INDEX.md`, `docs/adr/`, `docs/architecture/`). See the **catalyst-docs** skill.

Branching, commits, and push discipline: the **catalyst-git-workflow** skill.

### Tracking

**This repo tracks work in GitHub Issues on `moalmobayed/maqady-backend`, not Linear.** This
overrides every place the kit's commands and skills assume Linear, including `/flow`'s
"never open GitHub Issues":

- `/kickoff` finds or creates a **GitHub issue** (search open and closed issues before
  creating), not a Linear issue. The **catalyst-linear** skill does not apply here.
- Wherever the kit cites a `CAT-###` id, use the issue's `#<n>`; in a branch name use
  `gh-<n>` in place of `cat-<id>` — e.g. `feat/gh-12-consultations-booking`.
- `/ship` links the issue from the PR body (`Closes #<n>`) instead of moving a Linear issue
  to In Review.

## Catalyst standards

These pages are **binding for every Catalyst repository**. This file may tighten a rule; it
may only loosen one through a recorded exception (Engineering Standards §6.2).

| Page | Governs |
|---|---|
| [Engineering Standards](https://github.com/Catalystsw/int-engineering-docs/wiki/Engineering-Standards) | Tracking, branching, commits, PRs, the ten review dimensions, ADRs and exceptions |
| [Delivery and Release](https://github.com/Catalystsw/int-engineering-docs/wiki/Delivery-and-Release) | Testing tiers, CI gates, environments, shipping and un-shipping |
| [Production Operations](https://github.com/Catalystsw/int-engineering-docs/wiki/Production-Operations) | Logging, observability, incident response |
| [Security Standards](https://github.com/Catalystsw/int-engineering-docs/wiki/Security-Standards) | How to build it secure, and the checklists that prove it |
| [Repository Naming](https://github.com/Catalystsw/int-engineering-docs/wiki/Repository-Naming-Conventions) | How repositories are named |

Your stack pack adds the pages that govern **its** stack — see **Stack rules** below.

**What an agent enforces without fetching these.** The rules a review must apply are vendored
into the kit — the ten dimensions live in `/review-code`, and the stack-specific conventions
live in **Stack rules** and **Testing policy** below. The pages above are the source of truth
and the fuller explanation; when the two disagree, that is a bug worth reporting, because they
are meant to change in the same pull request.

## Verification commands

The six gates shell out to these. Keep them accurate — a gate that runs a command which
does not exist is worse than no gate.

| Purpose | Command |
|---|---|
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Test | `npm test` |
| Build | `npm run build` |

## Quality gates

| | Gate | Enforced at |
|---|---|---|
| G1 | Static checks — typecheck and lint pass | before any task flips to `[x]` |
| G2 | Test — red-before-green honored where it binds (fix-review findings, bugfixes, and any behavior added during `/write-tests`); suite green with a **nonzero pass count**, and tests genuinely assert behavior | end of `/write-tests` |
| G3 | QA — `manual-qa.md` recorded with evidence | end of `/manual-qa` |
| G4 | Review — zero OPEN findings | end of `/review-code` |
| G5 | Doc hygiene — frontmatter fresh, INDEX current, no drift | end of `/update-docs` |
| G6 | Verification before completion — evidence, not assertion | every phase boundary |

Every gate demands **pasted fresh command output**. "It compiled" is not evidence.

Read the test summary, not the exit code. Most runners exit `0` when they find no test files
at all, so an empty suite and a passing suite look identical from the shell. G2 is satisfied
by a real pass count, never by a clean exit alone.

Typecheck and lint run per task because they are fast. The **build** command is not a
per-task gate — it runs once as a `/ship` precondition, and again in CI. Skipping it
locally is how a build break first shows up as a red PR.

## Ground rules

1. **Plan before code.** No edits to implementation files before the plan is approved.
2. **Red before green, where it binds.** A fix for a review finding, and any bugfix, gets a
   test that fails before the fix (reproduce, then fix). A unit built from a spec has its
   coverage authored afterward in `/write-tests` — for that case the honest bar is a green
   suite whose tests genuinely assert behavior rather than restate the implementation. Any
   behavior added or changed *during* `/write-tests` or a fix round is held to red-before-green
   like any other bugfix.
3. **Verify before claim.** Paste the output. Compiled is not done.
4. **One topic per PR.** No incidental refactors bundled with a feature.
5. **Touch only what the task requires.** Flag adjacent problems; do not fix them.
6. **Simplest thing that works.** KISS and YAGNI over cleverness.
7. **Never merge.** `/ship` opens the PR; a human merges.
8. **Commit as you go.** `/develop`, `/write-tests`, and `/update-docs` each commit their own
   completed work once that phase's gate passes — see the **catalyst-git-workflow** skill.
   `/ship` never commits; it only pushes what is already committed.

## Source directories

None yet — the repository has no source directories. List each top-level source
directory here as it is created.

## Hub-and-spoke docs

**Disabled.** Set this to Enabled and name the hub path if this repo is one service in a
multi-service platform whose platform-level docs live elsewhere.

## Stack

TypeScript · Express · Knex · PostgreSQL · Redis · Docker. The stack is **locked** — never
introduce another ORM, query builder, or framework.

**Verification commands come from:** the `scripts` block of `package.json`.

**Binding standards for this stack** — read alongside **Catalyst standards** in `CLAUDE.md`:
[Backend and API Standards](https://github.com/Catalystsw/int-engineering-docs/wiki/Backend-and-API-Standards) is the default model for every
Catalyst backend service, and [PostgreSQL Standards](https://github.com/Catalystsw/int-engineering-docs/wiki/PostgreSQL-Standards) is the authority
on database conventions — where any rule below names a table, column, index or constraint,
that page is what it means.

## Build order

Build one module end to end, in this order. Do not start the next artifact until the
previous one compiles.

1. migration
2. entity
3. request DTOs
4. response DTOs
5. repository
6. service (register in the container)
7. controller (register in the container)
8. routes
9. mount in the route index

## Stack rules

- **Naming.** DB: tables plural `snake_case`; PK `id BIGSERIAL`, FK `BIGINT` + `fk_…` +
  covering `idx_…`; enum-likes `VARCHAR CHECK` matching `enums.ts`; money `INT` minor units
  (e.g. `price`) + `currency VARCHAR(3)`, never `DECIMAL`; timestamps `TIMESTAMPTZ` UTC;
  soft-delete `deleted_at TIMESTAMPTZ` on any row that is ever retracted rather than
  removed. Routes: plural nouns, `PATCH` for partial updates.
- **Database.** Raw SQL migrations only, append-only, each index commented with its query
  path. `TIMESTAMPTZ` everywhere (UTC). Every FK named and covered by an index; no
  defaults on critical columns; composite index order = equality then range. **No N+1** —
  batch reads with `whereIn`; never one query per row inside a loop.
- **Pagination.** Cursor-based, on every list endpoint.
- **Idempotency.** Redis-backed middleware on all writes; `strict:true` on any write whose
  duplicate submission must not double-apply (client-supplied `Idempotency-Key`).
- **Security.** RBAC + ownership on every endpoint, deny-by-default; role comes from the
  verified JWT, ownership resolved server-side. Return `404` (not `403`) for cross-owner
  access to a sensitive resource. Rate-limit public endpoints. No PII in logs.
- **Inline types are forbidden.** No `interface`/non-trivial `type` inside
  service/controller/repo/client/handler/middleware files — it belongs in `types.ts`.

## Anti-patterns

- Introducing an ORM, a second query builder, or a second HTTP framework. The stack is
  locked.
- Controllers returning entities instead of response DTOs.
- `SELECT *` anywhere — repositories name their columns explicitly.
- One query per row inside a loop (N+1) — batch with `whereIn`.
- Throwing a plain `Error` from a service, or a silent `catch`. Every service error is an
  `AppError`; every `catch` re-throws or maps.
- Trusting a client-supplied user-identity header. The acting user always comes from the
  verified JWT, never from a header the caller controls.
- Inline offset/millisecond math on timestamps — DST-unsafe; use the shared time helpers.
- Logging PII or sensitive payload fields. Structured logs carry a `correlationId`, never
  the data itself.

## QA mode

`curl`

## Testing policy

- **Unit** — one unit in isolation; collaborators mocked. This is the only place mocking a
  repository, service, or datastore is allowed. Infrastructure-failure scenarios ("the
  datastore is down → 503") are unit tests of the handler and belong here. File location:
  `test/unit/`, mirroring `src/`'s path (e.g. `src/services/user.service.ts` →
  `test/unit/services/user.service.test.ts`).
- **Integration** — real wiring: real services, real repositories, a real database. **Never
  mock a service, repository, or datastore.** Mock only what is genuinely external (a
  third-party HTTP API, email, SMS). Seed and clean state through real calls; reset state
  per suite in teardown. File location: `test/integration/`, mirroring `src/`'s path (e.g.
  `src/routes/users.ts` → `test/integration/routes/users.test.ts`).
- Never add an infrastructure mock to shared test setup — a global mock leaks into the
  integration suites and makes them lie.

## Extra review dimensions

- **Contract drift** — code and `spec.md` against `contracts/openapi.yaml`. Contracts win.
- **Service-to-service auth** — every internal endpoint verifies the service token; no
  internal route is reachable with a user token alone.
