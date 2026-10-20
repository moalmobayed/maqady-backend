import { Inject, Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { KNEX } from '../../common/database/database.constants';

@Injectable()
export class HealthRepository {
  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  /** Resolves once the database answers a trivial query; rejects with the driver's error. */
  async ping(): Promise<void> {
    await this.knex.raw('SELECT 1');
  }
}
