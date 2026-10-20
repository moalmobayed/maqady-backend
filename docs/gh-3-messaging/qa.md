---
title: U3 — Manual QA of messaging
owner: Mohamed Tarek
status: Passed — 2026-10-20
last_verified: 2026-10-20
tags: [qa, messaging, outbox, email, sms]
---

# U3 — Manual QA of messaging

Issue #3, spec [`spec.md`](spec.md). QA mode: `curl`.

**Environment.** Node 22.22, local PostgreSQL 16, this unit's own database `maqady_u3_dev`
(migrated at boot), port 3103, and fresh secrets from `openssl rand -base64 32`. Responses are
trimmed to the status line and the body. Database rows were read with `psql`.

U3 adds no product route that queues a message, so QA has two parts:

1. **The real app** (`npm run build`, then `node --enable-source-maps dist/main.js`): the
   migration, readiness, the published description, and refusal of bad email configuration.
2. **A QA-only harness** on the same port. It is the same `AppModule`, compiled with `tsc` into a
   scratch directory together with the test-only probe routes of
   `test/support/messaging/messaging-probe.module.ts` and the test templates
   `test.one_time_link` and `test.sms_notice`. It is not part of the repository. It queues
   messages through the real `MessagingService` in the real request transaction. It ran twice:
   - with `EMAIL_DRIVER=simulated`;
   - with `EMAIL_DRIVER=resend` and a fake key.

   In this sandbox the egress proxy refuses `api.resend.com` (`connect_rejected`), so the Resend
   run exercises the real `fetch` failing and the retry path. Resend's own answers (2xx, 429
   quotas, 4xx, 5xx) are covered by the tests: the unit tests with `fetch` mocked, and
   `test/integration/modules/messaging/senders/resend-email.sender.test.ts`, the real app with
   the resend driver and only `fetch` replaced.

## 1. The real app

### Migration and row-level security

```
$ psql -d maqady_u3_dev -Atc "SELECT name FROM maqady.knex_migrations ORDER BY id"
0010_01_create_schema
0020_01_create_idempotency_keys
0020_02_create_audit_events
0030_01_create_messages
$ psql -d maqady_u3_dev -Atc "SELECT relrowsecurity FROM pg_class WHERE oid = 'maqady.messages'::regclass"
t
```

`\d maqady.messages` shows the five indexes, `idx_messages_due` as the partial
`(next_attempt_at, id) WHERE status = 'queued'`, and all seven `chk_messages_*` constraints.

### Readiness and the published description

```
$ curl -i localhost:3103/api/v1/health/ready
HTTP/1.1 200 OK
Cache-Control: no-store
{"status":"ok"}

$ curl -s localhost:3103/api/docs/openapi.json | jq -r '.paths["/health/ready"].get.description'
Public; anyone may call it. Runs one trivial query. Answers `200` when the database responds, and
`503 SERVICE_UNAVAILABLE` when it is unreachable or times out (within about 10 seconds). After a
`200` it starts sending queued email and SMS in the background; the answer never waits for that.
```

### Bad email configuration stops the boot, naming variables but never values

```
$ EMAIL_DRIVER= node dist/main.js
Boot failed | Invalid environment configuration:
- EMAIL_DRIVER is required

$ EMAIL_DRIVER=resend RESEND_API_KEY= EMAIL_FROM= node dist/main.js
Boot failed | Invalid environment configuration:
- RESEND_API_KEY is required when EMAIL_DRIVER is resend
- EMAIL_FROM is required when EMAIL_DRIVER is resend

$ EMAIL_DRIVER=resend RESEND_API_KEY='re_TopSecret x' EMAIL_FROM=not-an-address \
  FRONTEND_BASE_URL='https://maqady.example/?x=1' node dist/main.js
Boot failed | Invalid environment configuration:
- FRONTEND_BASE_URL must be an http:// or https:// URL such as https://maqady.example, with no query or fragment
- RESEND_API_KEY must be an API key with no spaces
- EMAIL_FROM must be an address such as tickets@maqady.example or Maqady <tickets@maqady.example>
```

The key's value (`re_TopSecret x`) appears nowhere in the output.

## 2. The harness, `EMAIL_DRIVER=simulated`

### A committed email is sent right after commit; the stored copy hides the link

```
$ curl -X POST localhost:3103/api/v1/test-messaging/emails -H 'Content-Type: application/json' \
  -d '{"recipient":"layla@example.com","name":"Layla","token":"QaTok3n_9f8e7d6c5b4a3210zyxwvu","relatedCustomerId":7}'
HTTP/1.1 201 Created
{"ids":[1]}
```

```
 id | channel |      template      | status | attempts | last_error_code | has_next | has_payload | provider_message_id | has_sent_at | related_customer_id
----+---------+--------------------+--------+----------+-----------------+----------+-------------+---------------------+-------------+---------------------
  1 | email   | test.one_time_link | sent   |        1 |                 | f        | f           | simulated-email-1   | t           |                   7

 id |          subject          |                 body_text
----+---------------------------+--------------------------------------------
  1 | Confirm your email, Layla | Hello Layla,
    |                           |
    |                           | Confirm your email: [one-time link hidden]
    |                           |
    |                           | The link works once, for 24 hours.

 id | token_found | html_redacted | html_links
----+-------------+---------------+------------
  1 |           0 | t             |          0
```

- The token appears nowhere in the subject or the bodies (`position(...) = 0`).
- The HTML holds the redacted text and no `href`.
- The encrypted payload was cleared once the message was sent.

### A rolled-back write stores and sends nothing

