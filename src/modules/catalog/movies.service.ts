import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { toPage } from '../../common/pagination/cursor';
import type { PageRequest } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { MediaService } from '../media/media.service';
import { CatalogAssembler } from './catalog-assembler.service';
import { fieldError } from './catalog-errors';
import { DEFAULT_AGE_RATING } from './catalog.constants';
import { CreditsRepository } from './credits.repository';
import { MOVIE_STATUSES } from './enums';
import { GenresRepository } from './genres.repository';
import { diffMovie, sameOrder } from './movie-changes';
import { MovieLifecycleRegistry } from './movie-lifecycle.registry';
import { MovieMediaRepository } from './movie-media.repository';
import {
  backdropShapeDetails,
  canTransition,
  featureBlockers,
  isBackdropShaped,
  isPublicStatus,
  missingPublishRequirements,
} from './movie-rules';
import { MoviesRepository } from './movies.repository';
import type {
  AdminMovie,
  AdminMovieListFilter,
  AdminMoviePage,
  BulkArchiveResult,
  MovieChanges,
  MovieRow,
  MovieStatus,
  NewMovieInput,
} from './types';
import { inSequence } from './sequential';

/**
 * Movies in the admin dashboard (PRD A2): the list, the editor's reads, create, edit with the
 * publishing and featuring rules, bulk archive and delete. Every write joins the request
 * transaction, locks the movie first (the catalog lock order: movies in ascending id, then
 * people) and records an audit event with field names only.
 */
