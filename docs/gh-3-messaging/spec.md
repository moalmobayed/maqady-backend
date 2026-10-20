---
title: U3 — Messaging - outbox, Resend email, simulated SMS
owner: Mohamed Tarek
status: Implemented — 2026-10-20
last_verified: 2026-10-20
tags: [messaging, outbox, email, resend, sms, templates]
---

# U3 — Messaging: outbox, Resend email, simulated SMS

Issue: #3. Migration prefix `0030`. Depends on U1 (`docs/gh-2-foundations/spec.md`). Design:
`docs/system-design.md` §5, §6.1, §6.2 (`messages`), §11, §13.1, §14, §16 and
[ADR 0004](../adr/0004-email-through-resend.md); PRD v2 "Email and SMS" and "Message log".

## Goal

Any module can say "send this person this message" inside its own write transaction and trust
that:

- a rolled-back change stores and sends nothing;
- a committed one is sent right after the commit, through a replaceable sender;
- failures are retried on later activity, never by a timer;
- no stored copy ever holds a usable one-time link.

Email goes out through Resend behind `EmailSender`; SMS is simulated behind `SmsSender`.

## Scope

- The `messages` table: the outbox and the delivery log. The template parameters are stored
  encrypted while a message can still be sent, and cleared once it is sent.
- `MessagingService.queue()`: inserts in the current transaction and registers a post-commit
  drain.
- `MessageTemplateRegistry`: typed templates, two link builders (delivery and storage, which
  redacts one-time links) and `renderSimpleHtml()`. The only templates here are test-only.
- `EmailSender` with `ResendEmailSender` and `SimulatedEmailSender`; `SmsSender` with
  `SimulatedSmsSender`.
- `OutboxDrainService`: claims up to 10 due messages with `FOR UPDATE SKIP LOCKED` and sends
  them. It runs after every committed write request, after each `queue()` commit, and after a
  `200` from `GET /health/ready`.
- Configuration: `FRONTEND_BASE_URL`, `EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM`. Update
  `.env.example` and the README.
- Design edits, recorded as deviations: §5, §6.2 (`messages`), §13.1, §14.5 and §16.

## Out of scope

- The Message log API (`GET /admin/messages`, `GET /admin/messages/{id}`) belongs to U2b, which
  adds a read service and a controller inside `src/modules/messaging/`.
- Every product template belongs to the unit that owns the trigger: staff invite and reset
  (U2b); verification and customer reset (U9); tickets, moves and cancellations (U7, U10+).
- Foreign keys on the `related_*_id` columns. They come with the units that create the tables:
  `staff_users` (U2a), `customers` (U9) and `bookings` (U10). Deleting a customer's messages on
  anonymisation belongs to U15.
- Real SMS delivery. Retention or purging of old messages (design §20).

## Decisions taken here

The spec draft raised five open questions. Each is decided below.

