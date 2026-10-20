import { Injectable } from '@nestjs/common';
import type { Page } from '../../common/pagination/types';
import { formatCairoIso } from '../../common/time/time';
import { toGenreRefResponse } from '../catalog/dto/genre-ref.response';
import { MovieCreditResponse } from '../catalog/dto/movie-credit.response';
import { toVideoResponse } from '../catalog/dto/video.response';
import type {
  FeaturedMovie,
  MovieCredit,
  MovieDetails,
  MovieSummary,
  PublicPerson,
} from '../catalog/types';
import type { ImageResponse } from '../media/dto/image.response';
import { MediaService } from '../media/media.service';
import type { StoredImage } from '../media/types';
import {
  toDayHoursResponse,
  toOpenStateResponse,
  toPhoneResponse,
  toSpecialDateResponse,
  toTodayHoursResponse,
} from '../theaters/theater-response.mapper';
import { FeaturedMovieDetailsResponse, FeaturedMovieResponse } from './dto/featured-movie.response';
import { GenreWithCountPage, GenreWithCountResponse } from './dto/genre-with-count.response';
import { HomeResponse } from './dto/home.response';
import { MovieCardListResponse, MovieCardResponse } from './dto/movie-card.response';
import { MovieDetailsResponse, MoviePhotoResponse } from './dto/movie-details.response';
import {
  MovieCardPageResponse,
  MovieTabCountsResponse,
  SimilarMoviesResponse,
} from './dto/movie-lists.response';
import { PublicPersonPageResponse, PublicPersonResponse } from './dto/public-person.response';
import {
  PublicTheaterListItemResponse,
  PublicTheaterPageResponse,
  PublicTheaterResponse,
  TheaterGalleryPhotoResponse,
} from './dto/public-theater.response';
import { TheaterCardResponse } from './dto/theater-card.response';
import { TickerItemResponse } from './dto/ticker-item.response';
import type {
  GenreWithCount,
  HomeTickerEntry,
  HomeView,
  MovieCardListView,
  MovieListView,
  PublicTheaterView,
  TheaterCardView,
} from './types';

/**
 * Turns the discovery read models into response DTOs (exported for U8b's showtime reads). Every
 * image gets its public URLs and alt text from `MediaService`: a poster is "<title> poster", a
 * backdrop the title, a movie photo its caption or the title, a person photo the name, a cover
 * the theater name and a gallery photo its caption or the theater name. Times are Cairo time
 * with their offset.
 */
@Injectable()
export class DiscoveryResponseMapper {
  constructor(private readonly media: MediaService) {}

  home(view: HomeView): HomeResponse {
    return Object.assign(new HomeResponse(), {
      serverTime: formatCairoIso(view.serverTime),
      cinemaDate: view.cinemaDate,
      featured: view.featured.map((slide) => this.featured(slide)),
      ticker: view.ticker.map((entry) => this.tickerItem(entry)),
      genres: view.genres.map((genre) => this.genreWithCount(genre)),
      nowShowing: this.movieCardList(view.nowShowing),
      comingSoon: this.movieCardList(view.comingSoon),
      cinemas: view.cinemas.map((card) => this.theaterCard(card)),
    });
  }

  featured(slide: FeaturedMovie): FeaturedMovieResponse {
    const { movie } = slide;
    return Object.assign(new FeaturedMovieResponse(), {
      position: slide.position,
      movie: Object.assign(new FeaturedMovieDetailsResponse(), {
        id: movie.id,
        title: movie.title,
        synopsis: movie.synopsis,
        genres: movie.genres.map(toGenreRefResponse),
        runtimeMinutes: movie.runtimeMinutes,
        ageRating: movie.ageRating,
        releaseDate: movie.releaseDate,
        status: movie.status,
      }),
      heroVideo: toVideoResponse(slide.heroVideo),
      backdrop: this.image(slide.backdrop, movie.title),
    });
  }

  tickerItem(entry: HomeTickerEntry): TickerItemResponse {
    const { movie, nextShowtime } = entry;
    return Object.assign(new TickerItemResponse(), {
      movie: { id: movie.id, title: movie.title },
      nextShowtime: {
        id: nextShowtime.id,
        startsAt: formatCairoIso(nextShowtime.startsAt),
        cinemaDate: nextShowtime.cinemaDate,
        theater: { id: nextShowtime.theater.id, name: nextShowtime.theater.name },
      },
    });
  }

  genreWithCount(genre: GenreWithCount): GenreWithCountResponse {
    return Object.assign(new GenreWithCountResponse(), {
      ...toGenreRefResponse(genre),
      movieCount: genre.movieCount,
    });
  }

