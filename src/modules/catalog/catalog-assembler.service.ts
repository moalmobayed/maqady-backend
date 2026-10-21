import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { MediaService } from '../media/media.service';
import type { StoredImage } from '../media/types';
import { StaffService } from '../staff/staff.service';
import { KNOWN_FOR_LIMIT } from './catalog.constants';
import { CreditsRepository } from './credits.repository';
import { CREDIT_ROLES } from './enums';
import { GenresRepository } from './genres.repository';
import { MovieMediaRepository } from './movie-media.repository';
import { missingPublishRequirements } from './movie-rules';
import { MoviesRepository } from './movies.repository';
import { PeopleRepository } from './people.repository';
import type {
  AdminMovie,
  AdminMovieListItem,
  AdminPerson,
  AdminPersonListItem,
  CreditRole,
  FeaturedMovie,
  GenreRef,
  MovieCredit,
  MovieCreditWithPersonRow,
  MovieDetails,
  MoviePhoto,
  MoviePhotoRow,
  MovieRow,
  MovieSummary,
  MovieVideo,
  MovieVideoRow,
  PersonRow,
  PublicMovieStatus,
  PublicPerson,
} from './types';
import { inSequence } from './sequential';

/**
 * Builds the catalog's read models from rows, with a fixed number of queries whatever the
 * number of movies or people: every related table is read once with `whereIn`, and every image
 * in one `MediaService.findByIds` call (CLAUDE.md "No N+1").
 */
@Injectable()
export class CatalogAssembler {
  constructor(
    private readonly movies: MoviesRepository,
    private readonly genres: GenresRepository,
    private readonly movieMedia: MovieMediaRepository,
    private readonly credits: CreditsRepository,
    private readonly people: PeopleRepository,
    private readonly media: MediaService,
    private readonly staff: StaffService,
  ) {}

  /** The admin editor's movie: details, genres, poster, photos, videos, credits, last editor. */
  async adminMovie(id: number): Promise<AdminMovie | null> {
    const row = await this.movies.findById(id);
    if (!row) return null;
    const [genres, photos, videos, credits, editor] = await inSequence([
      () => this.genresByMovie([row.id]),
      () => this.movieMedia.photosOf([row.id]),
      () => this.movieMedia.videosOf([row.id]),
      () => this.credits.creditsOfMovies([row.id]),
      () => this.staff.findById(row.updated_by_staff_id),
    ]);
    if (!editor) throw new AppError('INTERNAL', 'The movie names a staff member who is gone.');
    const images = await this.media.findByIds([
      ...(row.poster_image_id === null ? [] : [row.poster_image_id]),
      ...photos.map((photo) => photo.image_id),
      ...credits.flatMap((credit) =>
        credit.photo_image_id === null ? [] : [credit.photo_image_id],
      ),
    ]);
    const movieGenres = genres.get(row.id) ?? [];
    return {
      ...movieFields(row),
      genres: movieGenres,
      poster: imageOf(images, row.poster_image_id),
      backdropPhotoId: row.backdrop_photo_id,
      heroVideoId: row.hero_video_id,
      featuredPosition: row.featured_position,
      photos: toPhotos(photos, images),
      videos: videos.map(toVideo),
      credits: toCredits(credits, images),
      publishBlockers: missingPublishRequirements({
        synopsis: row.synopsis,
        runtimeMinutes: row.runtime_minutes,
        releaseDate: row.release_date,
        genreCount: movieGenres.length,
      }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: { id: editor.id, fullName: editor.fullName },
    };
  }

  /** Rows of the admin movie list, in the order given. */
  async adminMovieListItems(rows: readonly MovieRow[]): Promise<AdminMovieListItem[]> {
    const ids = rows.map((row) => row.id);
    const [genres, counts, images] = await inSequence([
      () => this.genresByMovie(ids),
      () => this.movies.countsOf(ids),
      () => this.media.findByIds(posterIdsOf(rows)),
    ]);
    const countsById = new Map(counts.map((count) => [count.id, count]));
    return rows.map((row) => {
      const count = countsById.get(row.id);
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        ageRating: row.age_rating,
        runtimeMinutes: row.runtime_minutes,
        releaseDate: row.release_date,
        genres: genres.get(row.id) ?? [],
        poster: imageOf(images, row.poster_image_id),
        featuredPosition: row.featured_position,
        photoCount: count?.photo_count ?? 0,
        videoCount: count?.video_count ?? 0,
        creditCount: count?.credit_count ?? 0,
        updatedAt: row.updated_at,
      };
    });
  }

  /** Public movies as cards show them, in the order given. Rows must be public. */
  async summaries(rows: readonly MovieRow[]): Promise<MovieSummary[]> {
    const [genres, images] = await inSequence([
      () => this.genresByMovie(rows.map((row) => row.id)),
      () => this.media.findByIds(posterIdsOf(rows)),
    ]);
    return rows.map((row) => toSummary(row, genres.get(row.id) ?? [], images));
  }