| Decision | Why |
|---|---|
| **Templates are defined in the module that owns the trigger** (`src/modules/<owner>/templates/*.template.ts`) and registered in that module's `onModuleInit()`. They do not live in `messaging/templates/`. *Open question 5; deviation from §13.1, recorded there.* | This keeps `messaging` dependent on nothing (§5) while units build in parallel. The registry still gives one place to look templates up by name. |
| **Template parameters are stored as `payload_ciphertext`** while a message is `queued` or `failed`, and cleared on `sent`. Encryption is AES-256-GCM through `DataEncryptionService`, with AAD `messages:<id>`. *Deviation from §6.2 and §13.1, recorded there.* | A retry must rebuild the real link, but the stored bodies and the Message log must never show it. The AAD stops a ciphertext from being copied to another row. |
| The stored `subject`, `body_text` and `body_html` are rendered with the storage link builder. The sent copy is rendered again at send time, from the decrypted parameters, with the delivery link builder. | One template function and two link builders, so the two copies differ only by the link. |
| A redacted one-time link is the literal text `[one-time link hidden]`. | Nothing in the log is clickable or guessable. |
| `queue()` refuses (`INTERNAL`) a stored render that contains the value of any parameter the template lists in `secretParams`. | Defence in depth: a template that forgets `links.oneTime()` fails loudly in tests instead of silently leaking into the log. |
| `queue()` runs inside `TransactionRepository.run()`, so it joins the open transaction or opens one. | The outbox guarantee is the same from a write request, from a GET path's own short transaction, or from a CLI. |
| The post-commit hook only calls `OutboxDrainService.requestDrain()`. It never waits on the network. | A showtime cancellation can queue hundreds of messages, and the response must not wait on Resend. |
| SMS also goes through the outbox. `SimulatedSmsSender` answers `sent` on the first attempt, right after commit. | One send path for both channels; a real SMS provider later swaps only the sender. §13.1's "recorded as sent immediately" is reworded to say so. |
| **The claim** is one autocommit statement: `WITH due AS (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 10) UPDATE messages SET next_attempt_at = now + 5 min … RETURNING …`. Sending happens outside any transaction. | No connection is held across a network call (pool of 5, §14.2). The 5-minute lease outlasts a full batch (10 sends × 10 s timeout, plus pacing), so a second drain can't re-claim a row that is still being sent. After a crash, the row is retried once the lease ends, and Resend's idempotency key stops a double send. |
| **`failed` is terminal.** Only `queued` rows are drained, and the payload of a failed message is kept, encrypted. Nothing resends a failed message: U2b's Message log is read-only. *Open question 3; corrects §13.1's "queued and failed are retried".* | A validation error never succeeds on a retry. The one-time tokens a kept payload holds expire within 24 hours, so the kept ciphertext is not a usable secret for long. Purging old payloads goes with retention (§20). |
| **Retry cap and backoff.** At most 10 attempts; the 10th retryable failure becomes `failed` with `last_error_code = 'attempts_exhausted'`. After retryable attempt *n* the message waits 1 min, 5 min, 15 min, 1 h or 3 h, then 6 h for every later attempt. *Open question 2.* | The design says nothing on this. An endless retry would hide a broken message forever. The schedule spans about 28 hours, so a short Resend outage or a key fixed the next morning still delivers. Times are computed with `addToInstant()`. |
| A `429` does not count as an attempt. | A rate or quota refusal says nothing about the message itself. |
| A `429` stops the rest of the batch. Every other claimed email gets the same `next_attempt_at`; SMS rows in the batch are still sent. | Sending on into a quota wall wastes calls and log lines. |
| **The monthly quota** (`monthly_quota_exceeded`) waits until the next 00:00 UTC, exactly like the daily quota. It does not wait for the 1st of the month. *Open question 4.* | The Resend plan's monthly window may follow the billing date, which the service can't know. A 429 stops the batch, so probing once a day costs at most one refused call per day. The message goes out on the first day the quota allows. |
| `ResendEmailSender` leaves at least 500 ms between two calls in one process. | Resend's default rate limit is 2 requests per second. Pacing keeps a 10-message batch under it, instead of stopping on a `rate_limit_exceeded` 429. Pacing only spaces calls; it decides nothing about correctness. |
| Write requests drain one batch. `GET /health/ready` drains batches until one claims nothing, a 429 is seen, or 10 batches have run. | The daily keep-alive ping flushes the queue (§16) without an unbounded loop. 10 batches are 100 emails, the free plan's daily cap. |
| Drains in one process are coalesced: one runs at a time, and at most one more is queued. | A burst of writes does not open many connections. `drain()` itself is not coalesced, so drains across processes (and in tests) still race through the database. |
| The trigger on write requests is a global interceptor (`OutboxDrainInterceptor`). It requests a drain when the handler's result completes; errors trigger nothing. It is registered before `WriteInterceptor`, so its completion follows the commit. | A drain must follow the commit. A handler marked `@DrainOutboxAfterResponse()` (readiness) drains in `flush` mode. |
| `EMAIL_DRIVER` is required (`resend` or `simulated`). | A deploy that forgot it must not boot and silently drop email. |
| **The Resend `Idempotency-Key` is the message id** as a decimal string. Only one environment sends through a given Resend team (production); local runs and CI use `EMAIL_DRIVER=simulated`. Another sending environment needs its own Resend team. *Open question 1.* | The task fixes the key as the bare id. Ids from two databases sharing one Resend team would collide within Resend's 24-hour window: a different body under the same key fails with `409 invalid_idempotent_request`, which is recorded as `failed`, so the collision shows in the Message log instead of passing silently. The README, `.env.example` and §16 say so. |
| An unknown template at send time (a message queued by a newer release, drained by an older one during a deploy) is a retry with `template_unknown`, not a failure. | Render runs both releases side by side for a moment (§6.1). The newer release then sends it. |
| `last_error_code` stores only Resend's error `name` when it matches `^[a-z_]{1,64}$`. Otherwise it is `http_<status>`, or one of `network_error`, `timeout`, `invalid_response`, `render_failed`, `template_unknown` and `attempts_exhausted`. | Provider messages can echo the recipient, which is personal data. |
| The `related_*_id` columns are plain `BIGINT` and get their covering indexes now. | The later foreign-key migrations then add only the constraint (§6.1). |

