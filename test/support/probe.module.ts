import { Body, Controller, Get, Injectable, Module, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import { IsArray, IsString, MinLength, ValidateNested } from 'class-validator';
import type { Knex } from 'knex';
import { Public } from '../../src/common/auth/access.decorators';
import { TransactionContext } from '../../src/common/database/transaction-context';

/**
 * Test-only routes under `/api/v1/test-probe`. The scaffold has no write endpoints yet, so these
 * give the global ValidationPipe, the exception filter and the request log something real to
 * handle: a validated body, an unexpected error, a unique violation from Postgres, and the
 * client address behind a proxy.
 */

export const PROBE_TABLE = 'zz_probe_items';
export const PROBE_CONSTRAINT = 'uq_zz_probe_items_code';

export class ProbeSeat {
  @IsString()
  label!: string;
}

export class ProbeBody {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProbeSeat)
  seats!: ProbeSeat[];
}

export class ProbeItemBody {
  @IsString()
  code!: string;
}

@Injectable()
export class ProbeRepository {
  constructor(private readonly db: TransactionContext) {}

  async insertItem(code: string): Promise<void> {
    await this.db.executor()(PROBE_TABLE).insert({ code });
  }
}

@Public()
@Controller('test-probe')
export class ProbeController {
  constructor(private readonly probeRepository: ProbeRepository) {}

  @Post('echo')
  echo(@Body() body: ProbeBody): ProbeBody {
    return body;
  }

  /** The client address Express derives, given the trusted proxy hops. */
  @Get('client-ip')
  clientIp(@Req() request: Request): { ip: string | undefined } {
    return { ip: request.ip };
  }

  @Get('internal-error')
  internalError(): never {
    throw new Error('probe internal failure');
  }

  @Post('items')
  async createItem(@Body() body: ProbeItemBody): Promise<{ created: true }> {
    await this.probeRepository.insertItem(body.code);
    return { created: true };
  }
}

@Module({ controllers: [ProbeController], providers: [ProbeRepository] })
export class ProbeModule {}

/** The table behind `POST /test-probe/items`, with a unique constraint to violate. */
export async function createProbeTable(knex: Knex, schema: string): Promise<void> {
  await knex.raw(
    `CREATE TABLE IF NOT EXISTS ??.?? (
       id BIGSERIAL PRIMARY KEY,
       code TEXT NOT NULL,
       CONSTRAINT ?? UNIQUE (code)
     )`,
    [schema, PROBE_TABLE, PROBE_CONSTRAINT],
  );
}

export async function dropProbeTable(knex: Knex, schema: string): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.??', [schema, PROBE_TABLE]);
}