  /** A public movie's page. The row must be public. */
  async details(row: MovieRow): Promise<MovieDetails> {
    const [genres, photos, videos, credits] = await inSequence([
      () => this.genresByMovie([row.id]),
      () => this.movieMedia.photosOf([row.id]),
      () => this.movieMedia.videosOf([row.id]),
      () => this.credits.creditsOfMovies([row.id]),
    ]);
    const images = await this.media.findByIds([
      ...posterIdsOf([row]),
      ...photos.map((photo) => photo.image_id),
      ...credits.flatMap((credit) =>
        credit.photo_image_id === null ? [] : [credit.photo_image_id],
      ),
    ]);
    const movieVideos = videos.map(toVideo);
    const backdrop = photos.find((photo) => photo.id === row.backdrop_photo_id);
    return {
      ...toSummary(row, genres.get(row.id) ?? [], images),
      language: row.language,
      country: row.country,
      productionCompany: row.production_company,
      budgetLabel: row.budget_label,
      filmingLocations: row.filming_locations,
      backdrop: backdrop ? imageOf(images, backdrop.image_id) : null,
      heroVideo: movieVideos.find((video) => video.id === row.hero_video_id) ?? null,
      photos: toPhotos(photos, images),
      videos: movieVideos,
      credits: toCredits(credits, images),
    };
  }

  /** The carousel slides of featured rows, in the order given. Rows must be public and featured. */
  async featured(rows: readonly MovieRow[]): Promise<FeaturedMovie[]> {
    const heroIds = rows.flatMap((row) => (row.hero_video_id === null ? [] : [row.hero_video_id]));
    const backdropIds = rows.flatMap((row) =>
      row.backdrop_photo_id === null ? [] : [row.backdrop_photo_id],
    );
    const [summaries, videos, backdrops] = await inSequence([
      () => this.summaries(rows),
      () => this.movieMedia.findVideosByIds(heroIds),
      () => this.movieMedia.findPhotosByIds(backdropIds),
    ]);
    const images = await this.media.findByIds(backdrops.map((photo) => photo.image_id));
    const videosById = new Map(videos.map((video) => [video.id, toVideo(video)]));
    const backdropsById = new Map(backdrops.map((photo) => [photo.id, photo.image_id]));
    return rows.flatMap((row, index) => {
      const heroVideo = row.hero_video_id === null ? undefined : videosById.get(row.hero_video_id);
      const movie = summaries[index];
      if (row.featured_position === null || !heroVideo || !movie) return [];
      const backdropImageId =
        row.backdrop_photo_id === null ? null : (backdropsById.get(row.backdrop_photo_id) ?? null);
      return [
        {
          position: row.featured_position,
          movie,
          heroVideo,
          backdrop: imageOf(images, backdropImageId),
        },
      ];
    });
  }