## Configuration

| Variable | Rule | Default |
|---|---|---|
| `FRONTEND_BASE_URL` | An absolute `http://` or `https://` URL with no query, fragment or credentials. A trailing `/` is removed. | required |
| `EMAIL_DRIVER` | `resend` or `simulated` | required |
| `RESEND_API_KEY` | Non-empty, no whitespace. Required when `EMAIL_DRIVER=resend`. Never echoed. | unset |
| `EMAIL_FROM` | `addr@domain` or `Name <addr@domain>`. Required when `EMAIL_DRIVER=resend`. | unset |

`AppConfig` gains `frontendBaseUrl: string` and `email: EmailConfig`, where `EmailConfig` is
`{ driver: 'simulated' } | { driver: 'resend'; apiKey: string; from: string }` (in
`common/config/types.ts`; `EMAIL_DRIVERS` in `common/config/enums.ts`).

`.env.example` moves the four variables into "Read and validated today", with
`EMAIL_DRIVER=simulated`. The README gets the variables and an "Email" paragraph: simulated
locally; Resend needs a verified domain (§16); one sending environment per Resend team.

The test configuration uses `EMAIL_DRIVER=simulated` and
`FRONTEND_BASE_URL=http://localhost:5173`. The integration suites of this unit replace
`EmailSender` with a recording fake. `npm run contract` uses the simulated driver.

## Modules and files

`src/modules/messaging/` holds `MessagingModule`. It is `@Global()`, because every unit that
queues needs it, and it exports `MessagingService`, `MessageTemplateRegistry`,
`OutboxDrainService`, `OutboxDrainInterceptor`, `EmailSender` and `SmsSender`.

