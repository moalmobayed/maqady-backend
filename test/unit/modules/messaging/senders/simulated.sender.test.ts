import { SimulatedEmailSender } from '../../../../../src/modules/messaging/senders/simulated-email.sender';
import { SimulatedSmsSender } from '../../../../../src/modules/messaging/senders/simulated-sms.sender';

describe('simulated senders', () => {
  it('records an email as sent at once, with a simulated provider id', async () => {
    await expect(
      new SimulatedEmailSender().send({
        messageId: 7,
        to: 'a@b.co',
        subject: 's',
        text: 't',
        html: 'h',
      }),
    ).resolves.toEqual({ kind: 'sent', providerMessageId: 'simulated-email-7' });
  });

  it('records an SMS as sent at once, with a simulated provider id', async () => {
    await expect(
      new SimulatedSmsSender().send({ messageId: 8, to: '+201001234567', text: 't' }),
    ).resolves.toEqual({ kind: 'sent', providerMessageId: 'simulated-sms-8' });
  });
});
