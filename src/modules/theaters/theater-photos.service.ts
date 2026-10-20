import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { MediaService } from '../media/media.service';
import type { StoredImage, UploadOutcome } from '../media/types';
import { TheaterPhotosRepository } from './theater-photos.repository';
import { MAX_GALLERY_PHOTOS } from './theaters.constants';
import { TheatersRepository } from './theaters.repository';
import { TheatersService } from './theaters.service';
import type {
  TheaterAdminView,
  TheaterAuditDetails,
  TheaterPhotoChanges,
  TheaterPhotoUploadInput,
} from './types';

/**
 * A theater's cover and gallery (design §9, PRD A4 "Photos tab"), through `MediaService`:
 *
 * - the cover is an image of kind `backdrop` (centre-cropped to 16:9, at least 1280 × 720); a new
 *   cover replaces the old one, whose files go after commit;
 * - gallery photos are images of kind `gallery`, at most 20 per theater, in an order kept
 *   contiguous from 0.
 *
 * An upload processes and stores the file outside any transaction, then links it in the short
 * transaction `MediaService.upload()` opens, under the theater's lock. The other writes join the
 * request transaction and lock the theater first, like every theater write.
 */
@Injectable()
export class TheaterPhotosService {
  constructor(
    private readonly photos: TheaterPhotosRepository,
    private readonly theaterRows: TheatersRepository,
    private readonly theaters: TheatersService,
    private readonly media: MediaService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * `POST /admin/theaters/{id}/photos`. A missing theater or a full gallery is refused before
   * any image work, and checked again under the theater's lock when the image is linked; a refusal
   * then deletes the stored files. `respond` builds the response body stored with the key.
   */
  async upload<T>(
    input: TheaterPhotoUploadInput,
    respond: (view: TheaterAdminView) => T,
  ): Promise<UploadOutcome<T>> {
    const { theaterId, usage } = input;
    if (!(await this.theaterRows.findById(theaterId))) throw new AppError('NOT_FOUND');
    if (usage === 'gallery') {
      this.assertRoom((await this.photos.photosOf([theaterId])).length);
    }
    return this.media.upload({
      kind: usage === 'cover' ? 'backdrop' : 'gallery',
      upload: input.upload,
      actor: input.actor,
      link: async (image) => {
        if (usage === 'cover') await this.linkCover(input.actor, theaterId, image);
        else await this.linkGalleryPhoto(input.actor, theaterId, image, input.caption);
        return respond(await this.theaters.view(theaterId));
      },
    });
  }

  /**
   * `PATCH /admin/theaters/{id}/photos/{photoId}`: the caption (null removes it) and the place in
   * the gallery (beyond the last place means last). Nothing to change: no write.
   */
  async update(
    actor: StaffPrincipal,
    theaterId: number,
    photoId: number,
    changes: TheaterPhotoChanges,
  ): Promise<TheaterAdminView> {
    await this.transactions.run(async () => {
      await this.theaters.lockForWrite(theaterId);
      const photo = await this.photos.findPhoto(theaterId, photoId);
      if (!photo) throw new AppError('NOT_FOUND');
      const now = this.clock.now();
      const changedFields: string[] = [];

      if (changes.caption !== undefined && changes.caption !== photo.caption) {
        await this.photos.updateCaption(photoId, changes.caption, now);
        changedFields.push('caption');
      }
      if (changes.position !== undefined) {
        const order = (await this.photos.photosOf([theaterId])).map((row) => row.id);
        const others = order.filter((id) => id !== photoId);
        const position = Math.min(changes.position, others.length);
        if (order.indexOf(photoId) !== position) {
          others.splice(position, 0, photoId);
          await this.photos.reorder(theaterId, others, now);
          changedFields.push('position');
        }
      }
      if (changedFields.length === 0) return;
      await this.theaters.touch(theaterId);
      await this.record(actor, 'theater_photo.updated', photoId, theaterId, { changedFields });
    });
    return this.theaters.view(theaterId);
  }

  /** `DELETE /admin/theaters/{id}/photos/{photoId}`: the photo, its image and, after commit, its files. */
  async delete(actor: StaffPrincipal, theaterId: number, photoId: number): Promise<void> {
    await this.transactions.run(async () => {
      await this.theaters.lockForWrite(theaterId);
      const photo = await this.photos.findPhoto(theaterId, photoId);
      if (!photo) throw new AppError('NOT_FOUND');
      await this.photos.delete(photoId);
      await this.media.delete(photo.image_id);
      const remaining = (await this.photos.photosOf([theaterId])).map((row) => row.id);
      await this.photos.reorder(theaterId, remaining, this.clock.now());
      await this.theaters.touch(theaterId);
      await this.record(actor, 'theater_photo.deleted', photoId, theaterId);
    });
  }

  /** `DELETE /admin/theaters/{id}/cover`: removes the cover; without one, does nothing. */
  async deleteCover(actor: StaffPrincipal, theaterId: number): Promise<void> {
    await this.transactions.run(async () => {
      const row = await this.theaters.lockForWrite(theaterId);
      if (row.cover_image_id === null) return;
      await this.theaterRows.update(theaterId, {
        cover_image_id: null,
        updated_at: this.clock.now(),
      });
      await this.media.delete(row.cover_image_id);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'theater.cover_removed',
        entity: { type: 'theater', id: theaterId },
      });
    });
  }

  private async linkCover(
    actor: StaffPrincipal,
    theaterId: number,
    image: StoredImage,
  ): Promise<void> {
    const row = await this.theaters.lockForWrite(theaterId);
    await this.theaterRows.update(theaterId, {
      cover_image_id: image.id,
      updated_at: this.clock.now(),
    });
    if (row.cover_image_id !== null) await this.media.delete(row.cover_image_id);
    await this.audit.record({
      actor: { kind: 'staff', id: actor.id },
      action: 'theater.cover_replaced',
      entity: { type: 'theater', id: theaterId },
      metadata: { hadCover: row.cover_image_id !== null },
    });
  }

  private async linkGalleryPhoto(
    actor: StaffPrincipal,
    theaterId: number,
    image: StoredImage,
    caption: string | null,
  ): Promise<void> {
    await this.theaters.lockForWrite(theaterId);
    const count = (await this.photos.photosOf([theaterId])).length;
    this.assertRoom(count);
    const now = this.clock.now();
    const photo = await this.photos.insert({
      theater_id: theaterId,
      image_id: image.id,
      caption,
      sort_order: count,
      created_at: now,
      updated_at: now,
    });
    await this.theaters.touch(theaterId);
    await this.record(actor, 'theater_photo.created', photo.id, theaterId);
  }

  private assertRoom(count: number): void {
    if (count >= MAX_GALLERY_PHOTOS) {
      throw new AppError(
        'CONFLICT',
        `A theater has at most ${MAX_GALLERY_PHOTOS} gallery photos; delete one first.`,
        { limit: MAX_GALLERY_PHOTOS },
      );
    }
  }

  private async record(
    actor: StaffPrincipal,
    action: string,
    photoId: number,
    theaterId: number,
    extra: TheaterAuditDetails = {},
  ): Promise<void> {
    await this.audit.record({
      actor: { kind: 'staff', id: actor.id },
      action,
      entity: { type: 'theater_photo', id: photoId },
      ...extra,
      metadata: { theaterId, ...extra.metadata },
    });
  }
}
