import { renderSimpleHtml } from '../../messaging/simple-html';
import type { MessageTemplate } from '../../messaging/types';
import { VERIFY_EMAIL_PATH } from '../customers.constants';
import type { CustomerVerifyEmailParams } from '../types';

/**
 * PRD "Email and SMS": "Account created → Verification link". Sent at registration and on
 * "resend"; the link opens `/verify-email?token=` and works for 24 hours (design §10.5). Stored
 * copies show the link redacted (§13.1).
 */
export const customerVerifyEmailTemplate: MessageTemplate<CustomerVerifyEmailParams> = {
  name: 'customer.verify_email',
  channel: 'email',
  secretParams: ['token'],
  render: ({ fullName, token }, links) => {
    const link = links.oneTime(VERIFY_EMAIL_PATH, token);
    const intro = 'Welcome to Maqady. Please confirm your email address.';
    const validity = 'This link works for 24 hours.';
    const ignore = "If you didn't create an account, you can ignore this email.";
    return {
      subject: 'Confirm your email for Maqady',
      text: [`Hello ${fullName},`, `${intro} ${validity}`, `Confirm email: ${link}`, ignore].join(
        '\n\n',
      ),
      html: renderSimpleHtml({
        heading: `Hello ${fullName}`,
        paragraphs: [`${intro} ${validity}`, ignore],
        action: { label: 'Confirm email', url: link },
      }),
    };
  },
};
