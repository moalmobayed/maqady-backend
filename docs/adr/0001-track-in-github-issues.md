---
title: 0001 — Track work in GitHub Issues instead of Linear
status: Accepted
date: 2026-10-18
owner: Mohamed Tarek
last_verified: 2026-10-18
tags: [tracking, process, exception]
---

# 0001 — Track work in GitHub Issues instead of Linear

## Context
The Catalyst AI Starter Kit assumes Linear for tracking, on team `Catalyst-mena`, per
Engineering Standards. `/kickoff` finds or creates a Linear issue, `/ship` moves it to In
Review, branch names and commit subjects carry its `CAT-###` id, and `/flow` says outright
to never open GitHub Issues.

Catalyst-mena has no Linear project for Maqady, and the repo owner chose not to use Linear
for it at all. The code lives on GitHub at `moalmobayed/maqady-backend`, which has Issues
enabled.

`CLAUDE.md` allows a Catalyst rule to be loosened only through a recorded exception
(Engineering Standards §6.2). This record is that exception.

## Decision
This repository tracks all work in GitHub Issues on `moalmobayed/maqady-backend` and does
not use Linear. The **Tracking** section of `CLAUDE.md` carries the override that the kit's
commands follow:

- `/kickoff` searches open and closed issues, then finds or creates a GitHub issue. The
  **catalyst-linear** skill does not apply.
- A GitHub issue's `#<n>` replaces `CAT-###` everywhere, and branch names use `gh-<n>` in
  place of `cat-<id>` — e.g. `feat/gh-12-consultations-booking`.
- `/ship` links the issue from the PR body with `Closes #<n>` instead of moving a Linear
  issue.

## Consequences
- Tracking sits next to the code and PRs in one place, with no second tool or account.
- The kit's commands are written for Linear, so every run depends on the `CLAUDE.md`
  override being read and followed. A kit update that changes those commands can
  reintroduce Linear-specific steps, and `CLAUDE.md` is where to correct it.
- `/kit-doctor`'s "Linear project resolvable" check no longer applies and will not pass.
- GitHub Issues are only open or closed. There is no built-in In Progress or In Review
  state like the one the kit moves Linear issues through.
- GitHub closes an issue from a `Closes #<n>` keyword only when the PR merges into the
  default branch (`main`). PRs here are based on `staging`, so issues stay open until
  `staging` is merged into `main`, or until someone closes them by hand.
- Maqady's work is not visible from Catalyst-mena's Linear workspace.

## Alternatives considered
- **A new Maqady project in Linear, team Catalyst-mena.** The kit works unchanged this way,
  but the owner chose not to use Linear for this repository.
- **Filing under an existing Catalyst-mena project.** None of the existing projects covers
  Maqady.
