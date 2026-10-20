import { PageResponseOf } from '../../../common/pagination/dto/page-response.dto';
import { StaffMemberResponse } from './staff-member.response';

/** `GET /admin/staff`: `{ items, nextCursor, total }` of `StaffMemberResponse`. */
export const StaffMemberResponsePage = PageResponseOf(StaffMemberResponse);