| File | Holds |
|---|---|
| `enums.ts` | `MESSAGE_CHANNELS = ['email','sms']`, `MESSAGE_STATUSES = ['queued','sent','failed']`, `DRAIN_MODES = ['batch','flush']`, `SEND_OUTCOME_KINDS` |
| `types.ts` | `JsonValue`, `TemplateParams`, `MessageChannel`, `MessageStatus`, `DrainMode`, `SendOutcomeKind`, `LinkBuilder`, `RenderedMessage`, `MessageTemplate<P>`, `RegisteredTemplate`, `SimpleHtmlContent`, `QueueMessageInput<P>`, `QueuedMessage`, `RelatedRecords`, `NewMessageRow`, `ClaimedMessage`, `OutgoingEmail`, `OutgoingSms`, `SendOutcome`, `DrainResult`, `DrainCounts`, `BatchThrottle`, `DeliveryRecord`, `ResendResponseBody`, `ResendSenderOptions` |
| `messaging.constants.ts` | `CLAIM_BATCH_SIZE = 10`, `CLAIM_LEASE_MINUTES = 5`, `MAX_SEND_ATTEMPTS = 10`, `RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360]`, `FLUSH_MAX_BATCHES = 10`, `SHUTDOWN_WAIT_MS = 5000`, `REDACTED_LINK`, `TEMPLATE_NAME_PATTERN`, `EMAIL_RECIPIENT_PATTERN`, `SMS_RECIPIENT_PATTERN`, `ERROR_CODE_PATTERN`, `OUTBOX_ERROR_CODES`, `DRAIN_AFTER_RESPONSE_METADATA`, the Resend constants (`RESEND_EMAILS_URL`, `RESEND_TIMEOUT_MS = 10000`, `RESEND_MIN_INTERVAL_MS = 500`, `DEFAULT_RETRY_AFTER_SECONDS = 60`, `MAX_RETRY_AFTER_SECONDS = 3600`, `RESEND_KEY_ERRORS`, `RESEND_RETRYABLE_CONFLICTS`, `RESEND_QUOTA_ERRORS`) |
| `messages.repository.ts` | `MessagesRepository`: `nextId`, `insert` (through `TransactionContext.executor()`); `claimDue`, `markSent`, `markRetry`, `markThrottled`, `markFailed` (on the pool, outside any transaction). Columns are always named. |
| `message-template.registry.ts` | `MessageTemplateRegistry` |
| `links.ts` | `deliveryLinks(baseUrl)`, `storageLinks(baseUrl)` |
| `simple-html.ts` | `escapeHtml()`, `renderSimpleHtml()` |
| `retry-schedule.ts` | `retryDelayMinutes(attempts)` |
| `payload.ts` | `payloadAad(id)`: the AAD `messages:<id>` that binds a payload to its row |
| `messaging.service.ts` | `MessagingService` |
| `outbox-drain.service.ts` | `OutboxDrainService` |
| `outbox-drain.interceptor.ts` | `OutboxDrainInterceptor` |
| `drain-after-response.decorator.ts` | `@DrainOutboxAfterResponse()` |
| `senders/email-sender.ts`, `senders/sms-sender.ts` | The abstract classes `EmailSender` and `SmsSender`, used as Nest tokens like `Clock` |
| `senders/resend-email.sender.ts`, `senders/simulated-email.sender.ts`, `senders/simulated-sms.sender.ts` | The implementations. `EmailSender` is provided by a factory on `config.email.driver`. |
| `senders/resend-response.ts` | `outcomeOfResponse()`, `outcomeOfFetchError()`: the pure mapping from Resend's answer to a `SendOutcome` |
| `messaging.module.ts` | The module |

Elsewhere:

- `src/common/time/time.ts` gains `startOfNextUtcDay(instant)`.
- `src/common/config/*` gains the four variables.
- `HealthController.getReadiness` gets `@DrainOutboxAfterResponse()`.
- `AppModule` imports `MessagingModule` after the U1 modules, and registers
  `OutboxDrainInterceptor` as an `APP_INTERCEPTOR` ahead of `WriteInterceptor`.
- `src/cli/contract.ts` gets the two required variables.
- `test/support/types.ts`: `TestAppOptions` gains `overrides` (provider token and value), which
  `createTestApp()` applies with `overrideProvider`.
- `test/support/test-config.ts` gains the two required variables.
- `test/support/messaging/` holds `RecordingEmailSender`, the test templates and the probe
  routes.

## Migration (prefix `0030`)

**`0030_01_create_messages`**

```sql
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  channel VARCHAR(8) NOT NULL,
  template VARCHAR(64) NOT NULL,
  recipient VARCHAR(320) NOT NULL,
  subject VARCHAR(300) NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NULL,
  status VARCHAR(8) NOT NULL,
  attempts SMALLINT NOT NULL,
  last_error_code VARCHAR(64) NULL,
  next_attempt_at TIMESTAMPTZ NULL,
  payload_ciphertext TEXT NULL,
  provider_message_id VARCHAR(128) NULL,
  sent_at TIMESTAMPTZ NULL,
  related_customer_id BIGINT NULL,
  related_staff_user_id BIGINT NULL,
  related_booking_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_messages_channel CHECK (channel IN ('email', 'sms')),
  CONSTRAINT chk_messages_status CHECK (status IN ('queued', 'sent', 'failed')),
  CONSTRAINT chk_messages_template CHECK (template ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT chk_messages_attempts CHECK (attempts BETWEEN 0 AND 10),
  CONSTRAINT chk_messages_channel_fields CHECK (
    (channel = 'email' AND subject IS NOT NULL AND body_html IS NOT NULL)
    OR (channel = 'sms' AND subject IS NULL AND body_html IS NULL)),
  CONSTRAINT chk_messages_status_fields CHECK (
    (status = 'queued' AND next_attempt_at IS NOT NULL AND payload_ciphertext IS NOT NULL
       AND sent_at IS NULL AND provider_message_id IS NULL)
    OR (status = 'sent' AND next_attempt_at IS NULL AND payload_ciphertext IS NULL
       AND sent_at IS NOT NULL AND provider_message_id IS NOT NULL AND attempts >= 1)
    OR (status = 'failed' AND next_attempt_at IS NULL AND payload_ciphertext IS NOT NULL
       AND sent_at IS NULL AND provider_message_id IS NULL AND last_error_code IS NOT NULL)),
  CONSTRAINT chk_messages_last_error_code CHECK (last_error_code ~ '^[a-z0-9_]{1,64}$')
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
```

