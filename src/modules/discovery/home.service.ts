import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { cinemaDateOf } from '../../common/time/time';
import { CatalogReadService } from '../catalog/catalog-read.service';
import type { PublicMovieStatus } from '../catalog/types';
import { HOME_LIST_LIMIT } from './discovery.constants';
import { HomeTickerSource } from './home-ticker.source';
import { MovieBrowseService } from './movie-browse.service';
import { TheaterBrowseService } from './theater-browse.service';
import type { HomeView, MovieCardListView } from './types';

/**
 * `GET /home` (PRD C1; contract `HomeResponse`): the carousel, the ticker, genres with counts,
 * the first 12 of each tab with their totals and every theater open for sales, all judged at
 * one instant of the Clock. A fixed number of queries, one after the other.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly catalog: CatalogReadService,
    private readonly movies: MovieBrowseService,
    private readonly theaters: TheaterBrowseService,
    private readonly ticker: HomeTickerSource,
    private readonly clock: Clock,
  ) {}

  async getHome(): Promise<HomeView> {
    const now = this.clock.now();
    const cinemaDate = cinemaDateOf(now);
    const featured = await this.catalog.listFeatured();
    const ticker = await this.ticker.tickerFor(now, cinemaDate);
    const genres = await this.movies.genresWithCounts();
    const nowShowing = await this.firstOf('now_showing');
    const comingSoon = await this.firstOf('coming_soon');
    const cinemas = await this.theaters.cardsAt(now);
    return {
      serverTime: now,
      cinemaDate,
      featured,
      ticker,
      genres,
      nowShowing,
      comingSoon,
      cinemas,
    };
  }

  /** The first movies of a tab, in its order, and the tab's total. */
  private async firstOf(status: PublicMovieStatus): Promise<MovieCardListView> {
    const page = await this.catalog.listPublicMovies(
      { status },
      { after: null, limit: HOME_LIST_LIMIT },
    );
    return { items: page.items, total: page.total };
  }
}
