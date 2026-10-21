import type { CatalogReadService } from '../../../../src/modules/catalog/catalog-read.service';
import type { MovieRef } from '../../../../src/modules/catalog/types';
import { ShowtimesTickerSource } from '../../../../src/modules/discovery/home-ticker.source';
import type { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import type { ShowtimeView } from '../../../../src/modules/showtimes/types';
import type { TheaterReadService } from '../../../../src/modules/theaters/theater-read.service';
import type { TheaterDetails } from '../../../../src/modules/theaters/types';

const NOW = new Date('2026-10-16T15:00:00+03:00');

function showtime(id: number, movieId: number, theaterId: number, startsAt: string): ShowtimeView {
  return {
    id,
    movieId,
    theaterId,
    hallId: 1,
    hallName: 'Hall 1',
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt),
    cleaningEndsAt: new Date(startsAt),
    cinemaDate: '2026-10-16',
  } as ShowtimeView;
}

function movie(id: number, title: string, status: MovieRef['status']): MovieRef {
  return { id, title, status, runtimeMinutes: 100, ageRating: 'PG', poster: null };
}

describe('ShowtimesTickerSource', () => {
  let showtimes: jest.Mocked<Pick<ShowtimeReadService, 'nextScheduledPerMovie'>>;
  let theaters: jest.Mocked<Pick<TheaterReadService, 'listActive'>>;
  let catalog: jest.Mocked<Pick<CatalogReadService, 'findMoviesByIds'>>;
  let source: ShowtimesTickerSource;

  beforeEach(() => {
    theaters = {
      listActive: jest.fn().mockResolvedValue([
        { id: 1, name: 'Maqady Zamalek' },
        { id: 2, name: 'Maqady Downtown' },
      ] as TheaterDetails[]),
    };
    showtimes = {
      nextScheduledPerMovie: jest.fn().mockResolvedValue(
        new Map([
          [10, showtime(105, 10, 1, '2026-10-16T21:00:00+03:00')],
          [11, showtime(103, 11, 2, '2026-10-16T16:15:00+03:00')],
          [12, showtime(101, 12, 1, '2026-10-16T21:00:00+03:00')],
          [13, showtime(102, 13, 2, '2026-10-16T17:00:00+03:00')],
        ]),
      ),
    };
    catalog = {
      findMoviesByIds: jest.fn().mockResolvedValue(
        new Map([
          [10, movie(10, 'Late One', 'now_showing')],
          [11, movie(11, 'Early One', 'now_showing')],
          [12, movie(12, 'Same Time', 'now_showing')],
          [13, movie(13, 'Back Soon', 'coming_soon')],
        ]),
      ),
    };
    source = new ShowtimesTickerSource(
      showtimes as unknown as ShowtimeReadService,
      theaters as unknown as TheaterReadService,
      catalog as unknown as CatalogReadService,
    );
  });

  it('asks for the next showtime per movie of the cinema date after now at the active theaters', async () => {
    await source.tickerFor(NOW, '2026-10-16');
    expect(showtimes.nextScheduledPerMovie).toHaveBeenCalledWith({
      cinemaDate: '2026-10-16',
      after: NOW,
      theaterIds: [1, 2],
    });
    expect(catalog.findMoviesByIds).toHaveBeenCalledWith([10, 11, 12, 13]);
  });

  it('keeps Now showing movies only, soonest first and ties by showtime id, with the theater name', async () => {
    const entries = await source.tickerFor(NOW, '2026-10-16');
    expect(entries.map((entry) => entry.nextShowtime.id)).toEqual([103, 101, 105]);
    expect(entries[0]).toEqual({
      movie: { id: 11, title: 'Early One' },
      nextShowtime: {
        id: 103,
        startsAt: new Date('2026-10-16T16:15:00+03:00'),
        cinemaDate: '2026-10-16',
        theater: { id: 2, name: 'Maqady Downtown' },
      },
    });
  });

  it('reads no showtimes without an active theater, and no movies without showtimes', async () => {
    theaters.listActive.mockResolvedValueOnce([]);
    expect(await source.tickerFor(NOW, '2026-10-16')).toEqual([]);
    expect(showtimes.nextScheduledPerMovie).not.toHaveBeenCalled();

    showtimes.nextScheduledPerMovie.mockResolvedValueOnce(new Map());
    expect(await source.tickerFor(NOW, '2026-10-16')).toEqual([]);
    expect(catalog.findMoviesByIds).not.toHaveBeenCalled();
  });
});
