import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { isPostgresError, SQLSTATE } from '../../common/database/postgres-errors';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { toPage } from '../../common/pagination/cursor';
import type { PageRequest } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { cinemaDateOf, formatCairoDisplay, formatCairoIso } from '../../common/time/time';
import type { CalendarDate } from '../../common/time/types';
import { CatalogReadService } from '../catalog/catalog-read.service';
import type { MovieRef } from '../catalog/types';
import { MessagingService } from '../messaging/messaging.service';
import type { QueueMessageInput } from '../messaging/types';
import { HallReadService } from '../halls/hall-read.service';
import { ZONES } from '../halls/enums';
import type { HallSummary } from '../halls/types';
import { TheaterHoursService } from '../theaters/theater-hours.service';
import { TheaterReadService } from '../theaters/theater-read.service';
import type { OpeningWindow, TheaterSummary, ZonePrices } from '../theaters/types';
import { ShowtimeCancellationService } from './showtime-cancellation.service';
import { ShowtimeReadService } from './showtime-read.service';
import { pricesOf, toAdminShowtime, toShowtimeView } from './showtime-rows';
import { runtimeOf, ShowtimeSchedulingService } from './showtime-scheduling.service';
import { fitsWindow, showtimeSpan, startInstantFor } from './showtime-time';
import { ShowtimeTicketHolderService } from './showtime-ticket-holder.service';
import { SHOWTIME_GAP_CONSTRAINT } from './showtimes.constants';
import { ShowtimesRepository } from './showtimes.repository';
import { showtimeMovedSmsTemplate } from './templates/showtime-moved-sms.template';
import { showtimeMovedTemplate } from './templates/showtime-moved.template';
import type {
  AdminShowtime,
  AdminShowtimeDetail,
  BatchItemDetail,
  BatchItemResult,
  BatchOutcome,
  ConflictDetail,
  CreateShowtimesInput,
  DateCheck,
  ShowtimeAuditDetails,
  ShowtimeChanges,
  ShowtimeCheckOutcome,
  ShowtimeConflict,
  ShowtimeMovedParams,
  ShowtimeMoveColumns,
  ShowtimePriceColumns,
  ShowtimeRow,
  ShowtimeRowUpdate,
  ShowtimeSpan,
  ShowtimeTicketHolder,
  ShowtimeTimeline,
  ScheduleRequest,
  TimelineFilter,
  TimelineHall,
} from './types';

/** The price fields as the audit log names them, by zone. */
const PRICE_FIELDS = { front: 'priceFront', middle: 'priceMiddle', back: 'priceBack' } as const;

/**
 * The admin showtime routes (design §8, §11; PRD "Showtimes", A5): the dry run, the batch
 * create, the move, prices and cancel of one showtime, the manage panel and the timeline.
 *
 * Writes join the request transaction and lock in the order of design §7.1: theater `FOR SHARE`,
 * movie `FOR SHARE`, the showtime `FOR UPDATE`, hall `FOR SHARE`, then the hall's scheduling
 * advisory lock, so two creates or moves in one hall run one after the other. Each insert and each move runs
 * in its own savepoint, so a cleaning-gap violation (`23P01` on `ex_showtimes_hall_cleaning_gap`)
 * is caught, named by one follow-up query, and the transaction carries on. Every write records an
 * audit event with field names and scalars only.
 */
