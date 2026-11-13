import type { Money } from '../../common/money/types';
import type { Page } from '../../common/pagination/types';
import type { CalendarDate } from '../../common/time/types';
import type { StoredImage } from '../media/types';
import type {
  FeaturedMovie,
  GenreRef,
  MovieDetails,
  MovieSummary,
  PublicCastCount,
  PublicMovieStatus,
} from '../catalog/types';
import type { HallSummary } from '../halls/types';
import type { ShowtimeView } from '../showtimes/types';
import type {
  CinemaDateHours,
  DayHours,
  Facility,
  OpenState,
  SpecialDate,
  TheaterPhone,
  TheaterPhoto,
} from '../theaters/types';
import type { SHOW_DATES } from './enums';

/** The Movies page "show date" filter (PRD C2); absent is Any. */
export type ShowDate = (typeof SHOW_DATES)[number];

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
  /** Only movies with a showtime still to start on these cinema dates (Now showing tab only). */
  readonly showDate?: ShowDate;
}

/** `GET /movies` filters resolved (genre ids), without `showDate`: what every facet starts from. */
export interface MovieFacetFilters {
  readonly status: PublicMovieStatus;
  readonly q?: string;
  readonly genreIds: readonly number[];
  readonly personIds: readonly number[];
}

/** A genre with how many movies of the Movies page facets match it. */
export interface GenreFacet extends GenreRef {
  readonly count: number;
}

/** A "show date" option, the cinema dates it covers and how many matching movies show then. */
export interface ShowDateFacet {
  readonly value: ShowDate;
  readonly count: number;
  readonly cinemaDates: readonly CalendarDate[];
}

/**
 * The Movies page sidebar (#29): counts over every movie of the tab matching the filters, each
 * facet ignoring its own filter.
 */
export interface MovieFacets {
  readonly genres: readonly GenreFacet[];
  readonly people: readonly PublicCastCount[];
  readonly peopleTotal: number;
  readonly showDates: readonly ShowDateFacet[];
}

/** One page of `GET /movies`, with both tabs' totals and the facets under the same filters. */
export interface MovieListView {
  readonly items: readonly MovieSummary[];
  readonly nextCursor: string | null;
  readonly total: number;
  readonly tabCounts: Readonly<Record<PublicMovieStatus, number>>;
  readonly facets: MovieFacets;
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
  /** 5 digits, shown with the city; null when none is set (#29). */
  readonly postalCode: string | null;
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
  /** E.164; null when none is set or contacts are hidden (#29). */
  readonly whatsapp: string | null;
  readonly phones: readonly TheaterPhone[];
  readonly photos: readonly TheaterPhoto[];
  readonly specialDates: readonly SpecialDate[];
  /** The `active` halls, by name; `hallCount` is their number (PRD C5). */
  readonly halls: readonly HallSummary[];
}

/**
 * `GET /theaters`: one page of cards, and the active halls of every theater that passed the
 * filters, whatever the page (#29 "25 HALLS"): the sum of their cards' `hallCount`.
 */
export interface TheaterCardPage extends Page<TheaterCardView> {
  readonly totalHalls: number;
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

// --- Showtimes ------------------------------------------------------------------------------

/** Cinema dates `from` to `to`, both included. */
export interface CinemaDateRange {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

/** Every "show date" option's range seen from one cinema date, and the range covering them all. */
export interface ShowDateRanges {
  readonly options: readonly { readonly value: ShowDate; readonly range: CinemaDateRange }[];
  readonly covering: CinemaDateRange;
}

/**
 * A "show date" option seen from the Clock's now: its cinema dates and the movies with a
 * scheduled showtime of an active theater on them still to start, in id order.
 */
export interface ShowDateOption {
  readonly value: ShowDate;
  readonly cinemaDates: readonly CalendarDate[];
  readonly movieIds: readonly number[];
}

/** A showtime as a customer's time chip shows it, judged at one instant of the Clock. */
export interface PublicShowtimeView extends ShowtimeView {
  /** It has started, so it can't be booked any more (PRD C3 "Started"). */
  readonly hasStarted: boolean;
}

/** A theater as a showtime list names it. */
export interface ShowtimeTheaterRef {
  readonly id: number;
  readonly name: string;
  readonly district: string;
  readonly city: string;
}

/** One theater's showtimes of a movie on one cinema date. */
export interface MovieShowtimeTheaterGroup {
  readonly theater: ShowtimeTheaterRef;
  readonly showtimes: readonly PublicShowtimeView[];
}

/** One cinema date of a movie's showtimes, theaters by name. */
export interface MovieShowtimeDay {
  readonly cinemaDate: CalendarDate;
  readonly showtimeCount: number;
  readonly theaters: readonly MovieShowtimeTheaterGroup[];
}

/** A theater of the movie page's theater picker, with how many showtimes it lists. */
export interface TheaterShowtimeCount extends ShowtimeTheaterRef {
  readonly showtimeCount: number;
}

/** `GET /movies/{id}/showtimes`: the 7 cinema days from today's, empty ones included. */
export interface MovieShowtimesView {
  readonly movieId: number;
  readonly cinemaDate: CalendarDate;
  readonly theaters: readonly TheaterShowtimeCount[];
  readonly days: readonly MovieShowtimeDay[];
}

/** One movie's showtimes at a theater on one cinema date. */
export interface TheaterShowtimeMovieGroup {
  readonly movie: MovieSummary;
  readonly showtimes: readonly PublicShowtimeView[];
}

/** One cinema date of a theater's showtimes, movies by their first showtime. */
export interface TheaterShowtimeDay {
  readonly cinemaDate: CalendarDate;
  readonly movies: readonly TheaterShowtimeMovieGroup[];
}

/** `GET /theaters/{id}/showtimes`: the 7 cinema days from today's, or the one asked for. */
export interface TheaterShowtimesView {
  readonly theaterId: number;
  readonly cinemaDate: CalendarDate;
  readonly days: readonly TheaterShowtimeDay[];
}

/** The next bookable showtime of a movie today, with its theater (the side panel). */
export interface NextShowView {
  readonly showtime: ShowtimeView;
  readonly theater: ShowtimeTheaterRef;
}

/** The movie page's side panel (PRD C3), from the showtimes still to start in 7 cinema days. */
export interface MovieShowtimeSummary {
  readonly nextShowToday: NextShowView | null;
  readonly cinemaCount: number;
  readonly fromPrice: Money | null;
}

/** `GET /movies/{id}`: the movie and its side panel. */
export interface PublicMovieView {
  readonly movie: MovieDetails;
  readonly showtimeSummary: MovieShowtimeSummary;
}

/** What the showtime reads need to know about a public movie. */
export interface PublicMovieRef {
  readonly id: number;
  readonly status: PublicMovieStatus;
}
