import type { OutgoingEmail, SendOutcome } from '../types';

/**
 * Sends one email (design §13.1). Also the Nest token: inject `EmailSender`. The app provides
 * `ResendEmailSender` or `SimulatedEmailSender` from `EMAIL_DRIVER`; integration tests replace
 * it at this boundary. A sender never throws for a delivery problem: it reports a `SendOutcome`.
 */
export abstract class EmailSender {
  abstract send(email: OutgoingEmail): Promise<SendOutcome>;
}
