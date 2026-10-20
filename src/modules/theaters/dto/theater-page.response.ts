import { PageResponseOf } from '../../../common/pagination/dto/page-response.dto';
import { TheaterListItemResponse } from './theater-list-item.response';

/** `GET /admin/theaters`: `{ items, nextCursor, total }` of `TheaterListItemResponse`. */
export const TheaterListItemResponsePage = PageResponseOf(TheaterListItemResponse);
