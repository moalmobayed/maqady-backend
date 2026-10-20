import { PageResponseOf } from '../../../common/pagination/dto/page-response.dto';
import { HallResponse } from './hall.response';

/** `GET /admin/theaters/{id}/halls`: `{ items, nextCursor, total }` of `HallResponse`. */
export const HallResponsePage = PageResponseOf(HallResponse);
