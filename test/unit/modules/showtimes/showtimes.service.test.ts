import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import { resolveException } from '../../../../src/common/errors/error-mapping';
import { money } from '../../../../src/common/money/money';
import { cinemaMinuteToInstant, formatCairoIso } from '../../../../src/common/time/time';
import type { CatalogReadService } from '../../../../src/modules/catalog/catalog-read.service';
import type { MovieRef } from '../../../../src/modules/catalog/types';
import type { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import type { HallSummary } from '../../../../src/modules/halls/types';
import type { MessagingService } from '../../../../src/modules/messaging/messaging.service';
import { ShowtimeCancellationService } from '../../../../src/modules/showtimes/showtime-cancellation.service';
import type { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import { toShowtimeView } from '../../../../src/modules/showtimes/showtime-rows';
import { ShowtimeSchedulingService } from '../../../../src/modules/showtimes/showtime-scheduling.service';
import { ShowtimeTicketHolderService } from '../../../../src/modules/showtimes/showtime-ticket-holder.service';
import type { ShowtimesRepository } from '../../../../src/modules/showtimes/showtimes.repository';
import { ShowtimesService } from '../../../../src/modules/showtimes/showtimes.service';
import type {
  BusySlotRow,
  NewShowtimeRow,
  ShowtimeCancellationInput,
  ShowtimeCancellationOutcome,
  ShowtimeRow,
  ShowtimeTicketHolder,
} from '../../../../src/modules/showtimes/types';
import type { TheaterHoursService } from '../../../../src/modules/theaters/theater-hours.service';
import type { TheaterReadService } from '../../../../src/modules/theaters/theater-read.service';
import type { CinemaDateHours, TheaterSummary } from '../../../../src/modules/theaters/types';
import { TestClock } from '../../../support/clock';
import { postgresError, socketError } from '../../../support/errors';

// Summer time starts Friday 24 April 2026 at 00:00: 00:30 that night does not exist.
const NOW = new Date('2026-04-20T10:00:00+02:00');
const ACTOR: StaffPrincipal = { kind: 'staff', id: 3, sessionId: 30, role: 'admin' };
const PRICES = { front: money(15000), middle: money(19000), back: money(23000) };

const HALL: HallSummary = {
  id: 5,
  theaterId: 2,
  name: 'Hall 1',
  status: 'active',
  rowCount: 12,
  seatsPerRow: 16,
  seatCount: 192,
  wheelchairCount: 0,
  zoneSeatCounts: { front: 48, middle: 80, back: 64 },
  createdAt: NOW,
  updatedAt: NOW,
};
const THEATER: TheaterSummary = { id: 2, name: 'Zamalek', status: 'active', defaultPrices: PRICES };
const MOVIE: MovieRef = {
  id: 9,
  title: 'The Nile Light',
  status: 'now_showing',
  runtimeMinutes: 120,
  ageRating: '12+',
  poster: null,
};

/** Open 12:00 to 04:00 every date but the 25th. */
function hoursOf(dates: string[]): CinemaDateHours[] {
  return dates.map((cinemaDate) => ({
    cinemaDate,
    weekday: 1,
    source: 'weekly',
    specialDateLabel: null,
    hours: null,
    window:
      cinemaDate === '2026-04-25'
        ? null
        : {
            opensAt: cinemaMinuteToInstant(cinemaDate, 12 * 60),
            closesAt: cinemaMinuteToInstant(cinemaDate, 28 * 60),
          },
  }));
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`);) {
    dates.push(day.toISOString().slice(0, 10));
    day = new Date(day.getTime() + 86_400_000);
  }
  return dates;
}

function showtimeRow(overrides: Partial<ShowtimeRow> = {}): ShowtimeRow {
  return {
    id: 40,
    movie_id: MOVIE.id,
    theater_id: THEATER.id,
    hall_id: HALL.id,
    starts_at: new Date('2026-04-27T19:30:00+03:00'),
    ends_at: new Date('2026-04-27T21:30:00+03:00'),
    cleaning_ends_at: new Date('2026-04-27T21:50:00+03:00'),
    cinema_date: '2026-04-27',
    price_front: 15000,
    price_middle: 19000,
    price_back: 23000,
    currency: 'EGP',
    seat_capacity: 192,
    status: 'scheduled',
    cancel_reason: null,
    cancelled_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

class RecordingCancellation extends ShowtimeCancellationService {
  constructor(private readonly calls: string[]) {
    super();
  }

  cancelBookings(input: ShowtimeCancellationInput): Promise<ShowtimeCancellationOutcome> {
    this.calls.push(`cancelBookings ${input.showtime.id} ${input.reason} ${input.showtime.status}`);
    return Promise.resolve({ refundedBookingCount: 1, releasedHoldCount: 2, notifiedCount: 3 });
  }
}

class FixedHolders extends ShowtimeTicketHolderService {
  holders: ShowtimeTicketHolder[] = [];

  listTicketHolders(): Promise<readonly ShowtimeTicketHolder[]> {
    return Promise.resolve(this.holders);
  }
}

describe('ShowtimesService', () => {
  let repository: jest.Mocked<ShowtimesRepository>;
  let theaters: jest.Mocked<TheaterReadService>;
  let hours: jest.Mocked<TheaterHoursService>;
  let halls: jest.Mocked<HallReadService>;
  let catalog: jest.Mocked<CatalogReadService>;
  let reads: jest.Mocked<ShowtimeReadService>;
  let messaging: jest.Mocked<MessagingService>;
  let audit: jest.Mocked<AuditService>;
  let transactions: jest.Mocked<TransactionRepository>;
  let holders: FixedHolders;
  let clock: TestClock;
  let calls: string[];
  let busy: BusySlotRow[];
  let service: ShowtimesService;
  let nextId: number;

  beforeEach(() => {
    calls = [];
    busy = [];
    nextId = 100;
    clock = new TestClock(NOW);
    repository = {
      overlapping: jest.fn(() => Promise.resolve(busy)),
      lockHallSchedule: jest.fn(() => {
        calls.push('schedule lock');
        return Promise.resolve();
      }),
      insert: jest.fn((row: NewShowtimeRow) => {
        calls.push(`insert ${row.cinema_date}`);
        const id = nextId;
        nextId += 1;
        return Promise.resolve({ ...row, id } as ShowtimeRow);
      }),
      findById: jest.fn(() => Promise.resolve(showtimeRow())),
      findByIdForUpdate: jest.fn(() => {
        calls.push('showtime FOR UPDATE');
        return Promise.resolve(showtimeRow());
      }),
      update: jest.fn((id: number, changes: Partial<ShowtimeRow>) => {
        calls.push(`update ${Object.keys(changes).sort().join(',')}`);
        return Promise.resolve(showtimeRow({ id, ...changes }));
      }),
    } as unknown as jest.Mocked<ShowtimesRepository>;
    theaters = {
      findById: jest.fn().mockResolvedValue(THEATER),
      lockForShare: jest.fn(() => {
        calls.push('theater FOR SHARE');
        return Promise.resolve(THEATER);
      }),
    } as unknown as jest.Mocked<TheaterReadService>;
    hours = {
      hoursFor: jest.fn((ids: number[], from: string, to: string) =>
        Promise.resolve(new Map(ids.map((id) => [id, hoursOf(datesBetween(from, to))]))),
      ),
      windowFor: jest.fn((_id: number, date: string) =>
        Promise.resolve(hoursOf([date])[0]!.window),
      ),
    } as unknown as jest.Mocked<TheaterHoursService>;
    halls = {
      findById: jest.fn().mockResolvedValue(HALL),
      lockForShare: jest.fn(() => {
        calls.push('hall FOR SHARE');
        return Promise.resolve(HALL);
      }),
    } as unknown as jest.Mocked<HallReadService>;
    catalog = {
      findMoviesByIds: jest.fn().mockResolvedValue(new Map([[MOVIE.id, MOVIE]])),
      lockMovieForShare: jest.fn(() => {
        calls.push('movie FOR SHARE');
        return Promise.resolve(MOVIE);
      }),
    } as unknown as jest.Mocked<CatalogReadService>;
    reads = {
      viewsOf: jest.fn((rows: ShowtimeRow[]) =>
        Promise.resolve(rows.map((row) => toShowtimeView(row, HALL))),
      ),
    } as unknown as jest.Mocked<ShowtimeReadService>;
    messaging = {
      queueMany: jest.fn((inputs: unknown[]) =>
        Promise.resolve(inputs.map((_, index) => ({ id: index + 1 }))),
      ),
    } as unknown as jest.Mocked<MessagingService>;
    audit = { record: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<AuditService>;
    transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
      savepoint: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as jest.Mocked<TransactionRepository>;
    holders = new FixedHolders();
    const scheduling = new ShowtimeSchedulingService(repository, theaters, hours, halls, catalog);
    service = new ShowtimesService(
      repository,
      scheduling,
      reads,
      theaters,
      hours,
      halls,
      catalog,
      new RecordingCancellation(calls),
      holders,
      messaging,
      transactions,
      audit,
      clock,
    );
  });

  const busyAt = (id: number, startsAt: string): BusySlotRow => {
    const start = new Date(startsAt);
    return {
      id,
      movie_id: MOVIE.id,
      starts_at: start,
      ends_at: new Date(start.getTime() + 120 * 60_000),
      cleaning_ends_at: new Date(start.getTime() + 140 * 60_000),
    };
  };
  const gapViolation = () =>
    postgresError({ code: '23P01', constraint: 'ex_showtimes_hall_cleaning_gap' });
  const request = {
    movieId: MOVIE.id,
    hallId: HALL.id,
    // Out of order on purpose: the answer is in date order.
    dates: ['2026-04-27', '2026-04-19', '2026-04-26', '2026-04-23', '2026-04-25'],
    startTime: '00:30',
  };

  describe('check', () => {
    it('answers each date with the first check that fails, in date order, from one hours read and one conflict query', async () => {
      busy = [busyAt(70, '2026-04-27T00:00:00+03:00')];
      const outcome = await service.check(request);
      expect(outcome.results.map((check) => [check.cinemaDate, check.result])).toEqual([
        ['2026-04-19', 'in_past'],
        ['2026-04-23', 'time_does_not_exist'],
        ['2026-04-25', 'outside_opening_hours'],
        ['2026-04-26', 'conflict'],
        ['2026-04-27', 'available'],
      ]);
      expect(outcome.results[3]!.conflicts).toEqual([
        expect.objectContaining({ showtimeId: 70, movieTitle: MOVIE.title }),
      ]);
      expect(outcome.results[1]!.span).toBeNull();
      expect(hours.hoursFor).toHaveBeenCalledTimes(1);
      expect(hours.hoursFor).toHaveBeenCalledWith([THEATER.id], '2026-04-19', '2026-04-27');
      expect(repository.overlapping).toHaveBeenCalledTimes(1);
      // A dry run reads without locks and writes nothing.
      expect(calls).toEqual([]);
      expect(repository.insert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses a movie that is not Now showing and a hall that is not active, together', async () => {
      catalog.findMoviesByIds.mockResolvedValue(
        new Map([[MOVIE.id, { ...MOVIE, status: 'coming_soon' }]]),
      );
      halls.findById.mockResolvedValue({ ...HALL, status: 'draft' });
      const error = await rejection(service.check(request));
      expect(error.code).toBe('SHOWTIME_NOT_SCHEDULABLE');
      expect(error.details).toEqual({ reasons: ['movie_not_now_showing', 'hall_not_active'] });
    });
  });

  describe('createBatch', () => {
    const dates = ['2026-04-26', '2026-04-27', '2026-04-28'];

    it('locks theater, movie, hall and the hall schedule in that order, then inserts each date in a savepoint', async () => {
      const outcome = await service.createBatch(ACTOR, {
        ...request,
        dates,
        startTime: '19:30',
        skipUnavailable: false,
      });
      expect(calls).toEqual([
        'theater FOR SHARE',
        'movie FOR SHARE',
        'hall FOR SHARE',
        'schedule lock',
        'insert 2026-04-26',
        'insert 2026-04-27',
        'insert 2026-04-28',
      ]);
      expect(transactions.savepoint).toHaveBeenCalledTimes(3);
      expect(outcome).toMatchObject({ createdCount: 3, skippedCount: 0 });
      expect(repository.insert.mock.calls[0]![0]).toMatchObject({
        price_front: 15000,
        seat_capacity: 192,
        status: 'scheduled',
        cinema_date: '2026-04-26',
      });
      expect(audit.record).toHaveBeenCalledTimes(3);
    });

    it('turns a gap violation into a conflict and carries on, naming the blocker', async () => {
      repository.insert.mockImplementationOnce(() => Promise.reject(gapViolation()));
      busy = [busyAt(71, '2026-04-26T20:00:00+03:00')];
      const outcome = await service.createBatch(ACTOR, {
        ...request,
        dates,
        startTime: '19:30',
        skipUnavailable: true,
      });
      expect(outcome.results.map((item) => [item.cinemaDate, item.result])).toEqual([
        ['2026-04-26', 'conflict'],
        ['2026-04-27', 'created'],
        ['2026-04-28', 'created'],
      ]);
      expect(outcome.results[0]!.conflicts.map((conflict) => conflict.showtimeId)).toEqual([71]);
      expect(outcome).toMatchObject({ createdCount: 2, skippedCount: 1 });
    });

    it('creates nothing when a date fails without skipUnavailable, or when nothing fits', async () => {
      repository.insert
        .mockImplementationOnce((row: NewShowtimeRow) =>
          Promise.resolve({ ...row, id: 1 } as ShowtimeRow),
        )
        .mockImplementationOnce(() => Promise.reject(gapViolation()));
      const strict = await rejection(
        service.createBatch(ACTOR, {
          ...request,
          dates,
          startTime: '19:30',
          skipUnavailable: false,
        }),
      );
      expect(strict.code).toBe('SHOWTIMES_NOT_CREATED');
      expect(
        (strict.details!.results as { cinemaDate: string; result: string }[]).map((item) => [
          item.cinemaDate,
          item.result,
        ]),
      ).toEqual([
        ['2026-04-26', 'available'],
        ['2026-04-27', 'conflict'],
        ['2026-04-28', 'available'],
      ]);

      const none = await rejection(
        service.createBatch(ACTOR, {
          ...request,
          dates: ['2026-04-23', '2026-04-25'],
          skipUnavailable: true,
        }),
      );
      expect(none.code).toBe('SHOWTIMES_NOT_CREATED');
      expect(none.details!.results).toEqual([
        { cinemaDate: '2026-04-23', result: 'time_does_not_exist', conflicts: [] },
        { cinemaDate: '2026-04-25', result: 'outside_opening_hours', conflicts: [] },
      ]);
    });

    it('re-throws any other database error from an insert', async () => {
      for (const error of [
        postgresError({ code: '23P01', constraint: 'ex_some_other_constraint' }),
        postgresError({ code: '23505', constraint: 'showtimes_pkey' }),
      ]) {
        repository.insert.mockImplementationOnce(() => Promise.reject(error));
        await expect(
          service.createBatch(ACTOR, {
            ...request,
            dates,
            startTime: '19:30',
            skipUnavailable: true,
          }),
        ).rejects.toBe(error);
      }
    });

    it('refuses a theater without default prices unless prices are given', async () => {
      theaters.lockForShare.mockResolvedValue({ ...THEATER, defaultPrices: null });
      const error = await rejection(
        service.createBatch(ACTOR, {
          ...request,
          dates,
          startTime: '19:30',
          skipUnavailable: true,
        }),
      );
      expect(error.details).toEqual({ reasons: ['no_prices'] });
      const outcome = await service.createBatch(ACTOR, {
        ...request,
        dates,
        startTime: '19:30',
        skipUnavailable: true,
        prices: { ...PRICES, front: money(9000) },
      });
      expect(outcome.createdCount).toBe(3);
      expect(repository.insert.mock.calls[0]![0].price_front).toBe(9000);
    });

    it('lets a datastore outage through, so it answers 503', async () => {
      const outage = socketError('ECONNREFUSED');
      transactions.run.mockRejectedValueOnce(outage);
      const caught = await service
        .createBatch(ACTOR, { ...request, dates, startTime: '19:30', skipUnavailable: true })
        .catch((error: unknown) => error);
      expect(caught).toBe(outage);
      expect(resolveException(caught)).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    });
  });

  describe('update', () => {
    it('writes nothing for a move to the same start without new prices', async () => {
      const view = await service.update(ACTOR, 40, { startTime: '19:30' });
      expect(view.startsAt).toEqual(showtimeRow().starts_at);
      expect(repository.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(messaging.queueMany).not.toHaveBeenCalled();
    });

    it('refuses by the clock: started for a move or prices, ended for a cancel, and a cancelled one', async () => {
      clock.set(new Date('2026-04-27T19:30:00+03:00'));
      for (const changes of [{ startTime: '20:00' }, { prices: PRICES }]) {
        const error = await rejection(service.update(ACTOR, 40, changes));
        expect([error.code, error.details]).toEqual([
          'SHOWTIME_NOT_EDITABLE',
          { reason: 'started' },
        ]);
      }
      clock.set(new Date('2026-04-27T21:30:00+03:00'));
      const ended = await rejection(
        service.update(ACTOR, 40, { status: 'cancelled', cancelReason: 'low_sales' }),
      );
      expect(ended.details).toEqual({ reason: 'ended' });
      repository.findByIdForUpdate.mockResolvedValue(
        showtimeRow({ status: 'cancelled', cancel_reason: 'low_sales', cancelled_at: NOW }),
      );
      const cancelled = await rejection(service.update(ACTOR, 40, { prices: PRICES }));
      expect(cancelled.details).toEqual({ reason: 'cancelled' });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('cancels through the seam once, under the showtime lock, before the status changes', async () => {
      const view = await service.update(ACTOR, 40, {
        status: 'cancelled',
        cancelReason: 'technical_issue',
      });
      expect(calls).toEqual([
        'theater FOR SHARE',
        'showtime FOR UPDATE',
        'cancelBookings 40 technical_issue scheduled',
        'update cancel_reason,cancelled_at,status,updated_at',
      ]);
      expect(view.status).toBe('cancelled');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'showtime.cancelled',
          metadata: {
            reason: 'technical_issue',
            refundedBookingCount: 1,
            releasedHoldCount: 2,
            notifiedCount: 3,
          },
        }),
      );
    });

    it('moves under the lock order, then notifies every holder in one queueMany call', async () => {
      holders.holders = [
        {
          bookingId: 1,
          bookingReference: 'MQ-AAAAAA',
          customerId: 8,
          email: 'a@example.com',
          phone: '+201001234567',
        },
        {
          bookingId: 2,
          bookingReference: 'MQ-BBBBBB',
          customerId: null,
          email: null,
          phone: '+201001234568',
        },
      ];
      const view = await service.update(ACTOR, 40, { startTime: '21:00' });
      expect(calls).toEqual([
        'theater FOR SHARE',
        'movie FOR SHARE',
        'showtime FOR UPDATE',
        'hall FOR SHARE',
        'schedule lock',
        'update cinema_date,cleaning_ends_at,ends_at,starts_at,updated_at',
      ]);
      expect(formatCairoIso(view.startsAt)).toBe('2026-04-27T21:00:00+03:00');
      expect(messaging.queueMany).toHaveBeenCalledTimes(1);
      const inputs = messaging.queueMany.mock.calls[0]![0];
      expect(inputs.map((input) => [input.template.name, input.recipient, input.related])).toEqual([
        ['showtime.moved', 'a@example.com', { bookingId: 1, customerId: 8 }],
        ['showtime.moved_sms', '+201001234567', { bookingId: 1, customerId: 8 }],
        ['showtime.moved_sms', '+201001234568', { bookingId: 2 }],
      ]);
      expect(inputs[0]!.params).toMatchObject({
        previousStartsAt: 'Mon 27 Apr 2026, 19:30',
        startsAt: 'Mon 27 Apr 2026, 21:00',
        theaterName: THEATER.name,
        hallName: HALL.name,
      });
    });

    it('answers a gap violation on a move with SHOWTIME_CONFLICT, without notifying', async () => {
      repository.update.mockImplementationOnce(() => Promise.reject(gapViolation()));
      busy = [busyAt(72, '2026-04-27T22:00:00+03:00')];
      const error = await rejection(service.update(ACTOR, 40, { startTime: '21:00' }));
      expect(error.code).toBe('SHOWTIME_CONFLICT');
      expect((error.details!.conflicts as { showtimeId: number }[])[0]!.showtimeId).toBe(72);
      expect(repository.overlapping).toHaveBeenLastCalledWith(
        HALL.id,
        new Date('2026-04-27T21:00:00+03:00'),
        new Date('2026-04-27T23:20:00+03:00'),
        40,
      );
      expect(messaging.queueMany).not.toHaveBeenCalled();
    });
  });
});