```
$ curl -X POST localhost:3103/api/v1/test-messaging/emails -H 'Content-Type: application/json' \
  -d '{"recipient":"omar@example.com","name":"Omar","token":"RolledBackToken_123","count":3,"fail":true}'
HTTP/1.1 409 Conflict
{"error":{"code":"CONFLICT","message":"Probe failure after queueing.","details":null,"correlationId":"7dc24984-…"}}

 messages_after_rollback
-------------------------
                       1
```

Only the earlier message remains, and no delivery log line was written for the three rolled-back
messages. Their ids (2 to 4) were consumed by the sequence, as Postgres sequences always are.

### SMS goes through the outbox and the simulated sender

```
$ curl -X POST localhost:3103/api/v1/test-messaging/sms -H 'Content-Type: application/json' \
  -d '{"recipient":"+201001234567","text":"Your showtime moved to 21:30."}'
HTTP/1.1 201 Created
{"id":5}

 id | channel |    template     | status | attempts | has_payload | provider_message_id | has_sent_at | no_subject | no_html
----+---------+-----------------+--------+----------+-------------+---------------------+-------------+------------+---------
  5 | sms     | test.sms_notice | sent   |        1 | f           | simulated-sms-5     | t           | t          | t
```

### A recipient the caller did not validate is a programming error

```
$ curl -X POST localhost:3103/api/v1/test-messaging/emails -H 'Content-Type: application/json' \
  -d '{"recipient":"not-an-email","name":"X","token":"abcdef"}'
HTTP/1.1 500 Internal Server Error
{"error":{"code":"INTERNAL","message":"A message recipient is not a valid email address.","details":null,"correlationId":"4585b195-…"}}
```

The recipient is not echoed.

### Log lines carry ids and outcomes, never personal data

```
{'context': 'SimulatedEmailSender', 'msg': 'Simulated email recorded as sent', 'messageId': 1}
{'context': 'OutboxDrainService', 'msg': 'Message delivery attempt', 'messageId': 1, 'template': 'test.one_time_link', 'channel': 'email', 'outcome': 'sent', 'errorCode': None, 'attempts': 1}
{'context': 'SimulatedSmsSender', 'msg': 'Simulated SMS recorded as sent', 'messageId': 5}
{'context': 'OutboxDrainService', 'msg': 'Message delivery attempt', 'messageId': 5, 'template': 'test.sms_notice', 'channel': 'sms', 'outcome': 'sent', 'errorCode': None, 'attempts': 1}
--- log lines mentioning a recipient or a token: 0
```

## 3. The harness, `EMAIL_DRIVER=resend` (Resend unreachable from the sandbox)

The harness ran with `RESEND_API_KEY=re_qa_not_a_real_key`, the sender
`Maqady QA <qa@maqady.example>`, and Resend's test recipient `delivered@resend.dev`.

### A network failure is a counted retry with a 1-minute backoff

```
$ curl -X POST localhost:3103/api/v1/test-messaging/emails -H 'Content-Type: application/json' \
  -d '{"recipient":"delivered@resend.dev","name":"Nour","token":"ResendQaToken_abcdef0123","count":2}'
HTTP/1.1 201 Created
{"ids":[1,2]}

 id | status | attempts | last_error_code | has_next | has_payload | provider_message_id | has_sent_at | backoff
----+--------+----------+-----------------+----------+-------------+---------------------+-------------+----------
  1 | queued |        1 | network_error   | t        | t           |                     | f           | 00:01:00
  2 | queued |        1 | network_error   | t        | t           |                     | f           | 00:01:00
```

The payload is kept, encrypted, so a later attempt can rebuild the real link. For QA only, the
next step skips the backoff:
`UPDATE maqady.messages SET next_attempt_at = now() - interval '1 second'`.

### A read does not drain; readiness and any write do

```
$ curl localhost:3103/api/v1/test-messaging/ping
HTTP/1.1 200 OK
{"ok":true}
 id | status | attempts | last_error_code
  1 | queued |        1 | network_error        ← unchanged
  2 | queued |        1 | network_error

$ curl localhost:3103/api/v1/health/ready
HTTP/1.1 200 OK
{"status":"ok"}
 id | status | attempts | last_error_code | backoff
  1 | queued |        2 | network_error   | 00:05:00   ← drained after the answer; second backoff
  2 | queued |        2 | network_error   | 00:05:00

(made due again)
$ curl -X POST localhost:3103/api/v1/test-messaging/noop
HTTP/1.1 204 No Content
 id | status | attempts | last_error_code
  1 | queued |        3 | network_error        ← drained after the write committed
  2 | queued |        3 | network_error
```

Six delivery lines were logged, `outcome: 'retry'` and `errorCode: 'network_error'`, with
attempts 1, 2 and 3. No log line mentions the recipient, the token or the API key (`grep -c`
gives 0).

## Result

| Check | Result |
|---|---|
| Migration `0030_01_create_messages` applied at boot, with row-level security | Pass |
| Readiness answers `200`, and its published description states the drain | Pass |
| A bad or missing `EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM` or `FRONTEND_BASE_URL` stops the boot without echoing values | Pass |
| Commit sends at once and records `sent` with the provider id; the payload is cleared | Pass |
| Stored subject and bodies never hold the token; the link is redacted, and the HTML has nothing to click | Pass |
| A rollback stores and sends nothing | Pass |
| SMS goes through the outbox and is recorded as sent by the simulated sender | Pass |
| A network failure is a counted retry with backoff, and keeps the encrypted payload | Pass |
| A read triggers no drain; readiness and writes do | Pass |
| No log line carries a recipient, a token or the key | Pass |

The dev database's `messages` table was emptied after QA. Nothing is left running on port
3103.
