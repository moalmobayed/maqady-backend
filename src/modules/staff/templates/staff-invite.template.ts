import { ONE_TIME_TOKEN_LIFETIME_SECONDS } from '../../auth/auth.constants';
import { renderSimpleHtml } from '../../messaging/simple-html';
import type { MessageTemplate } from '../../messaging/types';
import { SET_PASSWORD_PATH, STAFF_ROLE_LABELS } from '../staff.constants';
import type { StaffInviteParams } from '../types';

const LIFETIME_HOURS = ONE_TIME_TOKEN_LIFETIME_SECONDS.staff_invite / 3600;

/**
 * The invite email (PRD "Email and SMS": staff invited → set-password link). The link opens
 * `/admin/set-password?token=…`; every stored copy has it redacted (design §13.1).
 */
export const staffInviteTemplate: MessageTemplate<StaffInviteParams> = {
  name: 'staff.invite',
  channel: 'email',
  secretParams: ['token'],
  render: ({ fullName, role, token }, links) => {
    const link = links.oneTime(SET_PASSWORD_PATH, token);
    const invited = `An admin has invited you to the Maqady dashboard as ${STAFF_ROLE_LABELS[role]}.`;
    const within = `Set your password within ${LIFETIME_HOURS} hours.`;
    const ignore =
      "The link works once. If you weren't expecting this invite, you can ignore this email.";
    return {
      subject: "You're invited to the Maqady dashboard",
      text: [`Hello ${fullName},`, invited, `${within}\n${link}`, ignore].join('\n\n'),
      html: renderSimpleHtml({
        heading: `Hello ${fullName}`,
        paragraphs: [invited, within, ignore],
        action: { label: 'Set your password', url: link },
      }),
    };
  },
};
