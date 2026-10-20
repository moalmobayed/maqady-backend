import type { DRAIN_MODES, MESSAGE_CHANNELS, MESSAGE_STATUSES, SEND_OUTCOME_KINDS } from './enums';

export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export type DrainMode = (typeof DRAIN_MODES)[number];
export type SendOutcomeKind = (typeof SEND_OUTCOME_KINDS)[number];

/** A value that survives `JSON.stringify` and `JSON.parse` unchanged. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * The constraint on a template's parameters: every property is JSON, because the parameters are
 * stored encrypted and parsed again at send time. Written as a mapped type so a plain
 * `interface` of parameters satisfies it too.
 */
export type TemplateParams<P> = { readonly [K in keyof P]: JsonValue };

/** Builds the links a template puts in a message, from `FRONTEND_BASE_URL`. */
export interface LinkBuilder {
  /** `${FRONTEND_BASE_URL}${path}`, with the query encoded. `path` starts with `/`. */
  page(path: string, query?: Readonly<Record<string, string>>): string;
  /**
   * A single-use link such as `/verify-email?token=…`. The delivery builder writes the real
   * link; the storage builder writes `REDACTED_LINK`, so no stored copy holds the token.
   */
  oneTime(path: string, token: string): string;
}

/** A rendered message: an email has all three parts, an SMS only `text`. */
export interface RenderedMessage {
  readonly subject?: string;
  readonly text: string;
  readonly html?: string;
}

/**
 * One kind of message, defined by the module that owns its trigger and registered with
 * `MessageTemplateRegistry` in that module's `onModuleInit()`.
 *
 * `render` must be a pure function of its parameters and links: it runs once with the storage
 * links when the message is queued, and again with the delivery links each time it is sent.
 */
export interface MessageTemplate<P extends TemplateParams<P>> {
  /** `<owner>.<event>`, lower-case, for example `staff.invite`. Stored on every message. */
  readonly name: string;
  readonly channel: MessageChannel;
  /**
   * Parameters that must never appear in a stored copy, such as a one-time token. `queue()`
   * refuses a stored render that contains one of their values.
   */
  readonly secretParams: readonly (keyof P & string)[];
  render(params: P, links: LinkBuilder): RenderedMessage;
}

/** A template as the registry keeps it, its parameters already checked at queue time. */
export type RegisteredTemplate = MessageTemplate<Record<string, JsonValue>>;

/** What `renderSimpleHtml()` lays out: a heading, paragraphs and an optional action link. */
export interface SimpleHtmlContent {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly action?: { readonly label: string; readonly url: string };
}

/** The rows a message relates to, shown in the Message log; their foreign keys come later. */
export interface RelatedRecords {
  readonly customerId?: number;
  readonly staffUserId?: number;
  readonly bookingId?: number;
}

/** What a module hands `MessagingService.queue()`. */
export interface QueueMessageInput<P extends TemplateParams<P>> {
  readonly template: MessageTemplate<P>;
  /** An email address or an E.164 phone number, already validated by the caller. */
  readonly recipient: string;
  readonly params: P;
  readonly related?: RelatedRecords;
}

export interface QueuedMessage {
  readonly id: number;
}

