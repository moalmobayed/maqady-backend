import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { formatCairoIso } from '../../common/time/time';
import { TheaterReadService } from '../theaters/theater-read.service';
import { layoutRows, validateLayout } from './hall-layout';
import { HallLayoutRepository } from './hall-layout.repository';
import { HallLifecycleRegistry } from './hall-lifecycle.registry';
import { HallReadService } from './hall-read.service';
import { toHallLayout } from './hall-rows';
import { MAX_BLOCKING_SHOWTIMES } from './halls.constants';
import { HallsRepository } from './halls.repository';
import type {
  HallBlockingShowtime,
  HallInUseShowtime,
  HallLayout,
  HallLayoutInput,
  HallRow,
} from './types';

/**
 * The hall layout editor (design §9; PRD "Halls and seat maps", A4): read a layout, and replace
 * it whole (size, row zones, seat marks) in one transaction.
 *
 * A replace locks in this order: the theater `FOR SHARE`, each layout participant's
 * `beforeLock` (U7 locks the hall's future showtimes, keeping "showtime before hall" of §7.1),
 * then the hall `FOR UPDATE`, so it waits for in-flight holds that hold the hall `FOR SHARE`.
 * With the hall locked it asks the participants for blocking showtimes (`HALL_IN_USE`), writes
 * the layout, and lets them react (`afterSave`). Anything thrown rolls all of it back.
 */
@Injectable()
export class HallLayoutService {
  constructor(
    private readonly halls: HallsRepository,
    private readonly layouts: HallLayoutRepository,
    private readonly reads: HallReadService,
    private readonly lifecycle: HallLifecycleRegistry,
    private readonly theaters: TheaterReadService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** `GET /admin/halls/{id}/layout`. */
  async get(hallId: number): Promise<HallLayout> {
    const layout = await this.reads.findLayout(hallId);
    if (!layout) throw new AppError('NOT_FOUND');
    return layout;
  }

  /**
   * `PUT /admin/halls/{id}/layout`. Refused with `NOT_FOUND` for an unknown hall, `CONFLICT`
   * (`details.status: 'retired'`) for a retired one, `VALIDATION_FAILED` for an invalid layout
   * (every problem at once) and `HALL_IN_USE` while a participant reports a blocking showtime.
   */
  async replace(
    actor: StaffPrincipal,
    hallId: number,
    input: HallLayoutInput,
  ): Promise<HallLayout> {
    return this.transactions.run(async () => {
      const unlocked = await this.halls.findById(hallId);
      if (!unlocked) throw new AppError('NOT_FOUND');
      refuseRetired(unlocked);
      validateLayout(input);

      if (!(await this.theaters.lockForShare(unlocked.theater_id))) {
        throw new AppError('NOT_FOUND');
      }
      const participants = this.lifecycle.layoutParticipants();
      for (const participant of participants) await participant.beforeLock?.(hallId);
      const hall = await this.halls.findByIdForUpdate(hallId);
      if (!hall) throw new AppError('NOT_FOUND');
      refuseRetired(hall);

      const blocking: HallBlockingShowtime[] = [];
      for (const participant of participants) {
        blocking.push(...((await participant.blockingShowtimes?.(hallId)) ?? []));
      }
      if (blocking.length > 0) {
        throw new AppError('HALL_IN_USE', undefined, { showtimes: blockingDetails(blocking) });
      }

      const updated = await this.halls.update(hallId, {
        row_count: input.rowCount,
        seats_per_row: input.seatsPerRow,
        updated_at: this.clock.now(),
      });
      const rows = layoutRows(input.rowZones);
      await this.layouts.replace(
        hallId,
        rows.map((row) => ({
          hall_id: hallId,
          row_index: row.index,
          row_label: row.label,
          zone: row.zone,
        })),
        input.seatMarks.map((mark) => ({
          hall_id: hallId,
          row_label: mark.rowLabel,
          seat_number: mark.seatNumber,
          kind: mark.kind,
        })),
      );
      const layout = toHallLayout(updated, {
        seatsPerRow: input.seatsPerRow,
        rows,
        seatMarks: [...input.seatMarks].sort(
          (a, b) => a.rowLabel.localeCompare(b.rowLabel) || a.seatNumber - b.seatNumber,
        ),
      });
      for (const participant of participants) await participant.afterSave?.(hallId, layout);

      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'hall.layout_replaced',
        entity: { type: 'hall', id: hallId },
        metadata: {
          rowCount: layout.rowCount,
          seatsPerRow: layout.seatsPerRow,
          seatCount: layout.seatCount,
          wheelchairCount: layout.wheelchairCount,
        },
      });
      return layout;
    });
  }
}

function refuseRetired(hall: HallRow): void {
  if (hall.status === 'retired') {
    throw new AppError('CONFLICT', "A retired hall's layout can't change.", { status: 'retired' });
  }
}

/** `HALL_IN_USE` details: the soonest showtimes first, at most `MAX_BLOCKING_SHOWTIMES`. */
function blockingDetails(showtimes: readonly HallBlockingShowtime[]): HallInUseShowtime[] {
  const unique = new Map(showtimes.map((showtime) => [showtime.showtimeId, showtime]));
  return [...unique.values()]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.showtimeId - b.showtimeId)
    .slice(0, MAX_BLOCKING_SHOWTIMES)
    .map((showtime) => ({
      id: showtime.showtimeId,
      startsAt: formatCairoIso(showtime.startsAt),
      movieTitle: showtime.movieTitle,
    }));
}
