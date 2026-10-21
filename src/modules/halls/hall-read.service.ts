import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import { HallLayoutRepository } from './hall-layout.repository';
import { HallChildren } from './hall-rows';
import { HallsRepository } from './halls.repository';
import type { HallLayout, HallRow, HallStatus, HallSummary } from './types';

/**
 * Halls and layouts as other units read them (exported by `HallsModule`):
 *
 * - U7 schedules into a hall: `findById()`, then `lockForShare()` in its write transaction
 *   (design §7.1 step 3), and lists a theater's halls on the timeline with `listByTheaters()`;
 * - U8 shows halls and hall counts (`listByTheaters(ids, ['active'])`) and seat maps
 *   (`findLayout()`);
 * - U10 validates held seats against `findLayout()` under `lockForShare()`.
 *
 * Every read of many halls costs three queries whatever their number: the halls, their rows,
 * their seat marks.
 */
@Injectable()
export class HallReadService {
  constructor(
    private readonly halls: HallsRepository,
    private readonly layouts: HallLayoutRepository,
    private readonly context: TransactionContext,
  ) {}

  /** A hall in any status; null when there is none. */
  async findById(id: number): Promise<HallSummary | null> {
    const row = await this.halls.findById(id);
    if (!row) return null;
    return (await this.summariesOf([row]))[0] ?? null;
  }

  /**
   * These halls in any status, by id; unknown ids are absent. Three queries whatever their number
   * (U7: the halls of a page of showtimes, for names and "from" prices).
   */
  async findByIds(ids: readonly number[]): Promise<ReadonlyMap<number, HallSummary>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const summaries = await this.summariesOf(await this.halls.findByIds(unique));
    return new Map(summaries.map((summary) => [summary.id, summary]));
  }

  /**
   * Locks the hall `FOR SHARE` in the open transaction and returns it; null when there is none.
   * A layout save or a hall write (rename, status, delete) waits until that transaction ends, so
   * the layout and status read here stay true while it runs. Lock the showtime first and the
   * hall second (design §7.1).
   */
  async lockForShare(id: number): Promise<HallSummary | null> {
    if (!this.context.isActive()) {
      throw new AppError('INTERNAL', 'lockForShare() needs an open transaction.');
    }
    const row = await this.halls.findByIdForShare(id);
    if (!row) return null;
    return (await this.summariesOf([row]))[0] ?? null;
  }

  /** A hall's layout; null when there is no such hall. */
  async findLayout(hallId: number): Promise<HallLayout | null> {
    return (await this.findLayouts([hallId])).get(hallId) ?? null;
  }

  /** The layouts of these halls, by hall id; missing halls are absent from the map. */
  async findLayouts(hallIds: readonly number[]): Promise<ReadonlyMap<number, HallLayout>> {
    const rows = await this.halls.findByIds([...new Set(hallIds)]);
    const children = await this.childrenOf(rows);
    return new Map(rows.map((row) => [row.id, children.layout(row)]));
  }

  /**
   * The halls of these theaters, by theater id and then by name, optionally only in
   * `statuses`. A theater without halls maps to an empty list.
   */
  async listByTheaters(
    theaterIds: readonly number[],
    statuses?: readonly HallStatus[],
  ): Promise<ReadonlyMap<number, readonly HallSummary[]>> {
    const ids = [...new Set(theaterIds)];
    const rows = await this.halls.listByTheaterIds(ids, statuses);
    const summaries = await this.summariesOf(rows);
    const byTheater = new Map<number, HallSummary[]>(ids.map((id) => [id, []]));
    for (const summary of summaries) byTheater.get(summary.theaterId)?.push(summary);
    return byTheater;
  }

  /** The summaries of these hall rows, in their order, in two queries whatever their number. */
  async summariesOf(rows: readonly HallRow[]): Promise<HallSummary[]> {
    const children = await this.childrenOf(rows);
    return rows.map((row) => children.summary(row));
  }

  private async childrenOf(rows: readonly HallRow[]): Promise<HallChildren> {
    const ids = rows.map((row) => row.id);
    // One after the other: inside a transaction they would share one connection.
    const hallRows = await this.layouts.rowsOf(ids);
    const marks = await this.layouts.marksOf(ids);
    return new HallChildren(hallRows, marks);
  }
}
