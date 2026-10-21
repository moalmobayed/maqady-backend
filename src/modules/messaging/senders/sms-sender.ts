import type { OutgoingSms, SendOutcome } from '../types';

/** Sends one SMS (design §13.1). Also the Nest token: inject `SmsSender`. v1 only simulates. */
export abstract class SmsSender {
  abstract send(sms: OutgoingSms): Promise<SendOutcome>;
}
