import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Module,
  type OnModuleInit,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Knex } from 'knex';
import { AuditService } from '../../src/common/audit/audit.service';
import {
  Admin,
  Customer,
  CurrentPrincipal,
  Guest,
  Public,
  Staff,
} from '../../src/common/auth/access.decorators';
import { PrincipalResolverRegistry } from '../../src/common/auth/principal-resolver.registry';
import type { Principal, TokenAudience, VerifiedAccessToken } from '../../src/common/auth/types';
import { TransactionContext } from '../../src/common/database/transaction-context';
import { TransactionRepository } from '../../src/common/database/transaction.repository';
import { AppError } from '../../src/common/errors/app-error';
import {
  NoIdempotencyStorage,
  NoRequestTransaction,
  Strict,
} from '../../src/common/idempotency/idempotency.decorators';
import { RateLimit } from '../../src/common/rate-limit/rate-limit.decorators';
import { StaffPrincipalResolver } from '../../src/modules/staff/staff-principal.resolver';
import type { ProviderOverride, ResolverEntry } from './types';

/**
 * Test-only routes under `/api/v1/test-foundations`, registered by the integration suites and
 * never by the app. They give the guards, the write interceptor, the transaction context and the
 * audit writer real handlers to run: rows written through the request transaction, a handler
 * that fails on demand, one that deadlocks with a twin, and one route per access level.
 */

export const WIDGETS_TABLE = 'zz_widgets';
export const LOCKS_TABLE = 'zz_locks';
export const LOCK_NAMES = ['a', 'b'] as const;

/** The hold code the guest-payment probe accepts, standing in for a real hold's (U10). */
export const GUEST_HOLD_TOKEN = 'probe-hold-code';

/** How long the deadlock twins wait for each other before giving up (the test then fails). */
const BARRIER_TIMEOUT_MS = 5_000;

export class WidgetBody {
  @IsString()
  @MinLength(1)
  name!: string;
}

export class LockPairBody {
  @IsIn(LOCK_NAMES)
  first!: (typeof LOCK_NAMES)[number];

  @IsString()
  tag!: string;
}

export class AuditProbeBody {
  @IsOptional()
  @IsBoolean()
  fail?: boolean;
}

/** Counters and switches the tests read and set through `app.get(ProbeState)`. */
@Injectable()
export class ProbeState {
  /** How many times each probe handler ran, by handler name. */
  readonly runs = new Map<string, number>();
  /** How many of the next widget creations fail after their insert. */
  failuresLeft = 0;
  /** How long a widget creation waits after its insert, so concurrent requests overlap. */
  delayMs = 0;
  /** Attempts per lock-pair tag. */
  readonly lockAttempts = new Map<string, number>();
  private waiting: (() => void)[] = [];

  count(handler: string): number {
    const next = (this.runs.get(handler) ?? 0) + 1;
    this.runs.set(handler, next);
    return next;
  }

  runsOf(handler: string): number {
    return this.runs.get(handler) ?? 0;
  }

  reset(): void {
    this.runs.clear();
    this.lockAttempts.clear();
    this.failuresLeft = 0;
    this.delayMs = 0;
    this.waiting = [];
  }

  /** Resolves once two callers are waiting, or after the timeout. */
  meetTwin(): Promise<void> {
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      if (this.waiting.length >= 2) {
        for (const release of this.waiting.splice(0)) release();
        return;
      }
      setTimeout(resolve, BARRIER_TIMEOUT_MS).unref();
    });
  }
}

@Injectable()
export class ProbeWidgetRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(name: string): Promise<number> {
    const [row] = await this.db
      .executor()(WIDGETS_TABLE)
      .insert({ name })
      .returning<{ id: number }[]>('id');
    return row!.id;
  }

  /** Locks one row of the lock table until the transaction ends. */
  async lock(name: string): Promise<void> {
    await this.db.executor()(LOCKS_TABLE).select('name').where({ name }).forUpdate();
  }
}

