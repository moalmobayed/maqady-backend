import { ApiProperty } from '@nestjs/swagger';
import { formatCairoIso } from '../../../common/time/time';
import type { MessageLogDetail } from '../types';
import { MessageSummaryResponse, summaryFields } from './message-summary.response';

/** One message opened from the Message log: what was stored, with one-time links hidden. */
export class MessageDetailResponse extends MessageSummaryResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    example:
      'Hello Mona Adel,\n\nAn admin has invited you to the Maqady dashboard as Box office.\n\nSet your password within 72 hours.\n[one-time link hidden]',
    description:
      'The plain-text body as stored. Invite, reset and verification links read `[one-time link hidden]`: they are only in the email itself.',
  })
  bodyText!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '<!doctype html><html><body>…</body></html>',
    description:
      'The HTML body of an email as stored, a full document with one-time links hidden; null for an SMS. Show it in a sandboxed `iframe` (`sandbox` with no permissions, `srcdoc`), never inserted into the page.',
  })
  bodyHtml!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c',
    description: "The provider's message id once sent (Resend's email id); null until then.",
  })
  providerMessageId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-20T12:00:03+03:00',
    description: 'When the delivery state last changed.',
  })
  updatedAt!: string;

  static fromDetail(detail: MessageLogDetail): MessageDetailResponse {
    return Object.assign(new MessageDetailResponse(), {
      ...summaryFields(detail),
      bodyText: detail.bodyText,
      bodyHtml: detail.bodyHtml,
      providerMessageId: detail.providerMessageId,
      updatedAt: formatCairoIso(detail.updatedAt),
    });
  }
}
