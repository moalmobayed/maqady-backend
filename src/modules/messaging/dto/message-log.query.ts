import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { IsIsoInstant } from '../../../common/time/iso-instant.validator';
import { MESSAGE_CHANNELS, MESSAGE_STATUSES } from '../enums';
import type { MessageChannel, MessageStatus } from '../types';

/** `GET /admin/messages?channel=&status=&from=&to=&cursor=&limit=`. */
export class MessageLogQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: MESSAGE_CHANNELS,
    enumName: 'MessageChannel',
    nullable: false,
    example: 'email',
    description: 'Only emails, or only SMS.',
  })
  @IsOptional()
  @IsIn(MESSAGE_CHANNELS)
  channel?: MessageChannel;

  @ApiPropertyOptional({
    enum: MESSAGE_STATUSES,
    enumName: 'MessageStatus',
    nullable: false,
    example: 'failed',
    description: 'Only messages in this delivery status.',
  })
  @IsOptional()
  @IsIn(MESSAGE_STATUSES)
  status?: MessageStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T00:00:00+03:00',
    description:
      'Only messages created at or after this instant (inclusive). ISO 8601 with its offset; send the start of the first Cairo day picked.',
  })
  @IsOptional()
  @IsIsoInstant()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-17T00:00:00+03:00',
    description:
      'Only messages created before this instant (exclusive). ISO 8601 with its offset; send the start of the day after the last Cairo day picked. Must be later than `from`.',
  })
  @IsOptional()
  @IsIsoInstant()
  to?: string;
}
