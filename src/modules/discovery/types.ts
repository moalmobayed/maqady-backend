import type { CalendarDate } from '../../common/time/types';
import type { StoredImage } from '../media/types';
import type { FeaturedMovie, GenreRef, MovieSummary, PublicMovieStatus } from '../catalog/types';
import type {
  CinemaDateHours,
  DayHours,
  Facility,
  OpenState,
  SpecialDate,
  TheaterPhone,
  TheaterPhoto,
} from '../theaters/types';

// --- Seams U8b fills ------------------------------------------------------------------------

/**
 * One ticker entry of the home page (contract `TickerItem`): a Now showing movie and its next
 * bookable showtime of the cinema day.
 */
export interface HomeTickerEntry {
  readonly movie: { readonly id: number; readonly title: string };
  readonly nextShowtime: {
    readonly id: number;
    readonly startsAt: Date;
    readonly cinemaDate: CalendarDate;
    readonly theater: { readonly id: number; readonly name: string };
  };
}

// --- Catalog reads --------------------------------------------------------------------------

/** A genre with how many public movies it has (contract `GenreWithCount`). */
export interface GenreWithCount extends GenreRef {
  readonly movieCount: number;
}

/** A movie list (contract `MovieCardList`): the first items and the size of the whole list. */
export interface MovieCardListView {
  readonly items: readonly MovieSummary[];
  readonly total: number;
}

/** `GET /movies` as validated: genre slugs and person ids, not yet resolved. */
export interface MovieListFilterInput {
  readonly status: PublicMovieStatus;
  readonly genreSlugs?: readonly string[];
  readonly personIds?: readonly number[];
  readonly q?: string;
}

/** One page of `GET /movies`, with both tabs' totals under the same filters. */
export interface MovieListView {
  readonly items: readonly MovieSummary[];
  readonly nextCursor: string | null;
  readonly total: number;
  readonly tabCounts: Readonly<Record<PublicMovieStatus, number>>;
}

// --- Theater reads --------------------------------------------------------------------------

/** `GET /theaters` filters (PRD C4): open at the Clock's now, and free or valet parking. */
export interface TheaterListFilter {
  readonly openNow?: boolean;
  readonly parking?: boolean;
}

/**
 * An active theater as its cards show it (contract `TheaterCard`), with what the list adds
 * (coordinates, today's and the weekly hours). Contacts are already hidden when the theater
 * hides them.
 */
export interface TheaterCardView {
  readonly id: number;
  readonly name: string;
  readonly district: string;
  readonly city: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly cover: StoredImage | null;
  readonly openState: OpenState;
  readonly mainPhone: TheaterPhone | null;
  readonly hallCount: number;
  readonly facilities: readonly Facility[];
  readonly today: CinemaDateHours;
  readonly weeklyHours: readonly DayHours[];
}

/** An active theater's page (PRD C5). Phones and email are empty when contacts are hidden. */
export interface PublicTheaterView extends TheaterCardView {
  readonly transitInfo: string | null;
  readonly parkingInfo: string | null;
  readonly email: string | null;
  readonly phones: readonly TheaterPhone[];
  readonly photos: readonly TheaterPhoto[];
  readonly specialDates: readonly SpecialDate[];
}

// --- The home page --------------------------------------------------------------------------

/** Everything `GET /home` returns, before mapping to the response. */
export interface HomeView {
  readonly serverTime: Date;
  readonly cinemaDate: CalendarDate;
  readonly featured: readonly FeaturedMovie[];
  readonly ticker: readonly HomeTickerEntry[];
  readonly genres: readonly GenreWithCount[];
  readonly nowShowing: MovieCardListView;
  readonly comingSoon: MovieCardListView;
  readonly cinemas: readonly TheaterCardView[];
}

/** What the name order of genres and theaters compares. */
export interface NamedItem {
  readonly id: number;
  readonly name: string;
}
