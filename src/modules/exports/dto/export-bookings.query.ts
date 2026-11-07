import { OmitType } from '@nestjs/swagger';
import { AdminBookingsQuery } from '../../bookings/dto/admin-bookings.query';

/**
 * `GET /admin/exports/bookings.csv` (PRD "Bookings (current filters)"): exactly the filters of
 * `GET /admin/bookings`, validated by the same decorators, without `cursor` and `limit`: the file
 * is the whole filtered list.
 */
export class ExportBookingsQuery extends OmitType(AdminBookingsQuery, [
  'cursor',
  'limit',
] as const) {}
