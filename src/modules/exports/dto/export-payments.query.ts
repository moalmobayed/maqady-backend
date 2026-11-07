import { OmitType } from '@nestjs/swagger';
import { AdminPaymentsQuery } from '../../analytics/dto/admin-payments.query';

/**
 * `GET /admin/exports/payments.csv` (PRD "Payments for accounting (chosen period)"): exactly the
 * filters of `GET /admin/payments`, validated by the same decorators, without `cursor` and
 * `limit`; `dateFrom` / `dateTo` choose the period.
 */
export class ExportPaymentsQuery extends OmitType(AdminPaymentsQuery, [
  'cursor',
  'limit',
] as const) {}
