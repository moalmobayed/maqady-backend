---
title: 0003 — Keep idempotency keys in Postgres instead of Redis
status: Accepted
date: 2026-10-19
owner: Mohamed Tarek
last_verified: 2026-10-19
tags: [stack, idempotency, exception]
---

# 0003 — Keep idempotency keys in Postgres instead of Redis

## Context
The `catalyst-node-service` pack puts Redis in the stack and requires a Redis-backed
idempotency interceptor on every write. In Maqady, the writes that most need it are holding
seats, paying, refunding and cancelling: pressing a button twice must never charge or refund
twice.

Maqady runs on free hosting: one Render web service and a Supabase project. Neither includes
Redis, and the free Redis options each have a catch:

- **Upstash free.** 256 MB and 500,000 commands a month, as a separate account and service,
  with an extra network hop on every write.
- **Render's free Key Value.** It keeps data only in memory and loses all of it on restart, so
  keys would vanish exactly when a retry after a crash needs them.

Postgres already holds every row these writes change. `CLAUDE.md` allows a pack rule to be
loosened only through a recorded exception. This record is that exception.

## Decision
- Idempotency keys live in a Postgres table, `idempotency_keys`, unique on (scope, key).
- One write interceptor opens the request's database transaction, inserts the key row, runs the
  handler and stores the response in that same transaction.
- A concurrent duplicate waits on the unique index and then replays the stored response. A key
  is treated as absent 24 hours after it was created.
- Rate-limit counters (`@nestjs/throttler`) and the seat-map WebSocket fan-out stay in the
  process's memory.
- Redis leaves the stack. `CLAUDE.md`'s Stack and Idempotency rules say Postgres instead.

## Consequences
- **No extra service.** There is nothing else to sign up for, secure or keep within a quota.
- **Atomic with the write.** A key and the change it protects commit or roll back together. A
  crash can never leave a key without its write, or a write without its key, which a separate
  store couldn't guarantee.
- **Every protected write adds a row.** It stays small inside the free plan's 500 MB, because
  writes opportunistically delete a small batch of expired keys. That deletion only tidies up;
  expiry is judged from the stored time when a key is read.
- **Single instance only.** Rate-limit counters reset when the service restarts or sleeps, and
  aren't shared between instances. The same holds for WebSocket fan-out. Both are acceptable
  for one free instance. Running more than one would need shared counters and Postgres
  `LISTEN/NOTIFY`, or Redis then.
- **Diverges from the pack.** Pack guidance that assumes Redis doesn't apply here.

## Alternatives considered
- **Upstash free Redis.** It follows the pack as written, but adds a service, a network hop per
  write and a monthly command quota. It also can't commit atomically with the Postgres write
  it protects.
- **Render's free Key Value.** The same platform as the API, but the data lives only in memory,
  so idempotency fails exactly after a restart.
- **Keys in process memory.** Lost on every restart or sleep, which is exactly when a client
  retries. Unsafe for payments.

Sources: [Render free tier](https://render.com/docs/free),
[Render Key Value](https://render.com/docs/key-value),
[Upstash Redis pricing](https://upstash.com/pricing/redis).