| Index | Columns | Query it serves (the index comment) |
|---|---|---|
| `idx_messages_due` | `(next_attempt_at, id) WHERE status = 'queued'` | The drain claim: `WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT 10 FOR UPDATE SKIP LOCKED` |
| `idx_messages_created_at` | `(created_at DESC, id DESC)` | The Message log, newest first, with a cursor on `(created_at, id)` (U2b) |
| `idx_messages_related_customer_id` | `(related_customer_id)` | A customer's messages; anonymisation deletes them (U15). Covers the future `fk_messages_related_customer_id` (U9). |
| `idx_messages_related_staff_user_id` | `(related_staff_user_id)` | A staff member's messages. Covers the future `fk_messages_related_staff_user_id` (U2a or U2b). |
| `idx_messages_related_booking_id` | `(related_booking_id)` | A booking's messages. Covers the future `fk_messages_related_booking_id` (U10). |

`created_at`, `updated_at`, `next_attempt_at` and `sent_at` come from the `Clock`; no column
has a default.

## Behaviour

### Templates

```ts
type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type TemplateParams<P> = { readonly [K in keyof P]: JsonValue }; // works for interfaces too
interface LinkBuilder {
  page(path: string, query?: Readonly<Record<string, string>>): string; // `${FRONTEND_BASE_URL}${path}?…`
  oneTime(path: string, token: string): string; // delivery: `…${path}?token=<token>`; storage: REDACTED_LINK
}
interface RenderedMessage { readonly subject?: string; readonly text: string; readonly html?: string }
interface MessageTemplate<P extends TemplateParams<P>> {
  readonly name: string;                       // `<owner>.<event>`, e.g. `staff.invite`
  readonly channel: MessageChannel;
  readonly secretParams: readonly (keyof P & string)[];
  render(params: P, links: LinkBuilder): RenderedMessage;
}
```

- `renderSimpleHtml({ heading, paragraphs, action?: { label, url } })` escapes every value and
  returns a minimal document with inline styles. An action whose `url` is the redacted text is
  written as plain text, not as a link.
- Paths must start with `/`; anything else is `INTERNAL`.
- The templates in this unit are test-only, in `test/support/messaging/`:
  - `test.one_time_link`: email, params `{ name: string; token: string }`,
    `secretParams: ['token']`, link `/verify-email`;
  - `test.sms_notice`: SMS, params `{ text: string }`.

### Queue

`queue(input)` runs inside `TransactionRepository.run()`:

1. The template must be registered under its name, as that same object; otherwise `INTERNAL`.
   The recipient must match the channel, otherwise `INTERNAL` (callers validate user input
   first):
   - email: `^[^\s@]+@[^\s@]+\.[^\s@]+$`, at most 320 characters;
   - SMS: E.164, `^\+[1-9]\d{7,14}$`.
2. Render with the storage link builder. Check that no `secretParams` value appears in the
   render, raw or URL-encoded (otherwise `INTERNAL`). Check the channel's fields: an email needs
   a subject and HTML, and an SMS has neither.
3. Reserve the id with `nextval(pg_get_serial_sequence('messages', 'id'))`, then insert:
   `status = 'queued'`, `attempts = 0`, `next_attempt_at = created_at = updated_at =
   clock.now()`, `payload_ciphertext = encrypt(JSON.stringify(params), 'messages:' + id)`, and
   the `related_*` ids.
4. Register `afterCommit(() => drain.requestDrain('batch'))`, then return `{ id }`.

### Drain

`drain(mode)` repeats the steps below: once for `batch`, and up to `FLUSH_MAX_BATCHES` times
for `flush`.