@Injectable()
export class MoviesService {
  constructor(
    private readonly movies: MoviesRepository,
    private readonly genres: GenresRepository,
    private readonly movieMedia: MovieMediaRepository,
    private readonly credits: CreditsRepository,
    private readonly media: MediaService,
    private readonly assembler: CatalogAssembler,
    private readonly lifecycle: MovieLifecycleRegistry,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** `GET /admin/movies`: newest first, with the status counts for the same search. */
  async list(filter: AdminMovieListFilter, page: PageRequest): Promise<AdminMoviePage> {
    const [rows, total, counts] = await inSequence([
      () => this.movies.adminList(filter, page),
      () => this.movies.adminCount(filter),
      () => this.movies.adminStatusCounts(filter.q),
    ]);
    const rowPage = toPage(
      rows,
      page,
      total,
      (row) => ({ sortKey: row.created_at.toISOString(), id: row.id }),
      (row) => row,
    );
    const statusCounts = Object.fromEntries(MOVIE_STATUSES.map((status) => [status, 0])) as Record<
      MovieStatus,
      number
    >;
    for (const count of counts) statusCounts[count.status] = count.count;
    return {
      items: await this.assembler.adminMovieListItems(rowPage.items),
      nextCursor: rowPage.nextCursor,
      total: rowPage.total,
      statusCounts: statusCounts,
    };
  }

  /** The editor's movie; `NOT_FOUND` when it doesn't exist. */
  async get(id: number): Promise<AdminMovie> {
    const movie = await this.assembler.adminMovie(id);
    if (!movie) throw new AppError('NOT_FOUND');
    return movie;
  }

  /** `POST /admin/movies`: always a draft; `ageRating` defaults to 12+. */
  async create(actor: StaffPrincipal, input: NewMovieInput): Promise<AdminMovie> {
    return this.transactions.run(async () => {
      const genreIds = input.genreIds ?? [];
      await this.assertGenresExist(genreIds);
      const now = this.clock.now();
      const row = await this.movies.insert({
        title: input.title,
        status: 'draft',
        synopsis: input.synopsis ?? null,
        runtime_minutes: input.runtimeMinutes ?? null,
        release_date: input.releaseDate ?? null,
        age_rating: input.ageRating ?? DEFAULT_AGE_RATING,
        language: input.language ?? null,
        country: input.country ?? null,
        production_company: input.productionCompany ?? null,
        budget_label: input.budgetLabel ?? null,
        filming_locations: input.filmingLocations ?? null,
        poster_image_id: null,
        backdrop_photo_id: null,
        hero_video_id: null,
        featured_position: null,
        updated_by_staff_id: actor.id,
        created_at: now,
        updated_at: now,
      });
      await this.genres.replaceMovieGenres(row.id, genreIds);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'movie.created',
        entity: { type: 'movie', id: row.id },
      });
      return this.get(row.id);
    });
  }

  /**
   * `PATCH /admin/movies/{id}`: details, genres, hero video, backdrop, status and the carousel
   * position, judged on the movie as it would be after the change:
   *
   * 1. genres exist; the hero video and backdrop are this movie's (`VALIDATION_FAILED`), and a
   *    new backdrop is 16:9 and at least 1280 × 720 (`IMAGE_WRONG_SHAPE`);
   * 2. the status change is allowed (`CONFLICT { from, to }`); leaving the public statuses
   *    frees the movie's carousel position;
   * 3. a public movie has a synopsis, runtime, release date and a genre (`MOVIE_NOT_PUBLISHABLE`);
   * 4. a featured movie is public with a hero video (`MOVIE_NOT_FEATURABLE`), and its position is
   *    free (`FEATURED_POSITION_TAKEN`).
   *
   * A change to nothing writes nothing.
   */
  async update(actor: StaffPrincipal, id: number, changes: MovieChanges): Promise<AdminMovie> {
    return this.transactions.run(async () => {
      const row = await this.movies.findByIdForUpdate(id);
      if (!row) throw new AppError('NOT_FOUND');
      const currentGenreIds = (await this.genres.genresOf([id])).map((genre) => genre.id);
      const genreIds = changes.genreIds ?? currentGenreIds;
      const genresChanged = !sameOrder(genreIds, currentGenreIds);
      if (genresChanged) await this.assertGenresExist(genreIds);

      const diff = diffMovie(row, changes);
      await this.assertMediaBelongs(row, changes);

      const status = changes.status ?? row.status;
      const statusChanged = status !== row.status;
      if (statusChanged && !canTransition(row.status, status)) {
        throw new AppError('CONFLICT', `A ${row.status} movie can't become ${status}.`, {
          from: row.status,
          to: status,
        });
      }
      const heroVideoId =
        changes.heroVideoId === undefined ? row.hero_video_id : changes.heroVideoId;
      const featuredPosition =
        changes.featuredPosition !== undefined
          ? changes.featuredPosition
          : isPublicStatus(status)
            ? row.featured_position
            : null;

      if (isPublicStatus(status)) {
        const missing = missingPublishRequirements({
          synopsis: changes.synopsis === undefined ? row.synopsis : changes.synopsis,
          runtimeMinutes:
            changes.runtimeMinutes === undefined ? row.runtime_minutes : changes.runtimeMinutes,
          releaseDate: changes.releaseDate === undefined ? row.release_date : changes.releaseDate,
          genreCount: genreIds.length,
        });
        if (missing.length > 0) throw new AppError('MOVIE_NOT_PUBLISHABLE', undefined, { missing });
      }
      const featuredChanged = featuredPosition !== row.featured_position;
      if (featuredPosition !== null) {
        const reasons = featureBlockers({ status, heroVideoId });
        if (reasons.length > 0) throw new AppError('MOVIE_NOT_FEATURABLE', undefined, { reasons });
        if (featuredChanged) await this.assertPositionFree(featuredPosition, id);
      }

      if (diff.changedFields.length === 0 && !genresChanged && !statusChanged && !featuredChanged) {
        return this.get(id);
      }
      await this.movies.update(id, {
        ...diff.columns,
        ...(statusChanged ? { status } : {}),
        ...(featuredChanged ? { featured_position: featuredPosition } : {}),
        updated_at: this.clock.now(),
        updated_by_staff_id: actor.id,
      });
      if (genresChanged) await this.genres.replaceMovieGenres(id, genreIds);

      const staff = { kind: 'staff', id: actor.id } as const;
      const entity = { type: 'movie', id } as const;
      const changedFields = [...diff.changedFields, ...(genresChanged ? ['genreIds'] : [])];
      if (changedFields.length > 0) {
        await this.audit.record({ actor: staff, action: 'movie.updated', entity, changedFields });
      }
      if (statusChanged) {
        await this.audit.record({
          actor: staff,
          action: 'movie.status_changed',
          entity,
          metadata: { from: row.status, to: status },
        });
      }
      if (featuredChanged) {
        await this.audit.record(
          featuredPosition === null
            ? {
                actor: staff,
                action: 'movie.unfeatured',
                entity,
                metadata: { previousPosition: row.featured_position },
              }
            : {
                actor: staff,
                action: 'movie.featured',
                entity,
                metadata: { position: featuredPosition, previousPosition: row.featured_position },
              },
        );
      }
      return this.get(id);
    });
  }

  /**
   * `PATCH /admin/movies` with `status: archived`: all or nothing. Unknown ids are `NOT_FOUND`
   * (`details.missingIds`) and change nothing; already archived movies are reported, not refused.
   * Archiving frees carousel positions in the same statement.
   */
  async bulkArchive(
    actor: StaffPrincipal,
    movieIds: readonly number[],
  ): Promise<BulkArchiveResult> {
    return this.transactions.run(async () => {
      const ids = [...new Set(movieIds)].sort((a, b) => a - b);
      const rows = await this.movies.findByIdsForUpdate(ids);
      const found = new Set(rows.map((row) => row.id));
      const missingIds = ids.filter((id) => !found.has(id));
      if (missingIds.length > 0) {
        throw new AppError('NOT_FOUND', 'Some of these movies do not exist.', { missingIds });
      }
      const toArchive = rows.filter((row) => row.status !== 'archived');
      await this.movies.archive(
        toArchive.map((row) => row.id),
        this.clock.now(),
        actor.id,
      );
      for (const row of toArchive) {
        const entity = { type: 'movie', id: row.id } as const;
        const staff = { kind: 'staff', id: actor.id } as const;
        await this.audit.record({
          actor: staff,
          action: 'movie.archived',
          entity,
          metadata: { from: row.status, bulk: true },
        });
        if (row.featured_position !== null) {
          await this.audit.record({
            actor: staff,
            action: 'movie.unfeatured',
            entity,
            metadata: { previousPosition: row.featured_position },
          });
        }
      }
      return {
        archivedIds: toArchive.map((row) => row.id),
        alreadyArchivedIds: rows.filter((row) => row.status === 'archived').map((row) => row.id),
      };
    });
  }

  /**
   * `DELETE /admin/movies/{id}`: refused with `MOVIE_NOT_DELETABLE` when a registered blocker
   * says so (a movie that ever had a booking, U10); otherwise the movie and everything it owns
   * goes, and its images' files once the transaction commits.
   */
  async delete(actor: StaffPrincipal, id: number): Promise<void> {
    await this.transactions.run(async () => {
      const row = await this.movies.findByIdForDelete(id);
      if (!row) throw new AppError('NOT_FOUND');
      const reasons = await this.lifecycle.deletionBlockersOf(id);
      if (reasons.length > 0) throw new AppError('MOVIE_NOT_DELETABLE', undefined, { reasons });

      const [photos, videos, creditCounts] = await inSequence([
        () => this.movieMedia.photosOf([id]),
        () => this.movieMedia.videosOf([id]),
        () => this.credits.countsByMovie([id]),
      ]);
      await this.movies.deleteById(id);
      await this.media.deleteMany([
        ...(row.poster_image_id === null ? [] : [row.poster_image_id]),
        ...photos.map((photo) => photo.image_id),
      ]);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'movie.deleted',
        entity: { type: 'movie', id },
        metadata: {
          photoCount: photos.length,
          videoCount: videos.length,
          creditCount: creditCounts.get(id) ?? 0,
        },
      });
    });
  }

  private async assertGenresExist(genreIds: readonly number[]): Promise<void> {
    if (genreIds.length === 0) return;
    const found = await this.genres.findByIds(genreIds);
    if (found.length !== new Set(genreIds).size) {
      throw fieldError('genreIds', 'genreIds must name existing genres');
    }
  }

  /** The hero video and backdrop must be this movie's own; a new backdrop must be 16:9. */
  private async assertMediaBelongs(row: MovieRow, changes: MovieChanges): Promise<void> {
    const { heroVideoId, backdropPhotoId } = changes;
    if (heroVideoId !== undefined && heroVideoId !== null && heroVideoId !== row.hero_video_id) {
      const video = await this.movieMedia.findVideo(row.id, heroVideoId);
      if (!video) throw fieldError('heroVideoId', "heroVideoId must be one of this movie's videos");
    }
    if (
      backdropPhotoId !== undefined &&
      backdropPhotoId !== null &&
      backdropPhotoId !== row.backdrop_photo_id
    ) {
      const photo = await this.movieMedia.findPhoto(row.id, backdropPhotoId);
      if (!photo) {
        throw fieldError('backdropPhotoId', "backdropPhotoId must be one of this movie's photos");
      }
      const image = (await this.media.findByIds([photo.image_id])).get(photo.image_id);
      if (!image) throw new AppError('INTERNAL', 'A movie photo has no image.');
      if (!isBackdropShaped(image)) {
        throw new AppError(
          'IMAGE_WRONG_SHAPE',
          'A backdrop must be a 16:9 photo of at least 1280 × 720.',
          backdropShapeDetails(image),
        );
      }
    }
  }

  private async assertPositionFree(position: number, movieId: number): Promise<void> {
    const holder = await this.movies.findByFeaturedPosition(position);
    if (holder && holder.id !== movieId) {
      throw new AppError('FEATURED_POSITION_TAKEN', undefined, { position, movieId: holder.id });
    }
  }
}
