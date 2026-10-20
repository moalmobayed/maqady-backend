import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { MediaService } from '../media/media.service';
import type { ImageUploadPayload, UploadOutcome } from '../media/types';
import { CatalogAssembler } from './catalog-assembler.service';
import { MAX_MOVIE_PHOTOS, MAX_MOVIE_VIDEOS } from './catalog.constants';
import { moved } from './movie-changes';
import { MovieMediaRepository } from './movie-media.repository';
import { MoviesRepository } from './movies.repository';
import type {
  AdminMovie,
  MoviePhotoChanges,
  MoviePhotoFields,
  MovieRow,
  MovieVideoChanges,
  NewMovieVideoInput,
  Presenter,
} from './types';

/**
 * A movie's media (PRD A2 "Media tab"): the poster, the photos and the YouTube videos. Uploads
 * run outside the request transaction (`@ImageUpload()`): the image work happens first, then
 * `MediaService.upload()` opens a short transaction in which `link` locks the movie and links
 * the image. Every change touches the movie's "Last edited by" and is audited.
 */
@Injectable()
export class MovieMediaService {
  constructor(
    private readonly movies: MoviesRepository,
    private readonly movieMedia: MovieMediaRepository,
    private readonly media: MediaService,
    private readonly assembler: CatalogAssembler,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** A fast `NOT_FOUND` before an upload's image work; `link` checks again under the lock. */
  async assertMovieExists(movieId: number): Promise<void> {
    if (!(await this.movies.findById(movieId))) throw new AppError('NOT_FOUND');
  }

  /** `PUT /admin/movies/{id}/poster`: sets the poster; a replaced one goes with its files. */
  async uploadPoster<T>(
    actor: StaffPrincipal,
    movieId: number,
    upload: ImageUploadPayload,
    present: Presenter<AdminMovie, T>,
  ): Promise<UploadOutcome<T>> {
    await this.assertMovieExists(movieId);
    return this.media.upload({
      kind: 'poster',
      upload,
      actor,
      link: async (image) => {
        const row = await this.lockMovie(movieId);
        await this.movies.update(movieId, {
          poster_image_id: image.id,
          updated_at: this.clock.now(),
          updated_by_staff_id: actor.id,
        });
        if (row.poster_image_id !== null) await this.media.delete(row.poster_image_id);
        await this.record(actor, 'movie.poster_replaced', movieId);
        return present(await this.adminMovie(movieId));
      },
    });
  }

  /** `DELETE /admin/movies/{id}/poster`: removes the poster, if any, and its files. */
  async removePoster(actor: StaffPrincipal, movieId: number): Promise<void> {
    await this.transactions.run(async () => {
      const row = await this.lockMovie(movieId);
      if (row.poster_image_id === null) return;
      await this.movies.update(movieId, {
        poster_image_id: null,
        updated_at: this.clock.now(),
        updated_by_staff_id: actor.id,
      });
      await this.media.delete(row.poster_image_id);
      await this.record(actor, 'movie.poster_removed', movieId);
    });
  }

  /** `POST /admin/movies/{id}/photos`: adds a gallery photo at the end; at most 30. */
  async uploadPhoto<T>(
    actor: StaffPrincipal,
    movieId: number,
    fields: MoviePhotoFields,
    upload: ImageUploadPayload,
    present: Presenter<AdminMovie, T>,
  ): Promise<UploadOutcome<T>> {
    await this.assertMovieExists(movieId);
    return this.media.upload({
      kind: 'gallery',
      upload,
      actor,
      link: async (image) => {
        await this.lockMovie(movieId);
        const count = await this.movieMedia.countPhotos(movieId);
        if (count >= MAX_MOVIE_PHOTOS) {
          throw new AppError('CONFLICT', `A movie has at most ${MAX_MOVIE_PHOTOS} photos.`, {
            limit: MAX_MOVIE_PHOTOS,
          });
        }
        const now = this.clock.now();
        const photo = await this.movieMedia.insertPhoto({
          movie_id: movieId,
          image_id: image.id,
          kind: fields.kind,
          caption: fields.caption,
          sort_order: count,
          created_at: now,
          updated_at: now,
        });
        await this.touch(actor, movieId);
        await this.audit.record({
          actor: { kind: 'staff', id: actor.id },
          action: 'movie_photo.created',
          entity: { type: 'movie_photo', id: photo.id },
          metadata: { movieId },
        });
        return present(await this.adminMovie(movieId));
      },
    });
  }

  /** `PATCH /admin/movies/{id}/photos/{photoId}`: type, caption or place in the list. */
  async updatePhoto(
    actor: StaffPrincipal,
    movieId: number,
    photoId: number,
    changes: MoviePhotoChanges,
  ): Promise<AdminMovie> {
    return this.transactions.run(async () => {
      await this.lockMovie(movieId);
      const photo = await this.movieMedia.findPhoto(movieId, photoId);
      if (!photo) throw new AppError('NOT_FOUND');
      const changedFields: string[] = [];
      if (changes.kind !== undefined && changes.kind !== photo.kind) changedFields.push('kind');
      if (changes.caption !== undefined && changes.caption !== photo.caption) {
        changedFields.push('caption');
      }
      if (changedFields.length > 0) {
        await this.movieMedia.updatePhoto(photoId, {
          ...(changedFields.includes('kind') ? { kind: changes.kind } : {}),
          ...(changedFields.includes('caption') ? { caption: changes.caption ?? null } : {}),
          updated_at: this.clock.now(),
        });
      }
      if (changes.position !== undefined) {
        const order = await this.movieMedia.photoOrder(movieId);
        const next = moved(order, photoId, changes.position);
        if (next.indexOf(photoId) !== order.indexOf(photoId)) {
          await this.movieMedia.setPhotoOrder(movieId, next);
          changedFields.push('position');
        }
      }
      if (changedFields.length === 0) return this.adminMovie(movieId);
      await this.touch(actor, movieId);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'movie_photo.updated',
        entity: { type: 'movie_photo', id: photoId },
        changedFields,
        metadata: { movieId },
      });
      return this.adminMovie(movieId);
    });
  }

  /** `DELETE /admin/movies/{id}/photos/{photoId}`: also clears the backdrop if it was this one. */
  async deletePhoto(actor: StaffPrincipal, movieId: number, photoId: number): Promise<void> {
    await this.transactions.run(async () => {
      const row = await this.lockMovie(movieId);
      const photo = await this.movieMedia.findPhoto(movieId, photoId);
      if (!photo) throw new AppError('NOT_FOUND');
      await this.movies.update(movieId, {
        ...(row.backdrop_photo_id === photoId ? { backdrop_photo_id: null } : {}),
        updated_at: this.clock.now(),
        updated_by_staff_id: actor.id,
      });
      await this.movieMedia.deletePhoto(photoId);
      await this.movieMedia.setPhotoOrder(movieId, await this.movieMedia.photoOrder(movieId));
      await this.media.delete(photo.image_id);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'movie_photo.deleted',
        entity: { type: 'movie_photo', id: photoId },
        metadata: { movieId },
      });
    });
  }

  /**
   * `POST /admin/movies/{id}/videos`: adds a YouTube video at the end; at most 20, and the same
   * video once per movie (`CONFLICT`).
   */
  async addVideo(
    actor: StaffPrincipal,
    movieId: number,
    input: NewMovieVideoInput,
  ): Promise<AdminMovie> {
    return this.transactions.run(async () => {
      await this.lockMovie(movieId);
      if (await this.movieMedia.findVideoByYoutubeId(movieId, input.youtubeId)) {
        throw new AppError('CONFLICT', 'This video is already on the movie.', {
          constraint: 'uq_movie_videos_movie_id_youtube_id',
        });
      }
      const count = await this.movieMedia.countVideos(movieId);
      if (count >= MAX_MOVIE_VIDEOS) {
        throw new AppError('CONFLICT', `A movie has at most ${MAX_MOVIE_VIDEOS} videos.`, {
          limit: MAX_MOVIE_VIDEOS,
        });
      }
      const now = this.clock.now();
      const video = await this.movieMedia.insertVideo({
        movie_id: movieId,
        youtube_id: input.youtubeId,
        kind: input.kind,
        title: input.title,
        duration_seconds: input.durationSeconds,
        sort_order: count,
        created_at: now,
        updated_at: now,
      });
      await this.touch(actor, movieId);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'movie_video.created',
        entity: { type: 'movie_video', id: video.id },
        metadata: { movieId, youtubeId: video.youtube_id },
      });
      return this.adminMovie(movieId);
    });
  }

  /** `PATCH /admin/movies/{id}/videos/{videoId}`: title, type, duration or place in the list. */
  async updateVideo(
    actor: StaffPrincipal,
    movieId: number,
    videoId: number,
    changes: MovieVideoChanges,
  ): Promise<AdminMovie> {
    return this.transactions.run(async () => {
      await this.lockMovie(movieId);
      const video = await this.movieMedia.findVideo(movieId, videoId);
      if (!video) throw new AppError('NOT_FOUND');
      const changedFields: string[] = [];
      if (changes.title !== undefined && changes.title !== video.title) changedFields.push('title');
      if (changes.kind !== undefined && changes.kind !== video.kind) changedFields.push('kind');
      if (
        changes.durationSeconds !== undefined &&
        changes.durationSeconds !== video.duration_seconds
      ) {
        changedFields.push('durationSeconds');
      }
      if (changedFields.length > 0) {
        await this.movieMedia.updateVideo(videoId, {
          ...(changedFields.includes('title') ? { title: changes.title } : {}),
          ...(changedFields.includes('kind') ? { kind: changes.kind } : {}),
          ...(changedFields.includes('durationSeconds')
            ? { duration_seconds: changes.durationSeconds ?? null }
            : {}),
          updated_at: this.clock.now(),
        });
      }
      if (changes.position !== undefined) {
        const order = await this.movieMedia.videoOrder(movieId);
        const next = moved(order, videoId, changes.position);
        if (next.indexOf(videoId) !== order.indexOf(videoId)) {
          await this.movieMedia.setVideoOrder(movieId, next);
          changedFields.push('position');
        }
      }
      if (changedFields.length === 0) return this.adminMovie(movieId);
      await this.touch(actor, movieId);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'movie_video.updated',
        entity: { type: 'movie_video', id: videoId },
        changedFields,
        metadata: { movieId, youtubeId: video.youtube_id },
      });
      return this.adminMovie(movieId);
    });
  }

  /**
   * `DELETE /admin/movies/{id}/videos/{videoId}`. The hero video of a featured movie is refused
   * (`MOVIE_NOT_FEATURABLE`); the hero of a movie that isn't featured is cleared first.
   */
  async deleteVideo(actor: StaffPrincipal, movieId: number, videoId: number): Promise<void> {
    await this.transactions.run(async () => {
      const row = await this.lockMovie(movieId);
      const video = await this.movieMedia.findVideo(movieId, videoId);
      if (!video) throw new AppError('NOT_FOUND');
      const isHero = row.hero_video_id === videoId;
      if (isHero && row.featured_position !== null) {
        throw new AppError(
          'MOVIE_NOT_FEATURABLE',
          'This is the hero video of a featured movie; unfeature the movie or pick another hero first.',
          { reasons: ['no_hero_video'] },
        );
      }
      await this.movies.update(movieId, {
        ...(isHero ? { hero_video_id: null } : {}),
        updated_at: this.clock.now(),
        updated_by_staff_id: actor.id,
      });
      await this.movieMedia.deleteVideo(videoId);
      await this.movieMedia.setVideoOrder(movieId, await this.movieMedia.videoOrder(movieId));
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'movie_video.deleted',
        entity: { type: 'movie_video', id: videoId },
        metadata: { movieId, youtubeId: video.youtube_id },
      });
    });
  }

  private async lockMovie(movieId: number): Promise<MovieRow> {
    const row = await this.movies.findByIdForUpdate(movieId);
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async touch(actor: StaffPrincipal, movieId: number): Promise<void> {
    await this.movies.touch([movieId], this.clock.now(), actor.id);
  }

  private async record(actor: StaffPrincipal, action: string, movieId: number): Promise<void> {
    await this.audit.record({
      actor: { kind: 'staff', id: actor.id },
      action,
      entity: { type: 'movie', id: movieId },
    });
  }

  private async adminMovie(movieId: number): Promise<AdminMovie> {
    const movie = await this.assembler.adminMovie(movieId);
    if (!movie) throw new AppError('NOT_FOUND');
    return movie;
  }
}
