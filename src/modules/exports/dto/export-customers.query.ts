import { OmitType } from '@nestjs/swagger';
import { AdminCustomersQuery } from '../../admin-customers/dto/admin-customers.query';

/**
 * `GET /admin/exports/customers.csv` (PRD "Customers (current filters)"): exactly the filters of
 * `GET /admin/customers`, validated by the same decorators, without `cursor` and `limit`.
 */
export class ExportCustomersQuery extends OmitType(AdminCustomersQuery, [
  'cursor',
  'limit',
] as const) {}
