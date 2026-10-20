import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { toPage } from '../../common/pagination/cursor';
import type { Page, PageRequest } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { TheaterLifecycleRegistry } from '../theaters/theater-lifecycle.registry';
import { TheaterReadService } from '../theaters/theater-read.service';
import { layoutRows } from './hall-layout';
import { HallLayoutRepository } from './hall-layout.repository';
import { HallLifecycleRegistry } from './hall-lifecycle.registry';
import { HallReadService } from './hall-read.service';
import {
  ACTIVE_HALL_REQUIREMENT,
  DEFAULT_LAYOUT,
  HALL_STATUS_ACTIONS,
  HALL_STATUS_TRANSITIONS,
} from './halls.constants';
import { HallsRepository } from './halls.repository';
import type {
  HallAdminView,
  HallAuditDetails,
  HallChanges,
  HallListFilter,
  HallRow,
  HallSummary,
} from './types';

/**
 * Halls for the admin Halls tab (design §9, §11; PRD "Halls and seat maps", A4): the list, one
 * hall, adding a hall, renaming it, activating and retiring it, and deleting it.
 *
 * Every write joins the request transaction and locks in the order of design §7.1 and §9: the
 * theater `FOR SHARE` first (so publishing, which checks `active_hall` with the theater locked,
 * never interleaves with a hall's status change), then the hall `FOR UPDATE`. Each records an
 * audit event with field names only.
 *
 * The showtime-dependent rules (a hall that ever had a showtime is not deleted; a hall with
 * future showtimes is not retired) are blockers U7 registers with `HallLifecycleRegistry`.
 */
