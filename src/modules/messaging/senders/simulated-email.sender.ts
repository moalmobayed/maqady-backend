import { Injectable, Logger } from '@nestjs/common';
import type { OutgoingEmail, SendOutcome } from '../types';
import { EmailSender } from './email-sender';

/**
 * `EMAIL_DRIVER=simulated`: records every email as sent at once, without contacting anyone, for
 * local runs and CI. The message stays readable in `messages` (with one-time links redacted).
 */
@Injectable()
export class SimulatedEmailSender extends EmailSender {
  private readonly logger = new Logger(SimulatedEmailSender.name);

  send(email: OutgoingEmail): Promise<SendOutcome> {
    this.logger.log({ messageId: email.messageId }, 'Simulated email recorded as sent');
    return Promise.resolve({
      kind: 'sent',
      providerMessageId: `simulated-email-${email.messageId}`,
    });
  }
}
