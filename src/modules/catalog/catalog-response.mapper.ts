import { Injectable } from '@nestjs/common';
import { formatCairoIso } from '../../common/time/time';
import type { ImageResponse } from '../media/dto/image.response';
import { MediaService } from '../media/media.service';
import type { StoredImage } from '../media/types';
import type { AdminMovieListItemResponse } from './dto/admin-movie-list-item.response';
import { AdminMoviePageResponse } from './dto/admin-movie-page.response';
import { AdminMovieResponse } from './dto/admin-movie.response';
import type { AdminPersonListItemResponse } from './dto/admin-person-list-item.response';
import { AdminPersonResponse } from './dto/admin-person.response';
import { toGenreRefResponse } from './dto/genre-ref.response';
import { videoFields } from './dto/video.response';
import { youtubeWatchUrl } from './youtube';
import type {
  AdminMovie,
  AdminMovieListItem,
  AdminMoviePage,
  AdminPerson,
  AdminPersonListItem,
} from './types';

/**
 * Turns the catalog's read models into response DTOs, with every image's public URLs and alt
 * text (`MediaService.toImageResponse`): a poster is "<title> poster", a photo its caption or
 * the title, a person photo the person's name.
 */
@Injectable()
export class CatalogResponseMapper {
  constructor(private readonly media: MediaService) {}

  adminMovie(movie: AdminMovie): AdminMovieResponse {
    return Object.assign(new AdminMovieResponse(), {
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
      backdropPhotoId: movie.backdropPhotoId,
      heroVideoId: movie.heroVideoId,
      featuredPosition: movie.featuredPosition,
      photos: movie.photos.map((photo) => ({
        id: photo.id,
        kind: photo.kind,
        caption: photo.caption,
        position: photo.position,
        isBackdrop: photo.id === movie.backdropPhotoId,
        image: this.image(photo.image, photo.caption ?? movie.title),
      })),
      videos: movie.videos.map((video) => ({
        ...videoFields(video),
        watchUrl: youtubeWatchUrl(video.youtubeId),
        position: video.position,
        isHero: video.id === movie.heroVideoId,
      })),
      credits: movie.credits.map((credit) => ({
        id: credit.id,
        role: credit.role,
        characterName: credit.characterName,
        position: credit.position,
        person: {
          id: credit.person.id,
          fullName: credit.person.fullName,
          photo: this.image(credit.person.photo, credit.person.fullName),
        },
      })),
      publishBlockers: [...movie.publishBlockers],
      createdAt: formatCairoIso(movie.createdAt),
      updatedAt: formatCairoIso(movie.updatedAt),
      updatedBy: { id: movie.updatedBy.id, fullName: movie.updatedBy.fullName },
    });
  }

  adminMovieListItem(item: AdminMovieListItem): AdminMovieListItemResponse {
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      ageRating: item.ageRating,
      runtimeMinutes: item.runtimeMinutes,
      releaseDate: item.releaseDate,
      genres: item.genres.map(toGenreRefResponse),
      poster: this.image(item.poster, `${item.title} poster`),
      featuredPosition: item.featuredPosition,
      photoCount: item.photoCount,
      videoCount: item.videoCount,
      creditCount: item.creditCount,
      updatedAt: formatCairoIso(item.updatedAt),
    };
  }

  adminMoviePage(page: AdminMoviePage): AdminMoviePageResponse {
    return Object.assign(new AdminMoviePageResponse(), {
      items: page.items.map((item) => this.adminMovieListItem(item)),
      nextCursor: page.nextCursor,
      total: page.total,
      statusCounts: {
        draft: page.statusCounts.draft,
        comingSoon: page.statusCounts.coming_soon,
        nowShowing: page.statusCounts.now_showing,
        archived: page.statusCounts.archived,
      },
    });
  }

  adminPerson(person: AdminPerson): AdminPersonResponse {
    return Object.assign(new AdminPersonResponse(), {
      id: person.id,
      fullName: person.fullName,
      birthDate: person.birthDate,
      birthPlace: person.birthPlace,
      nationality: person.nationality,
      bio: person.bio,
      photo: this.image(person.photo, person.fullName),
      instagramUrl: person.instagramUrl,
      imdbUrl: person.imdbUrl,
      websiteUrl: person.websiteUrl,
      roles: [...person.roles],
      creditedRoles: [...person.creditedRoles],
      credits: person.credits.map((credit) => ({
        id: credit.id,
        role: credit.role,
        characterName: credit.characterName,
        movie: {
          id: credit.movie.id,
          title: credit.movie.title,
          status: credit.movie.status,
          releaseDate: credit.movie.releaseDate,
          poster: this.image(credit.movie.poster, `${credit.movie.title} poster`),
        },
      })),
      createdAt: formatCairoIso(person.createdAt),
      updatedAt: formatCairoIso(person.updatedAt),
    });
  }

  adminPersonListItem(item: AdminPersonListItem): AdminPersonListItemResponse {
    return {
      id: item.id,
      fullName: item.fullName,
      photo: this.image(item.photo, item.fullName),
      roles: [...item.roles],
      birthYear: item.birthYear,
      birthPlace: item.birthPlace,
      creditCount: item.creditCount,
      knownFor: item.knownFor.map((movie) => ({ id: movie.id, title: movie.title })),
    };
  }

  private image(image: StoredImage | null, alt: string): ImageResponse | null {
    return this.media.toImageResponse(image ?? undefined, alt);
  }
}
