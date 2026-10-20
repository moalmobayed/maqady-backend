import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Admin } from '../../common/auth/access.decorators';
import { toPageRequest } from '../../common/pagination/cursor';
import type { Page } from '../../common/pagination/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { MessageDetailResponse } from './dto/message-detail.response';
import { MessageLogQuery } from './dto/message-log.query';
import { MessageParams } from './dto/message.params';
import { MessageSummaryResponsePage } from './dto/message-summary-page.response';
import { MessageSummaryResponse } from './dto/message-summary.response';
import { MessageLogService } from './message-log.service';

@ApiTags('Admin: messages')
@Controller('admin/messages')
export class MessageLogController {
  constructor(private readonly messageLog: MessageLogService) {}

  @Get()
  @Admin()
  @ApiOperation({
    summary: 'List messages',
    description:
      'Admin only: the Message log. Every email and SMS the system queued, sent or simulated, newest first, with time, channel, recipient, subject, delivery status and the customer, staff member or booking it relates to.\n\n- Filter by `channel`, `status`, and a time range: `from` (inclusive) and `to` (exclusive), as ISO 8601 instants with their offset.\n- One-time links (invites, resets, verification) are never shown: they read `[one-time link hidden]`.\n- Cursor-paginated: pass `nextCursor` back as `cursor`.',
  })
  @ApiOkResponse({
    type: MessageSummaryResponsePage,
    description: 'One page of messages',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async listMessages(@Query() query: MessageLogQuery): Promise<Page<MessageSummaryResponse>> {
    const page = await this.messageLog.list(
      {
        ...(query.channel !== undefined ? { channel: query.channel } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.from !== undefined ? { from: new Date(query.from) } : {}),
        ...(query.to !== undefined ? { to: new Date(query.to) } : {}),
      },
      toPageRequest(query, 'instant'),
    );
    return { ...page, items: page.items.map((entry) => MessageSummaryResponse.from(entry)) };
  }

  @Get(':id')
  @Admin()
  @ApiOperation({
    summary: 'Open a message',
    description:
      'Admin only: one message from the Message log, with its subject and bodies exactly as stored. One-time links read `[one-time link hidden]`; the real link exists only in the email the recipient received. Show `bodyHtml` in a sandboxed `iframe`.',
  })
  @ApiOkResponse({
    type: MessageDetailResponse,
    description: 'The message',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async getMessage(@Param() params: MessageParams): Promise<MessageDetailResponse> {
    return MessageDetailResponse.fromDetail(await this.messageLog.get(params.id));
  }
}
