---
title: 0002 — Build the API on NestJS instead of plain Express
status: Accepted
date: 2026-10-18
owner: Mohamed Tarek
last_verified: 2026-10-18
tags: [stack, framework, exception]
---

# 0002 — Build the API on NestJS instead of plain Express

## Context
This repo runs the Catalyst `catalyst-node-service` pack. The pack locks the stack to
TypeScript · Express · Knex · PostgreSQL · Redis · Docker and forbids introducing another
framework. Its build order (routes, a route index, manual container registration) is
written for a hand-wired Express app.

Maqady is a practice project, built to production quality but not launched with real money.
The owner chose NestJS for the API because learning NestJS is one of the project's goals.

The API also needs one WebSocket endpoint: clients follow a showtime and receive seat held,
released and booked events for the live seat map. The frontend uses the browser's built-in
`WebSocket`, so the server has to speak plain WebSocket, not the socket.io protocol.

NestJS's default HTTP adapter is `@nestjs/platform-express`, so Express is still the HTTP layer
underneath. The exception covers the application framework on top of Express (modules,
dependency injection, controllers, guards, pipes, interceptors), not a different server.

`CLAUDE.md` allows a pack rule to be loosened only through a recorded exception. This record
is that exception.

## Decision
The API is a NestJS application:

- HTTP runs on `@nestjs/platform-express`.
- The live seat map is a NestJS gateway on `@nestjs/platform-ws`, which uses plain `ws`, not
  socket.io.
- OpenAPI is generated from the code with `@nestjs/swagger` for the frontend developer.

Everything else in the pack still applies: Knex with hand-written, append-only raw SQL
migrations, PostgreSQL conventions and constraints, JWT access and refresh tokens, RBAC with
server-side ownership checks, cursor pagination, idempotent writes, and the testing policy.
`CLAUDE.md`'s Stack, Build order and Stack rules restate the pack in NestJS terms.

Claude's calls, made while translating the pack to NestJS (open to veto):

- **No ORM integration.** NestJS's documentation leans on TypeORM, Prisma and MikroORM; none of
  them is used. A single Knex instance is exposed as a custom provider and injected into
  repositories. Correctness lives in database constraints, not in an ORM.
- **DTOs are classes** validated by a global `ValidationPipe` (whitelist, reject unknown
  properties, transform), because `@nestjs/swagger` builds the OpenAPI document from DTO
  classes. The pack's zod skill does not apply to request validation here.
- **Deny by default** through globally registered authentication and roles guards
  (`APP_GUARD`). A route is public only when it is explicitly marked public.
- **Services throw `AppError`**, the pack's error type, and one global exception filter maps it
  to the HTTP response.

## Consequences
- Wiring that the pack does by hand (routes, the route index, container registration) is done
  by Nest modules, decorators and dependency injection. The Build order in `CLAUDE.md` is
  rewritten to match, and kit agents follow `CLAUDE.md` rather than the pack's Express
  defaults.
- Because Express stays underneath, Express middleware (for example security headers) can
  still be used. The pack's Express-specific guidance mostly remains relevant.
- There is more framework to learn and more ceremony per module: modules, providers,
  decorators, guards, pipes. That ceremony is accepted on purpose, since learning it is the
  point.
- Nest's guides and generators assume an ORM and put `*.spec.ts` files next to the source.
  This repo uses neither convention: repositories use Knex, and tests live under `test/` as
  the testing policy says. Generated code has to be adjusted to fit.
- Generating OpenAPI from the code makes the code the source of the contract. This conflicts
  with the pack's "contracts win" review dimension (`contracts/openapi.yaml`). That conflict
  is not resolved here.
- Pack skills written for Express (`express-typescript`, `zod-schema-validation`) apply only
  loosely. The Knex, PostgreSQL, JWT, RBAC and testing skills apply as they are.

## Alternatives considered
- **Express, as the pack ships it.** The kit works unchanged this way, but it defeats the
  owner's goal of learning NestJS.
- **NestJS on the Fastify adapter.** It moves further from the pack, because Express
  middleware and Express-specific guidance stop applying. It offers no benefit this project
  needs.
- **NestJS with TypeORM or Prisma.** The pack forbids an ORM, and the project wants its
  correctness rules, such as one active booking per seat and no overlapping showtimes in a
  hall, enforced as database constraints written in SQL.
- **socket.io for the live seat map.** The frontend contract is the browser's built-in
  `WebSocket` with no client SDK, and socket.io needs its own client library.
