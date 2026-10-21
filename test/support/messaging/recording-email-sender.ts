import { EmailSender } from '../../../src/modules/messaging/senders/email-sender';
import type { OutgoingEmail, SendOutcome } from '../../../src/modules/messaging/types';
import type { EmailResponder } from '../types';

/** The default answer: accepted, with a provider id derived from the message id. */
export const recordedProviderId = (messageId: number): string => `recorded-${messageId}`;

const accept: EmailResponder = (email) => ({
  kind: 'sent',
  providerMessageId: recordedProviderId(email.messageId),
});

/**
 * Stands in for Resend at the `EmailSender` boundary (testing policy: only genuinely external
 * services are replaced). It records every email it is handed, answers with a scripted
 * `SendOutcome`, and can hold sends until released, so tests can make drains overlap.
 */
export class RecordingEmailSender extends EmailSender {
  readonly calls: OutgoingEmail[] = [];
  private responder: EmailResponder = accept;
  private held = false;
  private waiters: (() => void)[] = [];

  async send(email: OutgoingEmail): Promise<SendOutcome> {
    this.calls.push(email);
    if (this.held) await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.responder(email);
  }

  /** Answers every following email with `responder`. */
  respondWith(responder: EmailResponder): void {
    this.responder = responder;
  }

  /** Makes every following send wait until `release()`. */
  hold(): void {
    this.held = true;
  }

  release(): void {
    this.held = false;
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  /** How many sends are waiting for `release()`. */
  heldCount(): number {
    return this.waiters.length;
  }

  reset(): void {
    this.release();
    this.calls.length = 0;
    this.responder = accept;
  }
}

/** Polls `condition` every few milliseconds; fails after `timeoutMs`. */
export async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