/** A new `messages` row, as `MessagesRepository.insert()` writes it. */
export interface NewMessageRow {
  readonly id: number;
  readonly channel: MessageChannel;
  readonly template: string;
  readonly recipient: string;
  readonly subject: string | null;
  readonly body_text: string;
  readonly body_html: string | null;
  readonly status: 'queued';
  readonly attempts: number;
  readonly last_error_code: null;
  readonly next_attempt_at: Date;
  readonly payload_ciphertext: string;
  readonly provider_message_id: null;
  readonly sent_at: null;
  readonly related_customer_id: number | null;
  readonly related_staff_user_id: number | null;
  readonly related_booking_id: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** A row the drain claimed: what it needs to render and send the message again. */
export interface ClaimedMessage {
  readonly id: number;
  readonly channel: MessageChannel;
  readonly template: string;
  readonly recipient: string;
  readonly attempts: number;
  readonly payload_ciphertext: string;
}

/** One email for an `EmailSender`, rendered with the real links. */
export interface OutgoingEmail {
  /** The `messages` id; Resend's idempotency key, so a retry never sends twice. */
  readonly messageId: number;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** One SMS for an `SmsSender`. */
export interface OutgoingSms {
  readonly messageId: number;
  readonly to: string;
  readonly text: string;
}

/**
 * What a sender reports. `errorCode` is a short machine code (Resend's error name, or
 * `http_<status>`, `network_error`, `timeout`, …), never a provider message, which could echo
 * the recipient.
 *
 * - `sent`: delivered to the provider; recorded with its id.
 * - `throttled`: a rate or quota refusal; stays queued until `retryAt`, not counted as an attempt.
 * - `retry`: a temporary failure; counted, retried after a backoff.
 * - `rejected`: the provider will never accept this message; recorded as `failed`.
 */
export type SendOutcome =
  | { readonly kind: 'sent'; readonly providerMessageId: string }
  | { readonly kind: 'throttled'; readonly errorCode: string; readonly retryAt: Date }
  | { readonly kind: 'retry'; readonly errorCode: string }
  | { readonly kind: 'rejected'; readonly errorCode: string };

/** What one `drain()` did, counted per message. */
export interface DrainResult {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly throttled: number;
  readonly failed: number;
}

/** The running counts of a drain (a mutable `DrainResult`). */
export type DrainCounts = { -readonly [K in keyof DrainResult]: number };

/** A 429 seen in the current batch: the batch's other emails wait until the same instant. */
export interface BatchThrottle {
  readonly retryAt: Date;
  readonly errorCode: string;
}

/** The parts of a Resend response body this service reads. */
export interface ResendResponseBody {
  readonly id?: unknown;
  readonly name?: unknown;
}

/** What `ResendEmailSender` is built from. */
export interface ResendSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  /** Minimum time between two calls in this process; 0 turns pacing off (unit tests). */
  readonly minIntervalMs: number;
}

/** One message's result inside a drain, for the counts and the log line. */
export interface DeliveryRecord {
  readonly outcome: SendOutcomeKind | 'failed';
  readonly errorCode: string | null;
  readonly attempts: number;
}

/** `GET /admin/messages` filters; `from` is inclusive, `to` exclusive. */
export interface MessageLogFilter {
  readonly channel?: MessageChannel;
  readonly status?: MessageStatus;
  readonly from?: Date;
  readonly to?: Date;
}

/** A `messages` row as the Message log lists it. Never the encrypted parameters. */
export interface MessageLogRow {
  readonly id: number;
  readonly channel: MessageChannel;
  readonly template: string;
  readonly recipient: string;
  readonly subject: string | null;
  readonly status: MessageStatus;
  readonly attempts: number;
  readonly last_error_code: string | null;
  readonly next_attempt_at: Date | null;
  readonly sent_at: Date | null;
  readonly related_customer_id: number | null;
  readonly related_staff_user_id: number | null;
  readonly related_booking_id: number | null;
  readonly created_at: Date;
}

/** A `messages` row as the Message log opens it: the list columns plus the redacted bodies. */
export interface MessageLogDetailRow extends MessageLogRow {
  readonly body_text: string;
  readonly body_html: string | null;
  readonly provider_message_id: string | null;
  readonly updated_at: Date;
}

/** One line of the Message log. */
export interface MessageLogEntry {
  readonly id: number;
  readonly channel: MessageChannel;
  readonly template: string;
  readonly recipient: string;
  readonly subject: string | null;
  readonly status: MessageStatus;
  readonly attempts: number;
  readonly lastErrorCode: string | null;
  readonly nextAttemptAt: Date | null;
  readonly sentAt: Date | null;
  readonly related: RelatedRecordIds;
  readonly createdAt: Date;
}

/** One message opened from the Message log, with its stored (redacted) bodies. */
export interface MessageLogDetail extends MessageLogEntry {
  readonly bodyText: string;
  readonly bodyHtml: string | null;
  readonly providerMessageId: string | null;
  readonly updatedAt: Date;
}

/** The records a logged message relates to, each null when it relates to none. */
export interface RelatedRecordIds {
  readonly customerId: number | null;
  readonly staffUserId: number | null;
  readonly bookingId: number | null;
}