  /** The admin editor's person: details, roles and filmography. */
  async adminPerson(id: number): Promise<AdminPerson | null> {
    const row = await this.people.findById(id);
    if (!row) return null;
    const [roles, credits] = await inSequence([
      () => this.people.rolesOf([row.id]),
      () => this.credits.creditsOfPeople([row.id]),
    ]);
    const images = await this.media.findByIds([
      ...(row.photo_image_id === null ? [] : [row.photo_image_id]),
      ...credits.flatMap((credit) =>
        credit.poster_image_id === null ? [] : [credit.poster_image_id],
      ),
    ]);
    return {
      ...personFields(row, images),
      roles: inRoleOrder(roles.map((role) => role.role)),
      creditedRoles: inRoleOrder(credits.map((credit) => credit.role)),
      credits: credits.map((credit) => ({
        id: credit.id,
        role: credit.role,
        characterName: credit.character_name,
        movie: {
          id: credit.movie_id,
          title: credit.title,
          status: credit.status,
          releaseDate: credit.release_date,
          poster: imageOf(images, credit.poster_image_id),
        },
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Rows of the admin people list, in the order given. */
  async adminPersonListItems(rows: readonly PersonRow[]): Promise<AdminPersonListItem[]> {
    const ids = rows.map((row) => row.id);
    const [roles, summaries, knownFor, images] = await inSequence([
      () => this.people.rolesOf(ids),
      () => this.credits.summariesOf(ids),
      () => this.credits.knownFor(ids, KNOWN_FOR_LIMIT),
      () => this.media.findByIds(photoIdsOf(rows)),
    ]);
    const setRoles = groupBy(roles, (role) => role.person_id);
    const summariesById = new Map(summaries.map((summary) => [summary.person_id, summary]));
    const knownForById = groupBy(knownFor, (movie) => movie.person_id);
    return rows.map((row) => {
      const summary = summariesById.get(row.id);
      return {
        id: row.id,
        fullName: row.full_name,
        photo: imageOf(images, row.photo_image_id),
        roles: inRoleOrder([
          ...(setRoles.get(row.id) ?? []).map((role) => role.role),
          ...(summary?.roles ?? []),
        ]),
        birthYear: row.birth_date === null ? null : Number(row.birth_date.slice(0, 4)),
        birthPlace: row.birth_place,
        creditCount: summary?.credit_count ?? 0,
        knownFor: (knownForById.get(row.id) ?? []).map((movie) => ({
          id: movie.movie_id,
          title: movie.title,
        })),
      };
    });
  }

  /** People of the public list, in the order given, with the union of their roles. */
  async publicPeople(rows: readonly PersonRow[]): Promise<PublicPerson[]> {
    const ids = rows.map((row) => row.id);
    const [roles, summaries, images] = await inSequence([
      () => this.people.rolesOf(ids),
      () => this.credits.summariesOf(ids),
      () => this.media.findByIds(photoIdsOf(rows)),
    ]);
    const setRoles = groupBy(roles, (role) => role.person_id);
    const summariesById = new Map(summaries.map((summary) => [summary.person_id, summary]));
    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      photo: imageOf(images, row.photo_image_id),
      roles: inRoleOrder([
        ...(setRoles.get(row.id) ?? []).map((role) => role.role),
        ...(summariesById.get(row.id)?.roles ?? []),
      ]),
    }));
  }

  /** Each movie's genres in display order, in one query. */
  async genresByMovie(movieIds: readonly number[]): Promise<Map<number, GenreRef[]>> {
    const rows = await this.genres.genresOf(movieIds);
    const byMovie = new Map<number, GenreRef[]>();
    for (const row of rows) {
      const list = byMovie.get(row.movie_id) ?? [];
      list.push({ id: row.id, name: row.name, slug: row.slug });
      byMovie.set(row.movie_id, list);
    }
    return byMovie;
  }
}

function movieFields(row: MovieRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    synopsis: row.synopsis,
    runtimeMinutes: row.runtime_minutes,
    releaseDate: row.release_date,
    ageRating: row.age_rating,
    language: row.language,
    country: row.country,
    productionCompany: row.production_company,
    budgetLabel: row.budget_label,
    filmingLocations: row.filming_locations,
  };
}

function personFields(row: PersonRow, images: ReadonlyMap<number, StoredImage>) {
  return {
    id: row.id,
    fullName: row.full_name,
    birthDate: row.birth_date,
    birthPlace: row.birth_place,
    nationality: row.nationality,
    bio: row.bio,
    photo: imageOf(images, row.photo_image_id),
    instagramUrl: row.instagram_url,
    imdbUrl: row.imdb_url,
    websiteUrl: row.website_url,
  };
}

/** A public row as a card: the CHECK guarantees the public fields are set. */
function toSummary(
  row: MovieRow,
  genres: readonly GenreRef[],
  images: ReadonlyMap<number, StoredImage>,
): MovieSummary {
  if (row.synopsis === null || row.runtime_minutes === null || row.release_date === null) {
    throw new AppError(
      'INTERNAL',
      'A public movie is missing its synopsis, runtime or release date.',
    );
  }
  return {
    id: row.id,
    title: row.title,
    status: row.status as PublicMovieStatus,
    synopsis: row.synopsis,
    runtimeMinutes: row.runtime_minutes,
    releaseDate: row.release_date,
    ageRating: row.age_rating,
    genres,
    poster: imageOf(images, row.poster_image_id),
  };
}

export function toVideo(row: MovieVideoRow): MovieVideo {
  return {
    id: row.id,
    youtubeId: row.youtube_id,
    title: row.title,
    kind: row.kind,
    durationSeconds: row.duration_seconds,
    position: row.sort_order,
  };
}

function toPhotos(
  rows: readonly MoviePhotoRow[],
  images: ReadonlyMap<number, StoredImage>,
): MoviePhoto[] {
  return rows.flatMap((row) => {
    const image = images.get(row.image_id);
    if (!image) return [];
    return [{ id: row.id, kind: row.kind, caption: row.caption, position: row.sort_order, image }];
  });
}

function toCredits(
  rows: readonly MovieCreditWithPersonRow[],
  images: ReadonlyMap<number, StoredImage>,
): MovieCredit[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    characterName: row.character_name,
    position: row.sort_order,
    person: {
      id: row.person_id,
      fullName: row.full_name,
      photo: imageOf(images, row.photo_image_id),
    },
  }));
}

function imageOf(images: ReadonlyMap<number, StoredImage>, id: number | null): StoredImage | null {
  return id === null ? null : (images.get(id) ?? null);
}

function posterIdsOf(rows: readonly MovieRow[]): number[] {
  return rows.flatMap((row) => (row.poster_image_id === null ? [] : [row.poster_image_id]));
}

function photoIdsOf(rows: readonly PersonRow[]): number[] {
  return rows.flatMap((row) => (row.photo_image_id === null ? [] : [row.photo_image_id]));
}

/** The distinct roles, in `CREDIT_ROLES` order. */
export function inRoleOrder(roles: readonly CreditRole[]): CreditRole[] {
  const present = new Set(roles);
  return CREDIT_ROLES.filter((role) => present.has(role));
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}
