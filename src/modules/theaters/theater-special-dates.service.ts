import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import type { FieldError } from '../../common/errors/types';
import { Clock } from '../../common/time/clock';
import { cinemaDateOf } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { hoursProblems, mergeHours, toHoursSpec } from './opening-hours';
import { TheaterHoursRepository } from './theater-hours.repository';
import { toSpecialDate } from './theater-rows';
import { TheatersService } from './theaters.service';
import type { SpecialDate, SpecialDateChanges, SpecialDateInput, SpecialDateRow } from './types';

const PAST_DATE_MESSAGE = "cinemaDate must be today's cinema date or later";

/**
 * Holiday hours (design §8, PRD A4 "Special dates"): a special date replaces a theater's weekly
 * hours on one cinema date, with other hours or closed.
 *
 * - A special date is never created for, or changed into or on, a cinema date before today's
 *   (by the `Clock`); a past one can only be deleted. A second one on the same date is `CONFLICT`
 *   (`uq_theater_special_dates_theater_id_cinema_date`).
 * - Existing showtimes are untouched by a change (spec Q1); new scheduling checks the new hours.
 * - Every write locks the theater first, like every theater write, and is audited.
 */
@Injectable()
export class TheaterSpecialDatesService {
  constructor(
    private readonly hours: TheaterHoursRepository,
    private readonly theaters: TheatersService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async create(
    actor: StaffPrincipal,
    theaterId: number,
    input: SpecialDateInput,
  ): Promise<SpecialDate> {
    return this.transactions.run(async () => {
      await this.theaters.lockForWrite(theaterId);
      const problems = [...this.dateProblems(input.cinemaDate), ...hoursProblems(input)];
      if (problems.length > 0) throw invalid(problems);

      const hours = toHoursSpec(input);
      const now = this.clock.now();
      const row = await this.hours.insertSpecialDate({
        theater_id: theaterId,
        cinema_date: input.cinemaDate,
        label: input.label,
        is_closed: hours.closed,
        opens_minute: hours.opensMinute,
        closes_minute: hours.closesMinute,
        created_at: now,
        updated_at: now,
      });
      await this.theaters.touch(theaterId);
      await this.record(actor, 'theater_special_date.created', row);
      return toSpecialDate(row);
    });
  }

  /** Changes any field; the hours that result are checked as a whole. Nothing to change: no write. */
  async update(
    actor: StaffPrincipal,
    theaterId: number,
    id: number,
    changes: SpecialDateChanges,
  ): Promise<SpecialDate> {
    return this.transactions.run(async () => {
      await this.theaters.lockForWrite(theaterId);
      const row = await this.hours.findSpecialDate(theaterId, id);
      if (!row) throw new AppError('NOT_FOUND');

      const cinemaDate = changes.cinemaDate ?? row.cinema_date;
      const label = changes.label ?? row.label;
      const merged = mergeHours(
        { closed: row.is_closed, opensMinute: row.opens_minute, closesMinute: row.closes_minute },
        changes,
      );
      // A past special date changes nothing that matters any more, so it can only be deleted.
      const problems = [...this.dateProblems(cinemaDate), ...merged.problems];
      if (problems.length > 0) throw invalid(problems);

      const { hours } = merged;
      const changedFields = [
        ...(cinemaDate !== row.cinema_date ? ['cinemaDate'] : []),
        ...(label !== row.label ? ['label'] : []),
        ...(hours.closed !== row.is_closed ? ['closed'] : []),
        ...(hours.opensMinute !== row.opens_minute ? ['opens'] : []),
        ...(hours.closesMinute !== row.closes_minute ? ['closes'] : []),
      ];
      if (changedFields.length === 0) return toSpecialDate(row);

      const updated = await this.hours.updateSpecialDate(id, {
        cinema_date: cinemaDate,
        label,
        is_closed: hours.closed,
        opens_minute: hours.opensMinute,
        closes_minute: hours.closesMinute,
        updated_at: this.clock.now(),
      });
      await this.theaters.touch(theaterId);
      await this.record(actor, 'theater_special_date.updated', updated, changedFields);
      return toSpecialDate(updated);
    });
  }

  async delete(actor: StaffPrincipal, theaterId: number, id: number): Promise<void> {
    await this.transactions.run(async () => {
      await this.theaters.lockForWrite(theaterId);
      const row = await this.hours.findSpecialDate(theaterId, id);
      if (!row) throw new AppError('NOT_FOUND');
      await this.hours.deleteSpecialDate(id);
      await this.theaters.touch(theaterId);
      await this.record(actor, 'theater_special_date.deleted', row);
    });
  }

  private dateProblems(cinemaDate: CalendarDate): FieldError[] {
    const today = cinemaDateOf(this.clock.now());
    return cinemaDate < today ? [{ field: 'cinemaDate', messages: [PAST_DATE_MESSAGE] }] : [];
  }

  private async record(
    actor: StaffPrincipal,
    action: string,
    row: SpecialDateRow,
    changedFields: readonly string[] = [],
  ): Promise<void> {
    await this.audit.record({
      actor: { kind: 'staff', id: actor.id },
      action,
      entity: { type: 'theater_special_date', id: row.id },
      changedFields,
      metadata: { theaterId: row.theater_id, cinemaDate: row.cinema_date },
    });
  }
}

function invalid(fields: readonly FieldError[]): AppError {
  return new AppError('VALIDATION_FAILED', undefined, { fields });
}
