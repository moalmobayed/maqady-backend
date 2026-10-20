import type { CatalogReadService } from '../../../../src/modules/catalog/catalog-read.service';
import type { FeaturedMovie, MovieSummary } from '../../../../src/modules/catalog/types';
import type { HomeTickerSource } from '../../../../src/modules/discovery/home-ticker.source';
import { HomeService } from '../../../../src/modules/discovery/home.service';
import type { MovieBrowseService } from '../../../../src/modules/discovery/movie-browse.service';
import type { TheaterBrowseService } from '../../../../src/modules/discovery/theater-browse.service';
import type { HomeTickerEntry, TheaterCardView } from '../../../../src/modules/discovery/types';
import { TestClock } from '../../../support/clock';

function summary(id: number, status: MovieSummary['status']): MovieSummary {
  return {
    id,
    title: `Movie ${id}`,
    status,
    synopsis: 'A synopsis.',
    runtimeMinutes: 100,
    releaseDate: '2026-10-01',
    ageRating: '12+',
    genres: [],
    poster: null,
  };
}

describe('HomeService', () => {
  const featured = [{ position: 1 } as FeaturedMovie];
  const ticker = [{ movie: { id: 1, title: 'Movie 1' } } as HomeTickerEntry];
  const cards = [{ id: 3, name: 'Maqady Zamalek' } as TheaterCardView];
  let catalog: jest.Mocked<Pick<CatalogReadService, 'listFeatured' | 'listPublicMovies'>>;
  let movies: jest.Mocked<Pick<MovieBrowseService, 'genresWithCounts'>>;
  let theaters: jest.Mocked<Pick<TheaterBrowseService, 'cardsAt'>>;
  let tickerSource: jest.Mocked<HomeTickerSource>;
  let clock: TestClock;
  let service: HomeService;

  beforeEach(() => {
    catalog = {
      listFeatured: jest.fn().mockResolvedValue(featured),
      listPublicMovies: jest.fn().mockImplementation(({ status }) =>
        Promise.resolve({
          items: [summary(status === 'now_showing' ? 1 : 2, status)],
          nextCursor: 'next',
          total: status === 'now_showing' ? 13 : 4,
        }),
      ),
    };
    movies = {
      genresWithCounts: jest
        .fn()
        .mockResolvedValue([{ id: 1, name: 'Action', slug: 'action', movieCount: 2 }]),
    };
    theaters = { cardsAt: jest.fn().mockResolvedValue(cards) };
    tickerSource = { tickerFor: jest.fn().mockResolvedValue(ticker) };
    // 00:30 on Saturday 17 October, Cairo summer time: still Friday's cinema day.
    clock = new TestClock(new Date('2026-10-16T21:30:00Z'));
    service = new HomeService(
      catalog as unknown as CatalogReadService,
      movies as unknown as MovieBrowseService,
      theaters as unknown as TheaterBrowseService,
      tickerSource,
      clock,
    );
  });

  it('assembles every part of the home page at one instant of the Clock', async () => {
    const home = await service.getHome();
    expect(home.serverTime).toEqual(clock.now());
    expect(home.cinemaDate).toBe('2026-10-16');
    expect(home.featured).toBe(featured);
    expect(home.ticker).toBe(ticker);
    expect(home.genres).toEqual([{ id: 1, name: 'Action', slug: 'action', movieCount: 2 }]);
    expect(home.cinemas).toBe(cards);
    expect(tickerSource.tickerFor).toHaveBeenCalledWith(clock.now(), '2026-10-16');
    expect(theaters.cardsAt).toHaveBeenCalledWith(clock.now());
    expect(movies.genresWithCounts).toHaveBeenCalledWith();
  });

  it('asks each tab for its first 12 movies and keeps the tab total, not the cursor', async () => {
    const home = await service.getHome();
    expect(catalog.listPublicMovies).toHaveBeenCalledWith(
      { status: 'now_showing' },
      { after: null, limit: 12 },
    );
    expect(catalog.listPublicMovies).toHaveBeenCalledWith(
      { status: 'coming_soon' },
      { after: null, limit: 12 },
    );
    expect(home.nowShowing).toEqual({ items: [summary(1, 'now_showing')], total: 13 });
    expect(home.comingSoon).toEqual({ items: [summary(2, 'coming_soon')], total: 4 });
  });
});