@Public()
@Controller('test-foundations')
export class FoundationsProbeController {
  constructor(
    private readonly state: ProbeState,
    private readonly widgets: ProbeWidgetRepository,
    private readonly db: TransactionContext,
    private readonly audit: AuditService,
    private readonly transactions: TransactionRepository,
  ) {}

  /** A strict write: inserts a widget through the request transaction. */
  @Post('widgets')
  @Strict()
  async createWidget(@Body() body: WidgetBody): Promise<{ id: number; name: string; run: number }> {
    const run = this.state.count('createWidget');
    const id = await this.widgets.insert(body.name);
    if (this.state.delayMs > 0) await sleep(this.state.delayMs);
    if (this.state.failuresLeft > 0) {
      this.state.failuresLeft -= 1;
      throw new AppError('CONFLICT', 'The probe was told to fail.');
    }
    return { id, name: body.name, run };
  }

  /** A write where the key is optional; replies 200 to show the stored status is replayed. */
  @Put('widgets/:id')
  @HttpCode(200)
  renameWidget(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: WidgetBody,
  ): { id: number; name: string; run: number } {
    return { id, name: body.name, run: this.state.count('renameWidget') };
  }

  /** Like an auth route: runs in the transaction, but nothing is stored for its key. */
  @Post('sessions')
  @NoIdempotencyStorage()
  createSession(): { token: string; run: number; inTransaction: boolean } {
    return {
      token: 'secret-token',
      run: this.state.count('createSession'),
      inTransaction: this.db.isActive(),
    };
  }

  /** Like an upload: no request transaction, but the key is still required. */
  @Post('uploads')
  @Strict()
  @NoRequestTransaction()
  createUpload(): { inTransaction: boolean; run: number } {
    return { inTransaction: this.db.isActive(), run: this.state.count('createUpload') };
  }

  @Get('transaction-state')
  readTransactionState(): { inTransaction: boolean } {
    return { inTransaction: this.db.isActive() };
  }

  @Post('transaction-state')
  @HttpCode(200)
  writeTransactionState(): { inTransaction: boolean } {
    return { inTransaction: this.db.isActive() };
  }

  /**
   * Locks `first`, waits for its twin to lock the other row, then locks the other: the two
   * requests deadlock, Postgres aborts one with 40P01, and the interceptor retries it.
   */
  @Post('lock-pairs')
  async lockPair(@Body() body: LockPairBody): Promise<{ tag: string; attempt: number }> {
    const attempt = (this.state.lockAttempts.get(body.tag) ?? 0) + 1;
    this.state.lockAttempts.set(body.tag, attempt);
    const second = body.first === 'a' ? 'b' : 'a';
    await this.widgets.lock(body.first);
    if (attempt === 1) await this.state.meetTwin();
    await this.widgets.lock(second);
    return { tag: body.tag, attempt };
  }

  /** Records an audit event in the request transaction, then fails if asked to. */
  @Post('audit-events')
  async recordAudit(@Body() body: AuditProbeBody): Promise<{ id: number }> {
    const id = await this.audit.record({
      actor: { kind: 'system' },
      action: 'probe.recorded',
      entity: { type: 'probe', id: 7 },
      changedFields: ['title', 'status', 'title'],
      metadata: { seatCount: 2, method: 'cash' },
    });
    if (body.fail) throw new AppError('CONFLICT', 'The probe was told to fail.');
    return { id };
  }

  /** Registers a post-commit hook from inside the request transaction. */
  @Post('hooks')
  async registerHook(): Promise<{ ok: true }> {
    await this.transactions.afterCommit(() => {
      this.state.count('hookRan');
    });
    return { ok: true };
  }
}

/** One route per access level, each answering with the principal the guards resolved. */
@Controller('test-access')
export class AccessProbeController {
  @Public()
  @Get('public')
  publicRoute(@CurrentPrincipal() principal?: Principal): { principal: Principal | null } {
    return { principal: principal ?? null };
  }

  @Guest()
  @Get('guest')
  guestRoute(@CurrentPrincipal() principal?: Principal): { principal: Principal | null } {
    return { principal: principal ?? null };
  }