1. **Claim**, as one autocommit statement on the pool:

   ```sql
   WITH due AS (SELECT id FROM messages WHERE status = 'queued' AND next_attempt_at <= :now
                ORDER BY next_attempt_at, id LIMIT 10 FOR UPDATE SKIP LOCKED)
   UPDATE messages SET next_attempt_at = :now + 5 min, updated_at = :now
   FROM due WHERE messages.id = due.id
   RETURNING id, channel, template, recipient, attempts, payload_ciphertext
   ```

2. **Send** each row, in id order:
   - decrypt and parse the payload; look up the template (an unknown one is a retry with
     `template_unknown`);
   - render with the delivery link builder;
   - send through the channel's sender. A decrypt or render error is logged and handled as a
     retry with `render_failed`.
3. **Record** the result. Each update is `WHERE id = :id AND status = 'queued'` and sets
   `updated_at = now`:

| Outcome | Row becomes |
|---|---|
| `sent` | `status = 'sent'`, `attempts + 1`, `provider_message_id`, `sent_at = now`; `next_attempt_at`, `payload_ciphertext` and `last_error_code` become NULL |
| `throttled` (429) | stays `queued`, `attempts` unchanged, `next_attempt_at = retryAt`, `last_error_code` set; the batch's remaining emails get the same `retryAt` and code, in one statement |
| `retry` (5xx, network, timeout, `409 concurrent_idempotent_requests`, API-key problems, render and template errors) | `attempts + 1`. If that reaches 10, the row becomes `failed` with `attempts_exhausted`. Otherwise `next_attempt_at = now + backoff(attempts)` and `last_error_code` is set. |
| `rejected` (any other 4xx) | `status = 'failed'`, `attempts + 1`, `next_attempt_at` NULL, `last_error_code` set; the payload is kept |

- Each result logs one line with `messageId`, `template`, `channel`, `outcome`, `errorCode` and
  `attempts`. The recipient and the body are never logged.
- The loop stops on a 429 or on an empty claim. The result is
  `{ claimed, sent, retried, throttled, failed }`.
- `requestDrain(mode)` coalesces: one drain runs and at most one waits, and the waiting mode is
  the stronger of the two (`flush` beats `batch`). It runs `drain()` in the background and logs
  a thrown error.
- `whenIdle()` resolves when nothing is running or waiting. `beforeApplicationShutdown` waits
  for it for up to 5 seconds.

### Triggers

- `OutboxDrainInterceptor` is a global interceptor. On HTTP `POST`, `PUT`, `PATCH` and `DELETE`,
  and on handlers marked `@DrainOutboxAfterResponse()`, it calls
  `requestDrain(marked ? 'flush' : 'batch')` when the handler's result completes. An error
  response triggers nothing, and WebSocket contexts pass through.
