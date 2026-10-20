import { ApiProperty } from '@nestjs/swagger';
import { formatCairoIso } from '../../../common/time/time';
import { MESSAGE_CHANNELS, MESSAGE_STATUSES } from '../enums';
import type { MessageChannel, MessageLogEntry, MessageStatus } from '../types';
import { MessageRelatedResponse } from './message-related.response';

/** One line of the Message log (PRD "Message log"). */
export class MessageSummaryResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 42, description: 'Message id.' })
  id!: number;

  @ApiProperty({
    enum: MESSAGE_CHANNELS,
    enumName: 'MessageChannel',
    nullable: false,
    example: 'email',
    description: '`email` is sent through Resend; `sms` is simulated (recorded, never sent).',
  })
  channel!: MessageChannel;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'staff.invite',
    description:
      'Which message this is, as `<owner>.<event>`: for example `staff.invite`, `staff.password_reset`. Show a friendly label per value; unknown values may appear as new messages are added.',
  })
  template!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'mona.adel@maqady.example',
    description: 'The email address, or the phone number in E.164 for an SMS.',
  })
  recipient!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "You're invited to the Maqady dashboard",
    description: 'The email subject; null for an SMS.',
  })
  subject!: string | null;

  @ApiProperty({
    enum: MESSAGE_STATUSES,
    enumName: 'MessageStatus',
    nullable: false,
    example: 'sent',
    description:
      '`queued`: waiting to be sent, or to be retried after a temporary failure. `sent`: handed to the provider. `failed`: the provider refused it, or every attempt failed; it is not retried.',
  })
  status!: MessageStatus;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    maximum: 10,
    example: 1,
    description: 'Send attempts so far, up to 10.',
  })
  attempts!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'A short machine code for the last failure, such as `timeout`, `http_500`, `validation_error` or `attempts_exhausted`; null when none failed.',
  })
  lastErrorCode!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description:
      'For a `queued` message, when it is next tried (it goes out on the next request to the server after that); null once sent or failed.',
  })
  nextAttemptAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-20T12:00:03+03:00',
    description: 'When the provider accepted it; null until then.',
  })
  sentAt!: string | null;

  @ApiProperty({
    type: () => MessageRelatedResponse,
    nullable: false,
    description: 'The customer, staff member or booking the message is about, by id.',
  })
  related!: MessageRelatedResponse;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-20T12:00:01+03:00',
    description: 'When the message was created (queued); the list is newest first by this time.',
  })
  createdAt!: string;

  static from(entry: MessageLogEntry): MessageSummaryResponse {
    return Object.assign(new MessageSummaryResponse(), summaryFields(entry));
  }
}

/** The summary fields of an entry, shared with the detail response. */
export function summaryFields(entry: MessageLogEntry): MessageSummaryResponse {
  return {
    id: entry.id,
    channel: entry.channel,
    template: entry.template,
    recipient: entry.recipient,
    subject: entry.subject,
    status: entry.status,
    attempts: entry.attempts,
    lastErrorCode: entry.lastErrorCode,
    nextAttemptAt: entry.nextAttemptAt ? formatCairoIso(entry.nextAttemptAt) : null,
    sentAt: entry.sentAt ? formatCairoIso(entry.sentAt) : null,
    related: MessageRelatedResponse.from(entry.related),
    createdAt: formatCairoIso(entry.createdAt),
  };
}
