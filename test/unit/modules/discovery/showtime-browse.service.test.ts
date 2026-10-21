import { AppError } from '../../../../src/common/errors/app-error';
import { money } from '../../../../src/common/money/money';
import type { CatalogReadService } from '../../../../src/modules/catalog/catalog-read.service';
import type { MovieRef, MovieSummary } from '../../../../src/modules/catalog/types';
import { ShowtimeBrowseService } from '../../../../src/modules/discovery/showtime-browse.service';
import type { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import type { ShowtimeView } from '../../../../src/modules/showtimes/types';
import type { TheaterReadService } from '../../../../src/modules/theaters/theater-read.service';
import type { TheaterDetails } from '../../../../src/modules/theaters/types';
import { TestClock } from '../../../support/clock';

/** Friday 16 October 2026, 18:00 Cairo time. */
const NOW = new Date('2026-10-16T18:00:00+03:00');

function showtime(
  id: number,
  fields: { movieId?: number; theaterId?: number; cinemaDate?: string; startsAt: string },
  runtimeMinutes = 100,
  from = 15000,
): ShowtimeView {
  const startsAt = new Date(fields.startsAt);
  return {
    id,
    movieId: fields.movieId ?? 7,
    theaterId: fields.theaterId ?? 1,
    hallId: 40 + id,
    hallName: `Hall ${id}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + runtimeMinutes * 60_000),
    cleaningEndsAt: new Date(startsAt.getTime() + (runtimeMinutes + 20) * 60_000),
    cinemaDate: fields.cinemaDate ?? '2026-10-16',
    status: 'scheduled',
    cancelReason: null,
    cancelledAt: null,
    prices: { front: money(from), middle: money(19000), back: money(23000) },
    fromPrice: money(from),
    seatCapacity: 192,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function theater(id: number, name: string): TheaterDetails {
  return { id, name, district: `District ${id}`, city: 'Cairo' } as TheaterDetails;
}

function movieRef(id: number, status: MovieRef['status']): MovieRef {
  return { id, title: `Movie ${id}`, status, runtimeMinutes: 100, ageRating: 'PG', poster: null };
}

function card(id: number, status: MovieSummary['status'] = 'now_showing'): MovieSummary {
  return { id, title: `Movie ${id}`, status } as MovieSummary;
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

describe('ShowtimeBrowseService', () => {
  let reads: jest.Mocked<
    Pick<ShowtimeReadService, 'listScheduled' | 'movieIdsScheduled' | 'nextScheduledPerMovie'>
  >;
  let theaters: jest.Mocked<Pick<TheaterReadService, 'listActive' | 'findActive'>>;
  let catalog: jest.Mocked<Pick<CatalogReadService, 'findMoviesByIds' | 'findPublicMoviesByIds'>>;
  let clock: TestClock;
  let service: ShowtimeBrowseService;

  beforeEach(() => {
    reads = {
      listScheduled: jest.fn().mockResolvedValue([]),
      movieIdsScheduled: jest.fn().mockResolvedValue(new Set()),
      nextScheduledPerMovie: jest.fn(),
    };
    theaters = {
      listActive: jest
        .fn()
        .mockResolvedValue([
          theater(1, 'Zamalek'),
          theater(2, 'downtown'),
          theater(3, 'Heliopolis'),
        ]),
      findActive: jest.fn().mockResolvedValue(theater(1, 'Zamalek')),
    };
    catalog = {
      findMoviesByIds: jest.fn().mockResolvedValue(new Map([[7, movieRef(7, 'now_showing')]])),
      findPublicMoviesByIds: jest.fn().mockResolvedValue(new Map()),
    };
    clock = new TestClock(NOW);
    service = new ShowtimeBrowseService(
      reads as unknown as ShowtimeReadService,
      theaters as unknown as TheaterReadService,
      catalog as unknown as CatalogReadService,
      clock,
    );
  });

  describe('movieShowtimes', () => {
    it("asks for the movie's scheduled showtimes of the active theaters over 7 cinema days", async () => {
      await service.movieShowtimes(7);
      expect(reads.listScheduled).toHaveBeenCalledWith({
        from: '2026-10-16',
        to: '2026-10-22',
        theaterIds: [1, 2, 3],
        movieIds: [7],
      });
    });

    it('groups by the stored cinema date, so a 00:30 show is under the day before', async () => {
      reads.listScheduled.mockResolvedValue([
        showtime(1, { startsAt: '2026-10-16T21:00:00+03:00' }),
        showtime(2, { startsAt: '2026-10-17T00:30:00+03:00', cinemaDate: '2026-10-16' }),
        showtime(3, { startsAt: '2026-10-17T13:00:00+03:00', cinemaDate: '2026-10-17' }),
      ]);
      const view = await service.movieShowtimes(7);
      expect(view.cinemaDate).toBe('2026-10-16');
      expect(view.days.map((day) => day.cinemaDate)).toEqual([
        '2026-10-16',
        '2026-10-17',
        '2026-10-18',
        '2026-10-19',
        '2026-10-20',
        '2026-10-21',
        '2026-10-22',
      ]);
      expect(view.days[0]!.theaters[0]!.showtimes.map((row) => row.id)).toEqual([1, 2]);
      expect(view.days[1]!.theaters[0]!.showtimes.map((row) => row.id)).toEqual([3]);
      expect(view.days.map((day) => day.showtimeCount)).toEqual([2, 1, 0, 0, 0, 0, 0]);
      expect(view.days[2]!.theaters).toEqual([]);
    });

    it('leaves out the ended showtimes and marks the started ones', async () => {
      reads.listScheduled.mockResolvedValue([
        showtime(1, { startsAt: '2026-10-16T15:00:00+03:00' }, 100), // ended 16:40
        showtime(2, { startsAt: '2026-10-16T17:00:00+03:00' }, 100), // running until 18:40
        showtime(3, { startsAt: '2026-10-16T16:20:00+03:00' }, 100), // ends exactly at 18:00
        showtime(4, { startsAt: '2026-10-16T18:00:00+03:00' }, 100), // starts now
        showtime(5, { startsAt: '2026-10-16T20:00:00+03:00' }, 100),
      ]);
      const [today] = (await service.movieShowtimes(7)).days;
      expect(today!.theaters[0]!.showtimes.map((row) => [row.id, row.hasStarted])).toEqual([
        [2, true],
        [4, true],
        [5, false],
      ]);
    });

    it('orders the theaters of a day by name ignoring case, and counts each in the picker', async () => {
      reads.listScheduled.mockResolvedValue([
        showtime(1, { theaterId: 1, startsAt: '2026-10-16T19:00:00+03:00' }),
        showtime(2, { theaterId: 3, startsAt: '2026-10-16T19:30:00+03:00' }),
        showtime(3, { theaterId: 2, startsAt: '2026-10-16T20:00:00+03:00' }),
        showtime(4, {
          theaterId: 1,
          startsAt: '2026-10-17T19:00:00+03:00',
          cinemaDate: '2026-10-17',
        }),
      ]);
      const view = await service.movieShowtimes(7);
      expect(view.days[0]!.theaters.map((group) => group.theater.name)).toEqual([
        'downtown',
        'Heliopolis',
        'Zamalek',
      ]);
      expect(view.days[0]!.theaters[0]!.theater).toEqual({
        id: 2,
        name: 'downtown',
        district: 'District 2',
        city: 'Cairo',
      });
      expect(view.theaters.map((row) => [row.name, row.showtimeCount])).toEqual([
        ['downtown', 1],
        ['Heliopolis', 1],
        ['Zamalek', 2],
      ]);
    });

    it('has 7 empty days for a Coming soon movie, without reading showtimes', async () => {
      catalog.findMoviesByIds.mockResolvedValue(new Map([[7, movieRef(7, 'coming_soon')]]));
      const view = await service.movieShowtimes(7);
      expect(view.days).toHaveLength(7);
      expect(view.days.every((day) => day.theaters.length === 0)).toBe(true);
      expect(view.theaters).toEqual([]);
      expect(reads.listScheduled).not.toHaveBeenCalled();
    });

    it('is NOT_FOUND for a draft, an archived or an unknown movie', async () => {
      for (const status of ['draft', 'archived'] as const) {
        catalog.findMoviesByIds.mockResolvedValue(new Map([[7, movieRef(7, status)]]));
        expect((await rejection(service.movieShowtimes(7))).code).toBe('NOT_FOUND');
      }
      catalog.findMoviesByIds.mockResolvedValue(new Map());
      expect((await rejection(service.movieShowtimes(7))).code).toBe('NOT_FOUND');
      expect(reads.listScheduled).not.toHaveBeenCalled();
    });

    it('reads no showtimes when no theater is active', async () => {
      theaters.listActive.mockResolvedValue([]);
      const view = await service.movieShowtimes(7);
      expect(view.days.every((day) => day.showtimeCount === 0)).toBe(true);
      expect(reads.listScheduled).not.toHaveBeenCalled();
    });
  });

  describe('theaterShowtimes', () => {
    it('is NOT_FOUND unless the theater is active', async () => {
      theaters.findActive.mockResolvedValue(null);
      expect((await rejection(service.theaterShowtimes(9))).code).toBe('NOT_FOUND');
      expect(theaters.findActive).toHaveBeenCalledWith(9);
    });

    it('reads the 7 cinema days of the theater, movies by their first showtime, Now showing only', async () => {
      reads.listScheduled.mockResolvedValue([
        showtime(1, { movieId: 8, startsAt: '2026-10-16T19:00:00+03:00' }),
        showtime(2, { movieId: 7, startsAt: '2026-10-16T19:30:00+03:00' }),
        showtime(3, { movieId: 8, startsAt: '2026-10-16T22:00:00+03:00' }),
        showtime(4, { movieId: 9, startsAt: '2026-10-16T22:30:00+03:00' }),
        showtime(5, {
          movieId: 7,
          startsAt: '2026-10-18T00:30:00+03:00',
          cinemaDate: '2026-10-17',
        }),
      ]);
      catalog.findPublicMoviesByIds.mockResolvedValue(
        new Map([
          [7, card(7)],
          [8, card(8)],
          [9, card(9, 'coming_soon')],
        ]),
      );
      const view = await service.theaterShowtimes(1);
      expect(reads.listScheduled).toHaveBeenCalledWith({
        from: '2026-10-16',
        to: '2026-10-22',
        theaterIds: [1],
      });
      expect(view).toMatchObject({ theaterId: 1, cinemaDate: '2026-10-16' });
      expect(view.days).toHaveLength(7);
      expect(
        view.days[0]!.movies.map((group) => [group.movie.id, group.showtimes.map((s) => s.id)]),
      ).toEqual([
        [8, [1, 3]],
        [7, [2]],
      ]);
      expect(view.days[1]!.movies.map((group) => group.movie.id)).toEqual([7]);
    });

    it('orders movies whose first showtimes start together by movie id, not showtime id', async () => {
      reads.listScheduled.mockResolvedValue([
        showtime(1, { movieId: 8, startsAt: '2026-10-16T19:00:00+03:00' }),
        showtime(2, { movieId: 7, startsAt: '2026-10-16T19:00:00+03:00' }),
        showtime(3, { movieId: 8, startsAt: '2026-10-16T22:00:00+03:00' }),
      ]);
      catalog.findPublicMoviesByIds.mockResolvedValue(
        new Map([
          [7, card(7)],
          [8, card(8)],
        ]),
      );
      const view = await service.theaterShowtimes(1);
      expect(
        view.days[0]!.movies.map((group) => [group.movie.id, group.showtimes.map((s) => s.id)]),
      ).toEqual([
        [7, [2]],
        [8, [1, 3]],
      ]);
    });

    it('answers only the date asked for', async () => {
      const view = await service.theaterShowtimes(1, '2026-10-18');
      expect(reads.listScheduled).toHaveBeenCalledWith({
        from: '2026-10-18',
        to: '2026-10-18',
        theaterIds: [1],
      });
      expect(view.days.map((day) => day.cinemaDate)).toEqual(['2026-10-18']);
    });

    it('answers a date outside the 7 days with no movies, without reading showtimes', async () => {
      for (const date of ['2026-10-15', '2026-10-23']) {
        const view = await service.theaterShowtimes(1, date);
        expect(view.days).toEqual([{ cinemaDate: date, movies: [] }]);
      }
      expect(reads.listScheduled).not.toHaveBeenCalled();
    });

    it('judges today by the cinema day: at 01:00 it is still the day before', async () => {
      clock.set(new Date('2026-10-17T01:00:00+03:00'));
      const view = await service.theaterShowtimes(1);
      expect(view.cinemaDate).toBe('2026-10-16');
      expect(reads.listScheduled).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-10-16', to: '2026-10-22' }),
      );
    });
  });

  describe('summaryOf', () => {
    it('is empty for a Coming soon movie, without reading anything', async () => {
      expect(await service.summaryOf({ id: 7, status: 'coming_soon' })).toEqual({
        nextShowToday: null,
        cinemaCount: 0,
        fromPrice: null,
      });
      expect(theaters.listActive).not.toHaveBeenCalled();
    });

    it("gives the next show today, the theaters and the lowest from price of what's still to start", async () => {
      reads.listScheduled.mockResolvedValue([
        showtime(1, { theaterId: 2, startsAt: '2026-10-16T19:00:00+03:00' }, 100, 18000),
        showtime(2, { theaterId: 1, startsAt: '2026-10-16T20:00:00+03:00' }, 100, 15000),
        showtime(
          3,
          {
            theaterId: 2,
            startsAt: '2026-10-19T19:00:00+03:00',
            cinemaDate: '2026-10-19',
          },
          100,
          12000,
        ),
      ]);
      const summary = await service.summaryOf({ id: 7, status: 'now_showing' });
      expect(reads.listScheduled).toHaveBeenCalledWith({
        from: '2026-10-16',
        to: '2026-10-22',
        theaterIds: [1, 2, 3],
        movieIds: [7],
        startsAfter: NOW,
      });
      expect(summary.nextShowToday?.showtime.id).toBe(1);
      expect(summary.nextShowToday?.theater).toEqual({
        id: 2,
        name: 'downtown',
        district: 'District 2',
        city: 'Cairo',
      });
      expect(summary.cinemaCount).toBe(2);
      expect(summary.fromPrice).toEqual(money(12000));
    });

    it('has no next show today when only later days have showtimes', async () => {
      reads.listScheduled.mockResolvedValue([
        showtime(3, { startsAt: '2026-10-19T19:00:00+03:00', cinemaDate: '2026-10-19' }),
      ]);
      const summary = await service.summaryOf({ id: 7, status: 'now_showing' });
      expect(summary).toMatchObject({ nextShowToday: null, cinemaCount: 1 });
    });

    it('is empty when nothing is left to start', async () => {
      expect(await service.summaryOf({ id: 7, status: 'now_showing' })).toEqual({
        nextShowToday: null,
        cinemaCount: 0,
        fromPrice: null,
      });
    });
  });

  describe('movieIdsShowing', () => {
    it("asks for the show date's cinema dates at the active theaters, starting after now", async () => {
      reads.movieIdsScheduled.mockResolvedValue(new Set([9, 3]));
      expect(await service.movieIdsShowing('weekend')).toEqual([3, 9]);
      // Friday 16 October: this weekend is today and tomorrow.
      expect(reads.movieIdsScheduled).toHaveBeenCalledWith({
        from: '2026-10-16',
        to: '2026-10-17',
        theaterIds: [1, 2, 3],
        startsAfter: NOW,
      });
    });

    it('matches nothing when no theater is active', async () => {
      theaters.listActive.mockResolvedValue([]);
      expect(await service.movieIdsShowing('today')).toEqual([]);
      expect(reads.movieIdsScheduled).not.toHaveBeenCalled();
    });
  });
});
