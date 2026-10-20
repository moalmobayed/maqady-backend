import { MovieLifecycleRegistry } from '../../../../src/modules/catalog/movie-lifecycle.registry';
import { HallLifecycleRegistry } from '../../../../src/modules/halls/hall-lifecycle.registry';
import type { HallLayout } from '../../../../src/modules/halls/types';
import { MessageTemplateRegistry } from '../../../../src/modules/messaging/message-template.registry';
import { ShowtimeLifecycleHooks } from '../../../../src/modules/showtimes/showtime-lifecycle.hooks';
import type { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import { ShowtimeSeatClaimService } from '../../../../src/modules/showtimes/showtime-seat-claim.service';
import type { ShowtimesRepository } from '../../../../src/modules/showtimes/showtimes.repository';
import { showtimeMovedSmsTemplate } from '../../../../src/modules/showtimes/templates/showtime-moved-sms.template';
import { showtimeMovedTemplate } from '../../../../src/modules/showtimes/templates/showtime-moved.template';
import { TheaterLifecycleRegistry } from '../../../../src/modules/theaters/theater-lifecycle.registry';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T12:00:00+03:00');

class FixedClaims extends ShowtimeSeatClaimService {
  constructor(private readonly ids: number[]) {
    super();
  }

  showtimeIdsWithLiveClaims(showtimeIds: readonly number[]): Promise<ReadonlySet<number>> {
    return Promise.resolve(new Set(showtimeIds.filter((id) => this.ids.includes(id))));
  }
}

describe('ShowtimeLifecycleHooks', () => {
  let showtimes: jest.Mocked<ShowtimesRepository>;
  let reads: jest.Mocked<ShowtimeReadService>;
  let halls: HallLifecycleRegistry;
  let theaters: TheaterLifecycleRegistry;
  let movies: MovieLifecycleRegistry;
  let templates: MessageTemplateRegistry;

  const init = (claimed: number[] = []): void => {
    new ShowtimeLifecycleHooks(
      showtimes,
      reads,
      new FixedClaims(claimed),
      halls,
      theaters,
      movies,
      templates,
      new TestClock(NOW),
    ).onModuleInit();
  };

  beforeEach(() => {
    showtimes = {
      hallIdsWithShowtimes: jest.fn().mockResolvedValue([2]),
      hallIdsWithUnendedShowtimes: jest.fn().mockResolvedValue([3]),
      lockFutureInHall: jest.fn().mockResolvedValue(undefined),
      refreshCapacity: jest.fn().mockResolvedValue(4),
      existsForTheater: jest.fn().mockResolvedValue(true),
      existsForMovie: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<ShowtimesRepository>;
    reads = {
      listUnendedInHall: jest.fn().mockResolvedValue([
        { showtimeId: 10, startsAt: NOW, movieTitle: 'A' },
        { showtimeId: 11, startsAt: NOW, movieTitle: 'B' },
      ]),
    } as unknown as jest.Mocked<ShowtimeReadService>;
    halls = new HallLifecycleRegistry();
    theaters = new TheaterLifecycleRegistry();
    movies = new MovieLifecycleRegistry();
    templates = new MessageTemplateRegistry();
  });

  it('registers the hall blockers, answered for many halls in one repository call', async () => {
    init();
    expect(await halls.deletionReasons([1, 2])).toEqual(
      new Map([
        [1, []],
        [2, ['has_showtimes']],
      ]),
    );
    expect(await halls.retirementReasons([3, 4])).toEqual(
      new Map([
        [3, ['has_future_showtimes']],
        [4, []],
      ]),
    );
    expect(showtimes.hallIdsWithShowtimes).toHaveBeenCalledWith([1, 2]);
    expect(showtimes.hallIdsWithUnendedShowtimes).toHaveBeenCalledWith([3, 4], NOW);
  });

  it('locks upcoming showtimes before the hall and refreshes their capacity after a save', async () => {
    init();
    const [capacity, inUse] = halls.layoutParticipants();
    expect([capacity?.key, inUse?.key]).toEqual(['showtime_capacity', 'hall_in_use']);
    await capacity!.beforeLock!(5);
    expect(showtimes.lockFutureInHall).toHaveBeenCalledWith(5, NOW);
    await capacity!.afterSave!(5, { seatCount: 120 } as HallLayout);
    expect(showtimes.refreshCapacity).toHaveBeenCalledWith(5, 120, NOW);
  });

  it('reports the unended showtimes with a live seat claim as blocking the layout', async () => {
    init([11]);
    const inUse = halls.layoutParticipants()[1]!;
    expect(await inUse.blockingShowtimes!(5)).toEqual([
      { showtimeId: 11, startsAt: NOW, movieTitle: 'B' },
    ]);
    expect(reads.listUnendedInHall).toHaveBeenCalledWith(5);
    reads.listUnendedInHall.mockResolvedValueOnce([]);
    expect(await inUse.blockingShowtimes!(5)).toEqual([]);
  });

  it('registers has_showtimes for theaters and movies, and the two templates', async () => {
    init();
    const [theaterBlocker] = theaters.deletionBlockers();
    expect(theaterBlocker?.key).toBe('has_showtimes');
    expect(await theaterBlocker!.blocks(7)).toBe(true);
    expect(showtimes.existsForTheater).toHaveBeenCalledWith(7);
    expect(await movies.deletionBlockersOf(8)).toEqual([]);
    expect(showtimes.existsForMovie).toHaveBeenCalledWith(8);
    expect(templates.isRegistered(showtimeMovedTemplate)).toBe(true);
    expect(templates.isRegistered(showtimeMovedSmsTemplate)).toBe(true);
  });

  it('fails the start when registered twice', () => {
    init();
    expect(() => init()).toThrow(/already registered|taken/);
  });
});
