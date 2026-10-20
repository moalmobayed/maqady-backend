import { PageResponseOf } from '../../../common/pagination/dto/page-response.dto';
import { MessageSummaryResponse } from './message-summary.response';

/** `GET /admin/messages`: `{ items, nextCursor, total }` of `MessageSummaryResponse`. */
export const MessageSummaryResponsePage = PageResponseOf(MessageSummaryResponse);
