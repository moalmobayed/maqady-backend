import { Injectable } from '@nestjs/common';
import { DEFAULT_EXPORT_BATCH_SIZE } from './exports.constants';

/**
 * How the CSV exports read their lists (design §13.4): `batchSize` rows per page query, so a
 * download holds one batch in memory whatever its size. A provider, so an integration test can
 * read in batches of 2 with real wiring and see several batches join up.
 */
@Injectable()
export class ExportOptions {
  readonly batchSize: number = DEFAULT_EXPORT_BATCH_SIZE;
}