- `queue()`'s post-commit hook calls `requestDrain('batch')`, which covers queues outside a
  request (CLIs, a GET path's own transaction).

### `ResendEmailSender.send(email)`

```ts
fetch('https://api.resend.com/emails', {
  method: 'POST',
  signal: AbortSignal.timeout(10_000),
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': String(email.messageId),
  },
  body: JSON.stringify({ from, to: [email.to], subject, text, html }),
});
```

Calls are at least 500 ms apart.

| Response | Outcome |
|---|---|
| 2xx with a string `id` | `sent`, with `providerMessageId = id` |
| 2xx without one | `retry`, `invalid_response` |
| 429 `daily_quota_exceeded` or `monthly_quota_exceeded` | `throttled`, `retryAt = startOfNextUtcDay(now)`; the code is the name |
| any other 429 | `throttled`, `retryAt = now + Retry-After` seconds (clamped to 1–3600, default 60); the code is the name or `http_429` |
| 401 or 403 with `missing_api_key`, `invalid_api_key` or `restricted_api_key`; 409 with `concurrent_idempotent_requests` | `retry`, so fixing the key later flushes the queue |
| any other 4xx (`validation_error`, 409 `invalid_idempotent_request`, 422 …) | `rejected` |
| 5xx or any other status | `retry`, with the name or `http_<status>` |
| fetch throws: a timeout or abort | `retry`, `timeout` |
| fetch throws anything else | `retry`, `network_error` |

`SimulatedEmailSender` and `SimulatedSmsSender` answer `sent` with `providerMessageId`
`simulated-email-<id>` and `simulated-sms-<id>`, and log one line without the recipient.

## Endpoints

No new route. `GET /api/v1/health/ready` stays `@Public()`, with no idempotency, the same
`HealthResponse` and `SERVICE_UNAVAILABLE`. It gains `@DrainOutboxAfterResponse()`, and its
description adds: "After a `200` it starts sending queued email and SMS in the background; the
answer never waits for that." The only contract diff is that description.

## Error codes

None added. Programming errors (an unregistered template, a bad recipient, a render leaking a
secret) are `INTERNAL`.

## Exported services (what other units call)

Exported by `MessagingModule`, which is global:

```ts
class MessagingService {
  queue<P extends TemplateParams<P>>(input: QueueMessageInput<P>): Promise<QueuedMessage>;
}
// QueueMessageInput<P> = { template: MessageTemplate<P>; recipient: string; params: P;
//   related?: { customerId?: number; staffUserId?: number; bookingId?: number } }
// QueuedMessage = { id: number }
class MessageTemplateRegistry {
  register<P extends TemplateParams<P>>(template: MessageTemplate<P>): void; // a duplicate or malformed name is INTERNAL, at boot
  get(name: string): RegisteredTemplate | undefined;
  isRegistered<P extends TemplateParams<P>>(template: MessageTemplate<P>): boolean;
  names(): string[];
}
class OutboxDrainService {
  requestDrain(mode: DrainMode): void;          // 'batch' | 'flush'
  drain(mode: DrainMode): Promise<DrainResult>; // { claimed, sent, retried, throttled, failed }
  whenIdle(): Promise<void>;
}
abstract class EmailSender { abstract send(email: OutgoingEmail): Promise<SendOutcome>; }
abstract class SmsSender { abstract send(sms: OutgoingSms): Promise<SendOutcome>; }
function renderSimpleHtml(content: SimpleHtmlContent): string;
function escapeHtml(value: string): string;
const REDACTED_LINK: string;
const DrainOutboxAfterResponse: () => MethodDecorator;
```

A later unit defines a template in `src/modules/<owner>/templates/<event>.template.ts` and
registers it in its module's `onModuleInit()` with `registry.register(staffInviteTemplate)`. It
queues inside its write with
`messaging.queue({ template: staffInviteTemplate, recipient, params, related: { staffUserId } })`.
U2b adds the Message log read service and controller inside `src/modules/messaging/`, reading
`messages` through its own repository methods and never selecting `payload_ciphertext`.

**Consumed from U1:** `TransactionRepository.run()` and `.afterCommit()`;
`TransactionContext.executor()`; `DataEncryptionService.encrypt()` and `.decrypt()`;
`Clock.now()`; `addToInstant()`; `AppError`; `APP_CONFIG` and `AppConfig`; `WRITE_METHODS`.
Nothing from other feature units.

## Tests

**Unit** (`test/unit/modules/messaging/` and `test/unit/common/…`):

- `senders/resend-email.sender.test.ts`, with `global.fetch` mocked:
  - the request: URL, method, `Authorization`, `Content-Type`, `Idempotency-Key` equal to the
    message id, and the JSON body (`from`, `to` as an array, `subject`, `text`, `html`);
  - a timeout signal is passed, and calls are paced;
  - every row of the mapping table, including `Retry-After` parsing and clamping;
  - the daily and monthly quotas wait until the next UTC midnight (including the 23:59:59 UTC
    case);
  - an unparseable error body gives `http_<status>`, and a malformed name is not stored.
- `message-template.registry.test.ts`: register and get; duplicate and malformed names are
  refused.
- `links.test.ts` and `simple-html.test.ts`:
  - base-URL joining and query encoding;
  - the storage builder returns the redacted text, and a path without `/` is refused;
  - `<>&"'` are escaped, and a redacted action is plain text.
- `messaging.service.test.ts`, with the repository, registry and drain mocked:
  - a render that leaks a secret is refused;
  - recipients are checked per channel, and an email without a subject is refused;
  - an unregistered template is refused;
  - the encrypted payload is bound to `messages:<id>`, and the post-commit hook requests a
    drain.
- `outbox-drain.service.test.ts`, with the repository and senders mocked:
  - each outcome is recorded;
  - the backoff schedule, and the 10th retry becomes `attempts_exhausted`;
  - a 429 reschedules the batch's other emails but still sends its SMS;
  - a render or decrypt failure is a retry, and so is an unknown template;
  - flush mode stops on an empty claim, on a 429 and after 10 batches;
  - coalescing: two requests while one drain runs give exactly one more run, in the stronger
    mode;
  - a drain that throws is logged; log lines never contain the recipient.
- `outbox-drain.interceptor.test.ts`: writes request `batch`; a marked GET requests `flush`; an
  unmarked GET, an error and a WebSocket context request nothing.
- `common/config/load-config.test.ts`:
  - `EMAIL_DRIVER` is required, and `resend` without the key or the from address is refused;
  - values are never echoed;
  - `FRONTEND_BASE_URL` loses its trailing slash, and a URL with a query is refused.
- `common/time/time.test.ts`: `startOfNextUtcDay`.

**Integration** (`test/integration/modules/messaging/`): the real app and Postgres, with
`EmailSender` replaced by `RecordingEmailSender`. The fake can be scripted to answer any
`SendOutcome`, and to hold sends until released. SMS uses the real simulated sender.

- A probe write route queues `test.one_time_link` and then throws. No `messages` row exists,
  and after `whenIdle()` the fake recorded no send.
- A probe write route queues and commits. After `whenIdle()`:
  - the fake received one email whose text and HTML contain the real link with the token;
  - the row is `sent`, with `attempts = 1`, the fake's `provider_message_id`, `sent_at` set and
    `payload_ciphertext` NULL.
- The stored `subject`, `body_text` and `body_html` never contain the raw token, while queued
  or after sending, and they do contain `[one-time link hidden]`.
- While queued, `payload_ciphertext` is not the plain JSON, and it decrypts only with AAD
  `messages:<id>`.
- The fake answers `throttled` until the next UTC midnight (Clock fixed):
  - the row stays `queued`, with `attempts = 0`, `next_attempt_at` at that midnight and
    `last_error_code = daily_quota_exceeded`;
  - a drain before that instant claims nothing, and after the Clock moves past it the message
    is sent.
- The fake answers `retry` (a 5xx): `attempts = 1`, `next_attempt_at = now + 1 min`, still
  `queued`.
- The fake answers `rejected` (`validation_error`): the row is `failed`, keeps its payload, and
  is never claimed again.
- Concurrent drains: 15 due messages, the fake holding sends, and two direct `drain('batch')`
  calls racing the post-commit drain. Every message is sent exactly once (15 calls, unique
  ids), and every row is `sent` with `attempts = 1`.
- A claimed row is not claimed again within its lease. After the Clock moves past the lease, it
  is.
- SMS: queue `test.sms_notice` and commit. The row is `sent` with `simulated-sms-<id>` and has
  no subject or HTML.
- `GET /api/v1/health/ready` answers `200` and then sends queued messages (`whenIdle()`). A
  `GET` elsewhere triggers no drain.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (a nonzero pass count, no failures or skips),
  `npm run build`, and `npm run contract` followed by a clean `git status`.
- Every test above passes, covering the list of issue #3:
  - a rollback stores and sends nothing;
  - a commit sends through the replaceable sender and records `sent` with the provider id;
  - the daily quota keeps the message `queued` with `next_attempt_at`;
  - a 5xx increments `attempts`, and a 4xx validation error marks the message `failed`;
  - concurrent drains never send twice;
  - stored bodies never hold the raw token, and the payload is cleared on send;
  - the `ResendEmailSender` unit tests cover the URL, the headers with `Idempotency-Key`, the
    body and the error mapping.
- `docs/system-design.md` §5, §6.2, §13.1, §14.5 and §16, `.env.example` and the README are
  updated as above.

## Follow-ups

- U2b: the Message log API, and a foreign key on `related_staff_user_id` once `staff_users`
  exists (U2a creates the table; whichever unit lands second adds the constraint).
- U9 and U10: foreign keys on `related_customer_id` and `related_booking_id`.
- U15: anonymisation deletes the customer's messages.
- Retention (§20): purge old message bodies, and payloads of failed messages, if the database
  budget is ever at risk.
