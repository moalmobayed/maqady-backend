import { Injectable, Logger } from '@nestjs/common';
import type { OutgoingSms, SendOutcome } from '../types';
import { SmsSender } from './sms-sender';

/**
 * v1's only SMS sender (ADR 0004): no free service texts arbitrary numbers, so an SMS is
 * recorded as sent on its first attempt, right after commit, and shows in the Message log.
 */
@Injectable()
export class SimulatedSmsSender extends SmsSender {
  private readonly logger = new Logger(SimulatedSmsSender.name);

  send(sms: OutgoingSms): Promise<SendOutcome> {
    this.logger.log({ messageId: sms.messageId }, 'Simulated SMS recorded as sent');
    return Promise.resolve({ kind: 'sent', providerMessageId: `simulated-sms-${sms.messageId}` });
  }
}
