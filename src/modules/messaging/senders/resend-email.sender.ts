import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { Logger } from '@nestjs/common';
import type { Clock } from '../../../common/time/clock';
import { RESEND_EMAILS_URL, RESEND_TIMEOUT_MS } from '../messaging.constants';
import type { OutgoingEmail, ResendResponseBody, ResendSenderOptions, SendOutcome } from '../types';
import { EmailSender } from './email-sender';
import { outcomeOfFetchError, outcomeOfResponse } from './resend-response';

/**
 * `EMAIL_DRIVER=resend`: sends through Resend's HTTP API (ADR 0004).
 *
 * - The message id is the `Idempotency-Key`, so a retry of a send Resend already accepted (a
 *   crash before it was recorded, a timeout after Resend answered) never sends twice.
 * - Calls are spaced by `minIntervalMs`, under Resend's default limit of 2 per second.
 * - It never throws for a delivery problem. Beyond a debug line with the status and error code,
 *   it logs nothing: the drain logs one line per message, never the recipient.
 */
export class ResendEmailSender extends EmailSender {
  private readonly logger = new Logger(ResendEmailSender.name);
  /** `performance.now()` before which the next call waits; a monotonic timer, not a timestamp. */
  private nextCallAt = 0;

  constructor(
    private readonly options: ResendSenderOptions,
    private readonly clock: Clock,
  ) {
    super();
  }

  async send(email: OutgoingEmail): Promise<SendOutcome> {
    await this.pace();
    let response: Response;
    try {
      response = await fetch(RESEND_EMAILS_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': String(email.messageId),
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
      });
    } catch (error) {
      return outcomeOfFetchError(error);
    }
    const body = await readBody(response);
    const outcome = outcomeOfResponse(
      response.status,
      body,
      response.headers.get('retry-after'),
      this.clock.now(),
    );
    if (outcome.kind !== 'sent') {
      this.logger.debug(
        { messageId: email.messageId, status: response.status, errorCode: outcome.errorCode },
        'Resend refused an email',
      );
    }
    return outcome;
  }

  private async pace(): Promise<void> {
    const interval = this.options.minIntervalMs;
    if (interval <= 0) return;
    const now = performance.now();
    const wait = this.nextCallAt - now;
    this.nextCallAt = Math.max(now, this.nextCallAt) + interval;
    if (wait > 0) await sleep(wait);
  }
}

/** The JSON body, or undefined when there is none or it is not JSON. */
async function readBody(response: Response): Promise<ResendResponseBody | undefined> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}
