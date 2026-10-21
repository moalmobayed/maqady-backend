import { renderSimpleHtml } from '../../../src/modules/messaging/simple-html';
import type { MessageTemplate } from '../../../src/modules/messaging/types';
import type { OneTimeLinkParams, SmsNoticeParams } from '../types';

/** The page the test one-time link opens, as a real verification link would (PRD v2). */
export const ONE_TIME_LINK_PATH = '/verify-email';

/** An email with a one-time link, shaped like the verification and invite templates to come. */
export const oneTimeLinkTemplate: MessageTemplate<OneTimeLinkParams> = {
  name: 'test.one_time_link',
  channel: 'email',
  secretParams: ['token'],
  render: ({ name, token }, links) => {
    const link = links.oneTime(ONE_TIME_LINK_PATH, token);
    return {
      subject: `Confirm your email, ${name}`,
      text: `Hello ${name},\n\nConfirm your email: ${link}\n\nThe link works once, for 24 hours.`,
      html: renderSimpleHtml({
        heading: `Hello ${name}`,
        paragraphs: ['Confirm your email address. The link works once, for 24 hours.'],
        action: { label: 'Confirm email', url: link },
      }),
    };
  },
};

/** A plain SMS. */
export const smsNoticeTemplate: MessageTemplate<SmsNoticeParams> = {
  name: 'test.sms_notice',
  channel: 'sms',
  secretParams: [],
  render: ({ text }) => ({ text }),
};