@Injectable()
export class ShowtimesService {
  constructor(
    private readonly showtimes: ShowtimesRepository,
    private readonly scheduling: ShowtimeSchedulingService,
    private readonly reads: ShowtimeReadService,
    private readonly theaters: TheaterReadService,
    private readonly hours: TheaterHoursService,
    private readonly halls: HallReadService,
    private readonly catalog: CatalogReadService,
    private readonly cancellation: ShowtimeCancellationService,
    private readonly ticketHolders: ShowtimeTicketHolderService,
    private readonly messaging: MessagingService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * `POST /admin/showtime-checks`: every check for each date, with suggestions for the dates that
   * don't fit. Reads only, without locks; prices are not checked (they never decide a fit).
   */
  async check(input: ScheduleRequest): Promise<ShowtimeCheckOutcome> {
    const target = await this.scheduling.resolveForRead(input.movieId, input.hallId);
    this.scheduling.assertSchedulable(target, true);
    const results = await this.scheduling.checkDates(target, input.dates, input.startTime, {
      now: this.clock.now(),
      withSuggestions: true,
    });
    const movie = await this.movieRef(input.movieId);
    return {
      movie: movieOf(movie),
      hall: { id: target.hall.id, name: target.hall.name },
      theaterId: target.theater.id,
      startTime: input.startTime,
      results,
    };
  }

  /**
   * `POST /admin/showtimes`: creates the dates that fit, each in its own savepoint, in date
   * order. With `skipUnavailable: false` one date that doesn't fit creates none; in either mode,
   * nothing created is `SHOWTIMES_NOT_CREATED` with every date's result, and the transaction (and
   * the idempotency key) rolls back.
   */
  async createBatch(actor: StaffPrincipal, input: CreateShowtimesInput): Promise<BatchOutcome> {
    return this.transactions.run(async () => {
      const target = await this.scheduling.resolveForWrite(input.movieId, input.hallId);
      this.scheduling.assertSchedulable(target, input.prices !== undefined);
      const prices = input.prices ?? pricesOrFail(target.theater);
      await this.showtimes.lockHallSchedule(target.hall.id);
      const now = this.clock.now();
      const checks = await this.scheduling.checkDates(target, input.dates, input.startTime, {
        now,
        withSuggestions: false,
      });

      const created = new Map<CalendarDate, ShowtimeRow>();
      const outcomes: { check: DateCheck; conflicts: readonly ShowtimeConflict[] }[] = [];
      for (const check of checks) {
        // The forecast of `conflict` is not trusted either way: the constraint decides.
        if ((check.result !== 'available' && check.result !== 'conflict') || !check.span) {
          outcomes.push({ check, conflicts: [] });
          continue;
        }
        const span = check.span;
        const inserted = await this.insertOrConflict(() =>
          this.showtimes.insert({
            movie_id: target.movie.id,
            theater_id: target.theater.id,
            hall_id: target.hall.id,
            starts_at: span.startsAt,
            ends_at: span.endsAt,
            cleaning_ends_at: span.cleaningEndsAt,
            cinema_date: cinemaDateOf(span.startsAt),
            price_front: prices.front.amount,
            price_middle: prices.middle.amount,
            price_back: prices.back.amount,
            currency: prices.front.currency,
            seat_capacity: target.hall.seatCount,
            status: 'scheduled',
            cancel_reason: null,
            cancelled_at: null,
            created_at: now,
            updated_at: now,
          }),
        );
        if (inserted) {
          await this.record(actor, 'showtime.created', inserted.id, {
            metadata: {
              movieId: inserted.movie_id,
              hallId: inserted.hall_id,
              theaterId: inserted.theater_id,
              cinemaDate: inserted.cinema_date,
            },
          });
          created.set(check.cinemaDate, inserted);
          outcomes.push({ check, conflicts: [] });
        } else {
          const conflicts = await this.scheduling.conflictsWith(target.hall.id, span);
          outcomes.push({ check: { ...check, result: 'conflict' }, conflicts });
        }
      }

      const failed = outcomes.filter(({ check }) => !created.has(check.cinemaDate));
      if (created.size === 0 || (!input.skipUnavailable && failed.length > 0)) {
        const results: BatchItemDetail[] = outcomes.map(({ check, conflicts }) => ({
          cinemaDate: check.cinemaDate,
          result: created.has(check.cinemaDate) ? 'available' : check.result,
          conflicts: conflictDetails(conflicts),
        }));
        throw new AppError('SHOWTIMES_NOT_CREATED', undefined, { results });
      }

      const movie = await this.movieRef(target.movie.id);
      const results: BatchItemResult[] = outcomes.map(({ check, conflicts }) => {
        const row = created.get(check.cinemaDate);
        if (row) {
          return {
            cinemaDate: check.cinemaDate,
            result: 'created',
            showtime: this.adminView(row, target.hall, movie, now),
            conflicts: [],
          };
        }
        // Only the checks' failures reach here; `available` became `created` above.
        const result = check.result === 'available' ? 'conflict' : check.result;
        return { cinemaDate: check.cinemaDate, result, showtime: null, conflicts };
      });
      return {
        results,
        createdCount: created.size,
        skippedCount: results.length - created.size,
      };
    });
  }

  /**
   * `PATCH /admin/showtimes/{id}`: a move (`startTime`, optionally `cinemaDate`), new prices, both,
   * or a cancellation. A change to nothing answers the showtime as it is and records nothing.
   */
  async update(
    actor: StaffPrincipal,
    id: number,
    changes: ShowtimeChanges,
  ): Promise<AdminShowtime> {
    return this.transactions.run(async () => {
      const unlocked = await this.showtimes.findById(id);
      if (!unlocked) throw new AppError('NOT_FOUND');
      const theater = await this.theaters.lockForShare(unlocked.theater_id);
      if (!theater) throw new AppError('NOT_FOUND');
      const lockedMovie =
        changes.startTime !== undefined
          ? await this.catalog.lockMovieForShare(unlocked.movie_id)
          : null;
      const row = await this.showtimes.findByIdForUpdate(id);
      if (!row) throw new AppError('NOT_FOUND');
      const now = this.clock.now();

      if (row.status === 'cancelled') throw notEditable('cancelled');
      if (changes.status === 'cancelled' && changes.cancelReason !== undefined) {
        return this.cancel(actor, row, changes.cancelReason, now);
      }
      if (row.starts_at.getTime() <= now.getTime()) throw notEditable('started');

      let move: ShowtimeMoveColumns | null = null;
      let priceColumns: ShowtimePriceColumns | null = null;
      const changedFields: string[] = [];

      if (changes.startTime !== undefined) {
        const startsAt = startInstantFor(changes.cinemaDate ?? row.cinema_date, changes.startTime);
        if (startsAt.getTime() !== row.starts_at.getTime()) {
          if (!lockedMovie) throw new AppError('NOT_FOUND', undefined, { entity: 'movie' });
          const hall = await this.halls.lockForShare(row.hall_id);
          if (!hall) throw new AppError('NOT_FOUND');
          this.scheduling.assertSchedulable({ movie: lockedMovie, hall, theater }, true);
          await this.showtimes.lockHallSchedule(hall.id);
          if (startsAt.getTime() <= now.getTime()) throw startInPast();
          const span = showtimeSpan(startsAt, runtimeOf(lockedMovie));
          const cinemaDate = cinemaDateOf(startsAt);
          const window = await this.hours.windowFor(row.theater_id, cinemaDate);
          if (!fitsWindow(span, window)) {
            throw new AppError('OUTSIDE_OPENING_HOURS', undefined, {
              window: window ? formatWindow(window) : null,
            });
          }
          move = {
            starts_at: span.startsAt,
            ends_at: span.endsAt,
            cleaning_ends_at: span.cleaningEndsAt,
            cinema_date: cinemaDate,
          };
          changedFields.push('startsAt');
        }
      }

      const current = pricesOf(row);
      if (changes.prices) {
        const prices = changes.prices;
        const changedZones = ZONES.filter(
          (zone) =>
            prices[zone].amount !== current[zone].amount ||
            prices[zone].currency !== current[zone].currency,
        );
        if (changedZones.length > 0) {
          changedFields.push(...changedZones.map((zone) => PRICE_FIELDS[zone]));
          priceColumns = {
            price_front: prices.front.amount,
            price_middle: prices.middle.amount,
            price_back: prices.back.amount,
            currency: prices.front.currency,
          };
        }
      }

      if (changedFields.length === 0) return this.adminViewOf(row, now);
      const update: ShowtimeRowUpdate = { ...move, ...priceColumns, updated_at: now };

      let updated: ShowtimeRow;
      if (move) {
        const span: ShowtimeSpan = {
          startsAt: move.starts_at,
          endsAt: move.ends_at,
          cleaningEndsAt: move.cleaning_ends_at,
        };
        const result = await this.insertOrConflict(() => this.showtimes.update(id, update));
        if (!result) {
          const conflicts = await this.scheduling.conflictsWith(row.hall_id, span, id);
          throw new AppError('SHOWTIME_CONFLICT', undefined, {
            conflicts: conflictDetails(conflicts),
          });
        }
        updated = result;
        const notifiedCount = await this.notifyMoved(row, updated, theater, lockedMovie?.title);
        await this.record(actor, 'showtime.moved', id, {
          changedFields,
          metadata: {
            previousStartsAt: formatCairoIso(row.starts_at),
            startsAt: formatCairoIso(updated.starts_at),
            notifiedCount,
          },
        });
      } else {
        updated = await this.showtimes.update(id, update);
        await this.record(actor, 'showtime.prices_changed', id, { changedFields });
      }
      return this.adminViewOf(updated, now);
    });
  }

  /** `GET /admin/showtimes/{id}`: the manage panel, any status. */
  async get(id: number): Promise<AdminShowtimeDetail> {
    const row = await this.showtimes.findById(id);
    if (!row) throw new AppError('NOT_FOUND');
    const theater = await this.theaters.findById(row.theater_id);
    if (!theater) throw new AppError('NOT_FOUND');
    const view = await this.adminViewOf(row, this.clock.now());
    return { ...view, theater: { id: theater.id, name: theater.name, status: theater.status } };
  }

  /**
   * `GET /admin/showtimes`: one theater's cinema date, its opening window, its halls (active ones
   * and any with a showtime that date, by name) and a page of its showtimes by start. A fixed
   * number of queries whatever the page size.
   */
  async timeline(filter: TimelineFilter, page: PageRequest): Promise<ShowtimeTimeline> {
    const theater = await this.theaters.findById(filter.theaterId);
    if (!theater) throw new AppError('NOT_FOUND', undefined, { entity: 'theater' });
    const day = (await this.hours.hoursFor([theater.id], filter.cinemaDate, filter.cinemaDate))
      .get(theater.id)
      ?.at(0);
    const rows = await this.showtimes.listTimeline(filter, page);
    const total = await this.showtimes.countTimeline(filter);
    const hallIdsOnDate = new Set(
      await this.showtimes.hallIdsOnDate(theater.id, filter.cinemaDate),
    );
    const halls = (await this.halls.listByTheaters([theater.id])).get(theater.id) ?? [];
    const hallsById = new Map(halls.map((hall) => [hall.id, hall]));
    const movies = await this.catalog.findMoviesByIds(rows.map((row) => row.movie_id));
    const now = this.clock.now();
    const showtimePage = toPage(
      rows,
      page,
      total,
      (row) => ({ sortKey: row.starts_at.toISOString(), id: row.id }),
      (row) => this.adminView(row, hallsById.get(row.hall_id), movies.get(row.movie_id), now),
    );
    const timelineHalls: TimelineHall[] = halls
      .filter((hall) => hall.status === 'active' || hallIdsOnDate.has(hall.id))
      .map((hall) => ({
        id: hall.id,
        name: hall.name,
        status: hall.status,
        seatCount: hall.seatCount,
      }));
    return {
      theater: { id: theater.id, name: theater.name, status: theater.status },
      cinemaDate: filter.cinemaDate,
      window: day?.window ?? null,
      specialDateLabel: day?.specialDateLabel ?? null,
      halls: timelineHalls,
      items: showtimePage.items,
      nextCursor: showtimePage.nextCursor,
      total: showtimePage.total,
    };
  }

  /**
   * Cancels a scheduled showtime that has not ended (design §7.7): bookings first, through the
   * seam, with the showtime locked; then the status. Final: the slot is free again.
   */
  private async cancel(
    actor: StaffPrincipal,
    row: ShowtimeRow,
    reason: NonNullable<ShowtimeChanges['cancelReason']>,
    now: Date,
  ): Promise<AdminShowtime> {
    if (row.ends_at.getTime() <= now.getTime()) throw notEditable('ended');
    const [view] = await this.reads.viewsOf([row]);
    if (!view) throw new AppError('INTERNAL', 'A showtime could not be read back.');
    const outcome = await this.cancellation.cancelBookings({ showtime: view, reason, actor });
    const updated = await this.showtimes.update(row.id, {
      status: 'cancelled',
      cancel_reason: reason,
      cancelled_at: now,
      updated_at: now,
    });
    await this.record(actor, 'showtime.cancelled', row.id, {
      changedFields: ['status', 'cancelReason'],
      metadata: {
        reason,
        refundedBookingCount: outcome.refundedBookingCount,
        releasedHoldCount: outcome.releasedHoldCount,
        notifiedCount: outcome.notifiedCount,
      },
    });
    return this.adminViewOf(updated, now);
  }

  /**
   * Queues the "showtime moved" email for every ticket holder with an email and the SMS for every
   * one with a phone, in one insert; returns how many messages were queued.
   */
  private async notifyMoved(
    previous: ShowtimeRow,
    updated: ShowtimeRow,
    theater: TheaterSummary,
    movieTitle: string | undefined,
  ): Promise<number> {
    const holders = await this.ticketHolders.listTicketHolders(updated.id);
    if (holders.length === 0) return 0;
    const hall = await this.halls.findById(updated.hall_id);
    const base = {
      movieTitle: movieTitle ?? '',
      theaterName: theater.name,
      hallName: hall?.name ?? '',
      previousStartsAt: formatCairoDisplay(previous.starts_at),
      startsAt: formatCairoDisplay(updated.starts_at),
    };
    const inputs = holders.flatMap((holder) => movedMessagesOf(holder, base));
    const queued = await this.messaging.queueMany(inputs);
    return queued.length;
  }

  /**
   * Runs a write in a savepoint; a cleaning-gap violation rolls the savepoint back and answers
   * null, any other error re-throws.
   */
  private async insertOrConflict(write: () => Promise<ShowtimeRow>): Promise<ShowtimeRow | null> {
    try {
      return await this.transactions.savepoint(write);
    } catch (error) {
      if (
        isPostgresError(error) &&
        error.code === SQLSTATE.EXCLUSION_VIOLATION &&
        error.constraint === SHOWTIME_GAP_CONSTRAINT
      ) {
        return null;
      }
      throw error;
    }
  }

  private async adminViewOf(row: ShowtimeRow, now: Date): Promise<AdminShowtime> {
    const hall = await this.halls.findById(row.hall_id);
    const movie = await this.movieRef(row.movie_id);
    return this.adminView(row, hall ?? undefined, movie, now);
  }

  private adminView(
    row: ShowtimeRow,
    hall: HallSummary | undefined,
    movie: MovieRef | undefined,
    now: Date,
  ): AdminShowtime {
    return toAdminShowtime(toShowtimeView(row, hall), movie, now);
  }

  private async movieRef(id: number): Promise<MovieRef> {
    const movie = (await this.catalog.findMoviesByIds([id])).get(id);
    if (!movie) throw new AppError('NOT_FOUND', undefined, { entity: 'movie' });
    return movie;
  }

  private async record(
    actor: StaffPrincipal,
    action: string,
    showtimeId: number,
    details: ShowtimeAuditDetails,
  ): Promise<void> {
    await this.audit.record({
      actor: { kind: 'staff', id: actor.id },
      action,
      entity: { type: 'showtime', id: showtimeId },
      ...(details.changedFields ? { changedFields: details.changedFields } : {}),
      ...(details.metadata ? { metadata: details.metadata } : {}),
    });
  }
}

/** The theater's default prices; `assertSchedulable` already refused a theater without them. */
function pricesOrFail(theater: TheaterSummary): ZonePrices {
  if (!theater.defaultPrices) {
    throw new AppError('SHOWTIME_NOT_SCHEDULABLE', undefined, { reasons: ['no_prices'] });
  }
  return theater.defaultPrices;
}

function formatWindow(window: OpeningWindow): { opensAt: string; closesAt: string } {
  return { opensAt: formatCairoIso(window.opensAt), closesAt: formatCairoIso(window.closesAt) };
}

function conflictDetails(conflicts: readonly ShowtimeConflict[]): ConflictDetail[] {
  return conflicts.map((conflict) => ({
    showtimeId: conflict.showtimeId,
    movieTitle: conflict.movieTitle,
    startsAt: formatCairoIso(conflict.startsAt),
    endsAt: formatCairoIso(conflict.endsAt),
    cleaningEndsAt: formatCairoIso(conflict.cleaningEndsAt),
  }));
}

function movieOf(movie: MovieRef): AdminShowtime['movie'] {
  return {
    id: movie.id,
    title: movie.title,
    status: movie.status,
    runtimeMinutes: movie.runtimeMinutes,
    ageRating: movie.ageRating,
  };
}

function notEditable(reason: 'started' | 'ended' | 'cancelled'): AppError {
  return new AppError('SHOWTIME_NOT_EDITABLE', undefined, { reason });
}

function startInPast(): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fields: [{ field: 'startTime', messages: ['startTime must be after now'] }],
  });
}

/** The email and the SMS of one ticket holder, as far as they have an email and a phone. */
function movedMessagesOf(
  holder: ShowtimeTicketHolder,
  base: Omit<ShowtimeMovedParams, 'bookingReference'>,
): QueueMessageInput<ShowtimeMovedParams>[] {
  const params: ShowtimeMovedParams = { ...base, bookingReference: holder.bookingReference };
  const related = {
    bookingId: holder.bookingId,
    ...(holder.customerId === null ? {} : { customerId: holder.customerId }),
  };
  return [
    ...(holder.email === null
      ? []
      : [{ template: showtimeMovedTemplate, recipient: holder.email, params, related }]),
    ...(holder.phone === null
      ? []
      : [{ template: showtimeMovedSmsTemplate, recipient: holder.phone, params, related }]),
  ];
}