  genrePage(page: Page<GenreWithCount>): GenreWithCountPage {
    return Object.assign(new GenreWithCountPage(), {
      items: page.items.map((genre) => this.genreWithCount(genre)),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  }

  movieCard(movie: MovieSummary): MovieCardResponse {
    return Object.assign(new MovieCardResponse(), {
      id: movie.id,
      title: movie.title,
      poster: this.image(movie.poster, `${movie.title} poster`),
      genres: movie.genres.map(toGenreRefResponse),
      runtimeMinutes: movie.runtimeMinutes,
      ageRating: movie.ageRating,
      releaseDate: movie.releaseDate,
      status: movie.status,
    });
  }

  movieCardList(list: MovieCardListView): MovieCardListResponse {
    return Object.assign(new MovieCardListResponse(), {
      items: list.items.map((movie) => this.movieCard(movie)),
      total: list.total,
    });
  }

  moviePage(view: MovieListView): MovieCardPageResponse {
    return Object.assign(new MovieCardPageResponse(), {
      items: view.items.map((movie) => this.movieCard(movie)),
      nextCursor: view.nextCursor,
      total: view.total,
      tabCounts: Object.assign(new MovieTabCountsResponse(), {
        nowShowing: view.tabCounts.now_showing,
        comingSoon: view.tabCounts.coming_soon,
      }),
    });
  }

  similar(movies: readonly MovieSummary[]): SimilarMoviesResponse {
    return Object.assign(new SimilarMoviesResponse(), {
      items: movies.map((movie) => this.movieCard(movie)),
    });
  }

  movieDetails(movie: MovieDetails): MovieDetailsResponse {
    return Object.assign(new MovieDetailsResponse(), {
      id: movie.id,
      title: movie.title,
      status: movie.status,
      synopsis: movie.synopsis,
      runtimeMinutes: movie.runtimeMinutes,
      releaseDate: movie.releaseDate,
      ageRating: movie.ageRating,
      language: movie.language,
      country: movie.country,
      productionCompany: movie.productionCompany,
      budgetLabel: movie.budgetLabel,
      filmingLocations: movie.filmingLocations,
      genres: movie.genres.map(toGenreRefResponse),
      poster: this.image(movie.poster, `${movie.title} poster`),
      backdrop: this.image(movie.backdrop, movie.title),
      heroVideo: movie.heroVideo ? toVideoResponse(movie.heroVideo) : null,
      videos: movie.videos.map(toVideoResponse),
      photos: movie.photos.map((photo) =>
        Object.assign(new MoviePhotoResponse(), {
          id: photo.id,
          kind: photo.kind,
          caption: photo.caption,
          image: this.image(photo.image, photo.caption ?? movie.title),
        }),
      ),
      credits: movie.credits.map((credit) => this.credit(credit)),
    });
  }

  personPage(page: Page<PublicPerson>): PublicPersonPageResponse {
    return Object.assign(new PublicPersonPageResponse(), {
      items: page.items.map((person) =>
        Object.assign(new PublicPersonResponse(), {
          id: person.id,
          fullName: person.fullName,
          photo: this.image(person.photo, person.fullName),
          roles: [...person.roles],
        }),
      ),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  }

  theaterCard(card: TheaterCardView): TheaterCardResponse {
    return Object.assign(new TheaterCardResponse(), this.cardFields(card));
  }

  theaterPage(page: Page<TheaterCardView>): PublicTheaterPageResponse {
    return Object.assign(new PublicTheaterPageResponse(), {
      items: page.items.map((card) =>
        Object.assign(new PublicTheaterListItemResponse(), {
          ...this.cardFields(card),
          latitude: card.latitude,
          longitude: card.longitude,
          today: toTodayHoursResponse(card.today),
          weeklyHours: card.weeklyHours.map(toDayHoursResponse),
        }),
      ),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  }

  theater(view: PublicTheaterView): PublicTheaterResponse {
    return Object.assign(new PublicTheaterResponse(), {
      id: view.id,
      name: view.name,
      address: view.address,
      district: view.district,
      city: view.city,
      latitude: view.latitude,
      longitude: view.longitude,
      transitInfo: view.transitInfo,
      parkingInfo: view.parkingInfo,
      email: view.email,
      phones: view.phones.map(toPhoneResponse),
      facilities: [...view.facilities],
      cover: this.image(view.cover, view.name),
      photos: view.photos.map((photo) =>
        Object.assign(new TheaterGalleryPhotoResponse(), {
          id: photo.id,
          caption: photo.caption,
          image: this.image(photo.image, photo.caption ?? view.name),
        }),
      ),
      openState: toOpenStateResponse(view.openState),
      today: toTodayHoursResponse(view.today),
      weeklyHours: view.weeklyHours.map(toDayHoursResponse),
      specialDates: view.specialDates.map(toSpecialDateResponse),
      hallCount: view.hallCount,
    });
  }

  private cardFields(card: TheaterCardView) {
    return {
      id: card.id,
      name: card.name,
      district: card.district,
      city: card.city,
      address: card.address,
      cover: this.image(card.cover, card.name),
      openState: toOpenStateResponse(card.openState),
      mainPhone: card.mainPhone ? toPhoneResponse(card.mainPhone) : null,
      hallCount: card.hallCount,
      facilities: [...card.facilities],
    };
  }

  private credit(credit: MovieCredit): MovieCreditResponse {
    return Object.assign(new MovieCreditResponse(), {
      id: credit.id,
      role: credit.role,
      characterName: credit.characterName,
      position: credit.position,
      person: {
        id: credit.person.id,
        fullName: credit.person.fullName,
        photo: this.image(credit.person.photo, credit.person.fullName),
      },
    });
  }

  private image(image: StoredImage | null, alt: string): ImageResponse | null {
    return this.media.toImageResponse(image ?? undefined, alt);
  }
}
