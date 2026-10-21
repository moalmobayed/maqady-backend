/** How a message reaches its recipient (`chk_messages_channel`). */
export const MESSAGE_CHANNELS = ['email', 'sms'] as const;

/**
 * Where a message is in the outbox (`chk_messages_status`): `queued` until a send succeeds,
 * then `sent`; `failed` is terminal (the provider refused it, or every attempt was used).
 */
export const MESSAGE_STATUSES = ['queued', 'sent', 'failed'] as const;

/**
 * How much a drain sends: `batch` claims one batch (after a write); `flush` keeps claiming
 * until the queue is empty, a quota stops it, or the batch cap is reached (readiness ping).
 */
export const DRAIN_MODES = ['batch', 'flush'] as const;

/** What a sender reports for one message. */
export const SEND_OUTCOME_KINDS = ['sent', 'throttled', 'retry', 'rejected'] as const;