@Injectable()
export class HallsService implements OnModuleInit {
  constructor(
    private readonly halls: HallsRepository,
    private readonly layouts: HallLayoutRepository,
    private readonly reads: HallReadService,
    private readonly lifecycle: HallLifecycleRegistry,
    private readonly theaters: TheaterReadService,
    private readonly theaterLifecycle: TheaterLifecycleRegistry,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * A theater is published only with at least one `active` hall (design §9). The check runs in
   * the publish transaction with the theater locked; hall status changes lock it `FOR SHARE`
   * first, so the two never interleave.
   */
  onModuleInit(): void {
    this.theaterLifecycle.addPublishRequirement({
      key: ACTIVE_HALL_REQUIREMENT,
      isMet: (theaterId) => this.halls.hasActiveHall(theaterId),
    });
  }

  /** `GET /admin/theaters/{id}/halls`: by name then id; `NOT_FOUND` for an unknown theater. */
  async list(
    theaterId: number,
    filter: HallListFilter,
    page: PageRequest,
  ): Promise<Page<HallAdminView>> {
    if (!(await this.theaters.findById(theaterId))) throw new AppError('NOT_FOUND');
    const rows = await this.halls.listByTheater(theaterId, filter, page);
    const total = await this.halls.countByTheater(theaterId, filter);
    const views = await this.viewsOf(rows.slice(0, page.limit));
    const byId = new Map(views.map((view) => [view.id, view]));
    return toPage(
      rows,
      page,
      total,
      (row) => ({ sortKey: row.name, id: row.id }),
      (row) => byId.get(row.id)!,
    );
  }

  /** `GET /admin/halls/{id}` and the answer of every hall write. */
  async view(id: number): Promise<HallAdminView> {
    const row = await this.halls.findById(id);
    if (!row) throw new AppError('NOT_FOUND');
    const [view] = await this.viewsOf([row]);
    return view!;
  }

  /**
   * `POST /admin/theaters/{id}/halls`: a new `draft` hall with the standard 12 × 16 layout
   * (PRD A4). A name the theater already uses, in any letter case, is `CONFLICT`
   * (`uq_halls_theater_id_name`).
   */
  async create(actor: StaffPrincipal, theaterId: number, name: string): Promise<HallAdminView> {
    const id = await this.transactions.run(async () => {
      if (!(await this.theaters.lockForShare(theaterId))) throw new AppError('NOT_FOUND');
      const now = this.clock.now();
      const hall = await this.halls.insert({
        theater_id: theaterId,
        name,
        status: 'draft',
        row_count: DEFAULT_LAYOUT.rowCount,
        seats_per_row: DEFAULT_LAYOUT.seatsPerRow,
        created_at: now,
        updated_at: now,
      });
      await this.layouts.replace(
        hall.id,
        layoutRows(DEFAULT_LAYOUT.rowZones).map((row) => ({
          hall_id: hall.id,
          row_index: row.index,
          row_label: row.label,
          zone: row.zone,
        })),
        [],
      );
      await this.record(actor, 'hall.created', hall.id, { metadata: { theaterId } });
      return hall.id;
    });
    return this.view(id);
  }

  /**
   * `PATCH /admin/halls/{id}`: the name first, then the status.
   *
   * - `draft → active`, `draft → retired` and `active → retired` are allowed; `retired` is final
   *   and an active hall never returns to draft: anything else is `CONFLICT` with
   *   `details.from` and `details.to`.
   * - Retiring needs every retirement blocker to pass (`HALL_NOT_RETIRABLE`, `details.reasons`).
   * - A request that changes nothing writes nothing.
   */
  async update(actor: StaffPrincipal, id: number, changes: HallChanges): Promise<HallAdminView> {
    await this.transactions.run(async () => {
      const hall = await this.lockForWrite(id);
      const rename = changes.name !== undefined && changes.name !== hall.name;
      const to = changes.status ?? hall.status;
      const statusChanges = to !== hall.status;
      if (!rename && !statusChanges) return;

      if (statusChanges) {
        if (!HALL_STATUS_TRANSITIONS[hall.status].includes(to)) {
          throw new AppError(
            'CONFLICT',
            'A hall can be activated from draft and retired from draft or active; a retired hall stays retired.',
            { from: hall.status, to },
          );
        }
        if (to === 'retired') {
          const reasons = (await this.lifecycle.retirementReasons([id])).get(id) ?? [];
          if (reasons.length > 0) throw new AppError('HALL_NOT_RETIRABLE', undefined, { reasons });
        }
      }
      await this.halls.update(id, {
        ...(rename ? { name: changes.name } : {}),
        ...(statusChanges ? { status: to } : {}),
        updated_at: this.clock.now(),
      });
      if (rename) await this.record(actor, 'hall.updated', id, { changedFields: ['name'] });
      if (statusChanges) {
        await this.record(actor, HALL_STATUS_ACTIONS[`${hall.status}>${to}`]!, id, {
          metadata: { from: hall.status, to },
        });
      }
    });
    return this.view(id);
  }

  /**
   * `DELETE /admin/halls/{id}`: only a hall no deletion blocker keeps (`HALL_NOT_DELETABLE`,
   * `details.reasons`), in any status. Its rows and seat marks go with it.
   */
  async delete(actor: StaffPrincipal, id: number): Promise<void> {
    await this.transactions.run(async () => {
      const hall = await this.lockForWrite(id);
      const reasons = (await this.lifecycle.deletionReasons([id])).get(id) ?? [];
      if (reasons.length > 0) throw new AppError('HALL_NOT_DELETABLE', undefined, { reasons });
      await this.halls.deleteById(id);
      await this.record(actor, 'hall.deleted', id, { metadata: { theaterId: hall.theater_id } });
    });
  }

  /**
   * Locks the hall's theater `FOR SHARE` and then the hall `FOR UPDATE`, and returns the hall as
   * locked; `NOT_FOUND` when either is gone. A hall never changes theater, so reading it first
   * to find its theater is safe.
   */
  private async lockForWrite(id: number): Promise<HallRow> {
    const unlocked = await this.halls.findById(id);
    if (!unlocked) throw new AppError('NOT_FOUND');
    if (!(await this.theaters.lockForShare(unlocked.theater_id))) throw new AppError('NOT_FOUND');
    const hall = await this.halls.findByIdForUpdate(id);
    if (!hall) throw new AppError('NOT_FOUND');
    return hall;
  }

  /** Admin views of these halls, in their order: summaries plus whether each can be deleted. */
  private async viewsOf(rows: readonly HallRow[]): Promise<HallAdminView[]> {
    if (rows.length === 0) return [];
    const summaries: HallSummary[] = await this.reads.summariesOf(rows);
    const reasons = await this.lifecycle.deletionReasons(rows.map((row) => row.id));
    return summaries.map((summary) => ({
      ...summary,
      deletable: (reasons.get(summary.id) ?? []).length === 0,
    }));
  }

  private async record(
    actor: StaffPrincipal,
    action: string,
    id: number,
    extra: HallAuditDetails = {},
  ): Promise<void> {
    await this.audit.record({
      actor: { kind: 'staff', id: actor.id },
      action,
      entity: { type: 'hall', id },
      ...extra,
    });
  }
}
