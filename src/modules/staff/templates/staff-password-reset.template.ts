import { ONE_TIME_TOKEN_LIFETIME_SECONDS } from '../../auth/auth.constants';
import { renderSimpleHtml } from '../../messaging/simple-html';
import type { MessageTemplate } from '../../messaging/types';
import { SET_PASSWORD_PATH } from '../staff.constants';
import type { StaffPasswordResetParams } from '../types';

const LIFETIME_HOURS = ONE_TIME_TOKEN_LIFETIME_SECONDS.staff_password_reset / 3600;

/**
 * The staff "Forgot password" email (PRD "Email and SMS": staff reset → set-password link). The
 * link opens `/admin/set-password?token=…`, the page an invite uses; every stored copy has it
 * redacted (design §13.1).
 */
export const staffPasswordResetTemplate: MessageTemplate<StaffPasswordResetParams> = {
  name: 'staff.password_reset',
  channel: 'email',
  secretParams: ['token'],
  render: ({ fullName, token }, links) => {
    const link = links.oneTime(SET_PASSWORD_PATH, token);
    const asked = 'We received a request to reset your Maqady dashboard password.';
    const within = `Set a new password within ${LIFETIME_HOURS} ${LIFETIME_HOURS === 1 ? 'hour' : 'hours'}.`;
    const ignore =
      "The link works once. If you didn't ask for this, ignore this email; your password stays the same.";
    return {
      subject: 'Reset your Maqady dashboard password',
      text: [`Hello ${fullName},`, asked, `${within}\n${link}`, ignore].join('\n\n'),
      html: renderSimpleHtml({
        heading: `Hello ${fullName}`,
        paragraphs: [asked, within, ignore],
        action: { label: 'Set a new password', url: link },
      }),
    };
  },
};