  @Customer()
  @Get('customer')
  customerRoute(@CurrentPrincipal() principal?: Principal): { principal: Principal | null } {
    return { principal: principal ?? null };
  }

  @Staff()
  @Get('staff')
  staffRoute(@CurrentPrincipal() principal?: Principal): { principal: Principal | null } {
    return { principal: principal ?? null };
  }

  @Admin()
  @Get('admin')
  adminRoute(@CurrentPrincipal() principal?: Principal): { principal: Principal | null } {
    return { principal: principal ?? null };
  }

  /**
   * A guest write whose handler checks the hold code, as the guest hold and payment routes will
   * (U10): anyone without the code gets NOT_FOUND, and the response carries a secret.
   */
  @Guest()
  @Strict()
  @Post('holds/:ref/payments')
  guestPayment(
    @Param('ref') ref: string,
    @Headers('x-hold-token') holdToken?: string,
  ): { ref: string; ticketCode: string } {
    if (holdToken !== GUEST_HOLD_TOKEN) throw new AppError('NOT_FOUND');
    return { ref, ticketCode: 'ticket-secret' };
  }

  /** A customer write: its idempotency scope is the customer. */
  @Customer()
  @Post('customer-writes')
  customerWrite(@CurrentPrincipal() principal?: Principal): { principalId: number | null } {
    return { principalId: principal?.id ?? null };
  }

  @Public()
  @RateLimit('search')
  @Get('searches')
  search(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @RateLimit('search')
  @Get('other-searches')
  otherSearch(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Get('unlimited')
  unlimited(): { ok: true } {
    return { ok: true };
  }
}

/**
 * Principal resolvers for both audiences, standing in for the staff (U2) and customer (U9)
 * modules: each session id maps to a principal, `null` (session gone) or an error to throw.
 */
@Injectable()
export class TestPrincipalResolvers implements OnModuleInit {
  readonly sessions = new Map<string, ResolverEntry>();

  constructor(private readonly registry: PrincipalResolverRegistry) {}

  onModuleInit(): void {
    for (const audience of ['customer', 'staff'] as const) {
      this.registry.register(audience, {
        resolve: (token: VerifiedAccessToken) => this.lookup(audience, token),
      });
    }
  }

  set(audience: TokenAudience, sessionId: number, entry: ResolverEntry): void {
    this.sessions.set(`${audience}:${sessionId}`, entry);
  }

  private lookup(audience: TokenAudience, token: VerifiedAccessToken): Promise<Principal | null> {
    const entry = this.sessions.get(`${audience}:${token.sessionId}`);
    if (entry instanceof AppError) return Promise.reject(entry);
    return Promise.resolve(entry ?? null);
  }
}

@Module({
  controllers: [FoundationsProbeController],
  providers: [ProbeState, ProbeWidgetRepository],
})
export class FoundationsProbeModule {}

@Module({ controllers: [AccessProbeController] })
export class AccessProbeModule {}

@Module({ providers: [TestPrincipalResolvers] })
export class TestPrincipalResolversModule {}

/**
 * Switches the real principal resolvers off, so `TestPrincipalResolversModule` (or no resolver at
 * all) stands in for them: the registry accepts one resolver per audience. Pass as
 * `createTestApp({ overrides: REAL_RESOLVERS_OFF })`. U9 adds the customer resolver here.
 */
export const REAL_RESOLVERS_OFF: readonly ProviderOverride[] = [
  { provide: StaffPrincipalResolver, useValue: {} },
];

export async function createFoundationsProbeTables(knex: Knex, schema: string): Promise<void> {
  await knex.raw(
    'CREATE TABLE IF NOT EXISTS ??.?? (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL)',
    [schema, WIDGETS_TABLE],
  );
  await knex.raw('CREATE TABLE IF NOT EXISTS ??.?? (name TEXT PRIMARY KEY)', [schema, LOCKS_TABLE]);
}

export async function dropFoundationsProbeTables(knex: Knex, schema: string): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.??, ??.??', [schema, WIDGETS_TABLE, schema, LOCKS_TABLE]);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
