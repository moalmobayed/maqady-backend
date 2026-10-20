import { type BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { APP_CONFIG } from '../../common/config/config.constants';
import type { AppConfig } from '../../common/config/types';
import { DataEncryptionService } from '../../common/crypto/data-encryption.service';
import { Clock } from '../../common/time/clock';
import { addToInstant } from '../../common/time/time';
import { deliveryLinks } from './links';
import { MessageTemplateRegistry } from './message-template.registry';
import { MessagesRepository } from './messages.repository';
import {
  CLAIM_BATCH_SIZE,
  CLAIM_LEASE_MINUTES,
  ERROR_CODE_PATTERN,
  FLUSH_MAX_BATCHES,
  MAX_SEND_ATTEMPTS,
  OUTBOX_ERROR_CODES,
  SHUTDOWN_WAIT_MS,
} from './messaging.constants';
import { payloadAad } from './payload';
import { retryDelayMinutes } from './retry-schedule';
import { EmailSender } from './senders/email-sender';
import { SmsSender } from './senders/sms-sender';
import type {
  BatchThrottle,
  ClaimedMessage,
  DeliveryRecord,
  DrainCounts,
  DrainMode,
  DrainResult,
  JsonValue,
  RenderedMessage,
  SendOutcome,
} from './types';

/**
 * The outbox's send side (design §13.1). No timer runs: a drain starts after a write request
 * commits, after `queue()` commits, and after a readiness ping. Each drain claims due messages
 * with `FOR UPDATE SKIP LOCKED` (so concurrent drains take disjoint rows), sends them outside
 * any transaction, and records each result.
 */
@Injectable()
export class OutboxDrainService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxDrainService.name);
  private running: Promise<void> | undefined;
  private pending: DrainMode | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly messages: MessagesRepository,
    private readonly registry: MessageTemplateRegistry,
    private readonly encryption: DataEncryptionService,
    private readonly clock: Clock,
    private readonly emailSender: EmailSender,
    private readonly smsSender: SmsSender,
  ) {}

  /**
   * Starts a drain in the background and returns at once. Requests are coalesced: one drain
   * runs at a time, and requests made meanwhile give exactly one more run, in the stronger mode.
   * A failing drain is logged, never thrown: the messages stay queued for the next one.
   */
  requestDrain(mode: DrainMode): void {
    if (this.running) {
      this.pending = this.pending === 'flush' || mode === 'flush' ? 'flush' : 'batch';
      return;
    }
    this.running = this.runLoop(mode);
  }

  /** Resolves once no drain is running or waiting to run. */
  async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  async beforeApplicationShutdown(): Promise<void> {
    const timeout = sleep(SHUTDOWN_WAIT_MS, undefined, { ref: false });
    await Promise.race([this.whenIdle(), timeout]);
  }

  /**
   * Claims and sends due messages: one batch, or for `flush` up to `FLUSH_MAX_BATCHES` batches
   * until one claims nothing. A rate or quota refusal ends the drain.
   */
  async drain(mode: DrainMode): Promise<DrainResult> {
    const total: DrainCounts = { claimed: 0, sent: 0, retried: 0, throttled: 0, failed: 0 };
    const batches = mode === 'flush' ? FLUSH_MAX_BATCHES : 1;
    for (let batch = 0; batch < batches; batch += 1) {
      const now = this.clock.now();
      const claimed = await this.messages.claimDue(
        now,
        addToInstant(now, { minutes: CLAIM_LEASE_MINUTES }),
        CLAIM_BATCH_SIZE,
      );
      if (claimed.length === 0) break;
      total.claimed += claimed.length;
      const stopped = await this.sendBatch(claimed, total);
      if (stopped) break;
    }
    return total;
  }

  /**
   * Runs drains until no request is pending. `running` is cleared in the same synchronous step
   * as the last look at `pending`, so a request made at any moment either becomes `pending` and
   * is run here, or finds nothing running and starts a new loop: none is dropped.
   */
  private async runLoop(mode: DrainMode): Promise<void> {
    let next: DrainMode | undefined = mode;
    while (next) {
      this.pending = undefined;
      try {
        await this.drain(next);
      } catch (error) {
        this.logger.error({ err: error }, 'An outbox drain failed');
      }
      next = this.pending;
    }
    this.running = undefined;
  }

  /** Sends one claimed batch in id order. True when a 429 stopped it. */
  private async sendBatch(
    claimed: readonly ClaimedMessage[],
    total: DrainCounts,
  ): Promise<boolean> {
    let throttle: BatchThrottle | undefined;
    const held: ClaimedMessage[] = [];
    for (const message of claimed) {
      if (throttle && message.channel === 'email') {
        // Sending on into a quota wall only burns calls: the batch's other emails wait too.
        held.push(message);
        continue;
      }
      const outcome = await this.attempt(message);
      const record = await this.record(message, outcome);
      this.count(total, this.logResult(message, record));
      if (outcome.kind === 'throttled') {
        throttle = { retryAt: outcome.retryAt, errorCode: storableErrorCode(outcome.errorCode) };
      }
    }
    if (!throttle) return false;
    if (held.length > 0) {
      // One statement for the whole rest of the batch, not one per message.
      await this.messages.markThrottled(
        held.map((message) => message.id),
        throttle.retryAt,
        throttle.errorCode,
        this.clock.now(),
      );
    }
    for (const message of held) {
      const record: DeliveryRecord = {
        outcome: 'throttled',
        errorCode: throttle.errorCode,
        attempts: message.attempts,
      };
      this.count(total, this.logResult(message, record));
    }
    return true;
  }

  /** Rebuilds the real message from its encrypted parameters and hands it to its sender. */
  private async attempt(message: ClaimedMessage): Promise<SendOutcome> {
    const template = this.registry.get(message.template);
    if (!template) {
      // Queued by a newer release during a deploy (design §6.1); that release will send it.
      return { kind: 'retry', errorCode: OUTBOX_ERROR_CODES.templateUnknown };
    }
    let rendered: RenderedMessage;
    try {
      const params = JSON.parse(
        this.encryption.decrypt(message.payload_ciphertext, payloadAad(message.id)),
      ) as Record<string, JsonValue>;
      rendered = template.render(params, deliveryLinks(this.config.frontendBaseUrl));
    } catch (error) {
      this.logger.error(
        { err: error, messageId: message.id },
        'A queued message could not be rendered',
      );
      return { kind: 'retry', errorCode: OUTBOX_ERROR_CODES.renderFailed };
    }
    try {
      if (message.channel === 'sms') {
        return await this.smsSender.send({
          messageId: message.id,
          to: message.recipient,
          text: rendered.text,
        });
      }
      return await this.emailSender.send({
        messageId: message.id,
        to: message.recipient,
        subject: rendered.subject ?? '',
        text: rendered.text,
        html: rendered.html ?? '',
      });
    } catch (error) {
      // Senders report outcomes rather than throw; a throw is a bug, retried like a network error.
      this.logger.error({ err: error, messageId: message.id }, 'A message sender threw');
      return { kind: 'retry', errorCode: OUTBOX_ERROR_CODES.networkError };
    }
  }

  /** Stores one outcome on its row. */
  private async record(message: ClaimedMessage, outcome: SendOutcome): Promise<DeliveryRecord> {
    const now = this.clock.now();
    if (outcome.kind === 'sent') {
      await this.messages.markSent(message.id, outcome.providerMessageId, now);
      return { outcome: 'sent', errorCode: null, attempts: message.attempts + 1 };
    }
    const errorCode = storableErrorCode(outcome.errorCode);
    if (outcome.kind === 'throttled') {
      await this.messages.markThrottled([message.id], outcome.retryAt, errorCode, now);
      return { outcome: 'throttled', errorCode, attempts: message.attempts };
    }
    const attempts = message.attempts + 1;
    if (outcome.kind === 'rejected') {
      await this.messages.markFailed(message.id, attempts, errorCode, now);
      return { outcome: 'rejected', errorCode, attempts };
    }
    if (attempts >= MAX_SEND_ATTEMPTS) {
      await this.messages.markFailed(
        message.id,
        attempts,
        OUTBOX_ERROR_CODES.attemptsExhausted,
        now,
      );
      return { outcome: 'failed', errorCode: OUTBOX_ERROR_CODES.attemptsExhausted, attempts };
    }
    const nextAttemptAt = addToInstant(now, { minutes: retryDelayMinutes(attempts) });
    await this.messages.markRetry(message.id, attempts, nextAttemptAt, errorCode, now);
    return { outcome: 'retry', errorCode, attempts };
  }

  /** One line per message: ids, template and outcome only, never the recipient or the body. */
  private logResult(message: ClaimedMessage, record: DeliveryRecord): DeliveryRecord {
    this.logger.log(
      {
        messageId: message.id,
        template: message.template,
        channel: message.channel,
        outcome: record.outcome,
        errorCode: record.errorCode,
        attempts: record.attempts,
      },
      'Message delivery attempt',
    );
    return record;
  }

  private count(total: DrainCounts, record: DeliveryRecord): void {
    if (record.outcome === 'sent') total.sent += 1;
    else if (record.outcome === 'retry') total.retried += 1;
    else if (record.outcome === 'throttled') total.throttled += 1;
    else total.failed += 1;
  }
}

/** A sender's code as `chk_messages_last_error_code` accepts it, or a neutral fallback. */
function storableErrorCode(code: string): string {
  return ERROR_CODE_PATTERN.test(code) ? code : OUTBOX_ERROR_CODES.providerError;
}
