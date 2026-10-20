import { renderSimpleHtml } from '../../messaging/simple-html';
import type { MessageTemplate } from '../../messaging/types';
import { RESET_PASSWORD_PATH } from '../customers.constants';
import type { CustomerPasswordResetParams } from '../types';

/**
 * PRD "Email and SMS": "Forgot password, or admin sends a reset → Reset link". The link opens
 * `/reset-password?token=` and works once, for 1 hour (design §10.5). Stored copies show the link
 * redacted (§13.1).
 */
export const customerPasswordResetTemplate: MessageTemplate<CustomerPasswordResetParams> = {
  name: 'customer.password_reset',
  channel: 'email',
  secretParams: ['token'],
  render: ({ fullName, token }, links) => {
    const link = links.oneTime(RESET_PASSWORD_PATH, token);
    const intro = 'We received a request to reset your Maqady password.';
    const validity = 'This link works once, for 1 hour.';
    const ignore = "If you didn't ask for this, ignore this email; your password stays the same.";
    return {
      subject: 'Reset your Maqady password',
      text: [
        `Hello ${fullName},`,
        `${intro} ${validity}`,
        `Set a new password: ${link}`,
        ignore,
      ].join('\n\n'),
      html: renderSimpleHtml({
        heading: `Hello ${fullName}`,
        paragraphs: [`${intro} ${validity}`, ignore],
        action: { label: 'Set a new password', url: link },
      }),
    };
  },
};
