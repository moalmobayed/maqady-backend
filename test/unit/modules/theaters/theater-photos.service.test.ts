import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import type { MediaService } from '../../../../src/modules/media/media.service';
import type { ImageUploadPayload } from '../../../../src/modules/media/types';
import type { TheaterPhotosRepository } from '../../../../src/modules/theaters/theater-photos.repository';
import { TheaterPhotosService } from '../../../../src/modules/theaters/theater-photos.service';
import type { TheatersRepository } from '../../../../src/modules/theaters/theaters.repository';
import type { TheatersService } from '../../../../src/modules/theaters/theaters.service';
import type { TheaterPhotoRow } from '../../../../src/modules/theaters/types';
import { TestClock } from '../../../support/clock';

const ACTOR: StaffPrincipal = { kind: 'staff', id: 3, sessionId: 9, role: 'admin' };
const NOW = new Date('2026-10-16T12:00:00+03:00');

const photo = (id: number, sortOrder: number): TheaterPhotoRow => ({
  id,
  theater_id: 1,
  image_id: 100 + id,
  caption: null,
  sort_order: sortOrder,
  created_at: NOW,
  updated_at: NOW,
});

describe('TheaterPhotosService (collaborators mocked)', () => {
  let gallery: TheaterPhotoRow[];
  let photos: jest.Mocked<
    Pick<TheaterPhotosRepository, 'photosOf' | 'findPhoto' | 'reorder' | 'updateCaption' | 'delete'>
  >;
  let media: jest.Mocked<Pick<MediaService, 'upload' | 'delete'>>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: TheaterPhotosService;

  beforeEach(() => {
    gallery = [photo(11, 0), photo(12, 1), photo(13, 2), photo(14, 3)];
    photos = {
      photosOf: jest.fn().mockImplementation(() => Promise.resolve(gallery)),
      findPhoto: jest
        .fn()
        .mockImplementation((_theaterId: number, id: number) =>
          Promise.resolve(gallery.find((row) => row.id === id)),
        ),
      reorder: jest.fn().mockImplementation(() => Promise.resolve()),
      updateCaption: jest.fn().mockImplementation(() => Promise.resolve()),
      delete: jest.fn().mockImplementation(() => Promise.resolve()),
    };
    media = { upload: jest.fn(), delete: jest.fn().mockImplementation(() => Promise.resolve()) };
    audit = { record: jest.fn().mockImplementation(() => Promise.resolve(1)) };
    const theaters = {
      lockForWrite: jest.fn().mockImplementation(() => Promise.resolve({ id: 1 })),
      touch: jest.fn().mockImplementation(() => Promise.resolve()),
      view: jest.fn().mockImplementation(() => Promise.resolve({})),
    } as unknown as TheatersService;
    const theaterRows = {
      findById: jest.fn().mockImplementation(() => Promise.resolve({ id: 1 })),
    } as unknown as TheatersRepository;
    service = new TheaterPhotosService(
      photos as unknown as TheaterPhotosRepository,
      theaterRows,
      theaters,
      media as unknown as MediaService,
      { run: <T>(fn: () => Promise<T>) => fn() } as unknown as TransactionRepository,
      audit as unknown as AuditService,
      new TestClock(NOW),
    );
  });

  it('moves a photo to a new place and keeps the others in order', async () => {
    await service.update(ACTOR, 1, 14, { position: 1 });
    expect(photos.reorder).toHaveBeenCalledWith(1, [11, 14, 12, 13], NOW);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'theater_photo.updated', changedFields: ['position'] }),
    );
  });

  it('puts a photo moved past the end last', async () => {
    await service.update(ACTOR, 1, 11, { position: 19 });
    expect(photos.reorder).toHaveBeenCalledWith(1, [12, 13, 14, 11], NOW);
  });

  it('writes nothing when the photo is already in place with that caption', async () => {
    await service.update(ACTOR, 1, 12, { position: 1, caption: null });
    expect(photos.reorder).not.toHaveBeenCalled();
    expect(photos.updateCaption).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("is NOT_FOUND for another theater's photo", async () => {
    await expect(service.update(ACTOR, 1, 99, { caption: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('closes the gap a deleted photo leaves, and deletes its image', async () => {
    photos.photosOf.mockResolvedValueOnce(gallery.filter((row) => row.id !== 12));
    await service.delete(ACTOR, 1, 12);
    expect(photos.delete).toHaveBeenCalledWith(12);
    expect(media.delete).toHaveBeenCalledWith(112);
    expect(photos.reorder).toHaveBeenCalledWith(1, [11, 13, 14], NOW);
  });

  it('refuses a 21st gallery photo before any image work', async () => {
    gallery = Array.from({ length: 20 }, (_, index) => photo(index + 1, index));
    const refusal = service.upload(
      {
        theaterId: 1,
        usage: 'gallery',
        caption: null,
        upload: {} as ImageUploadPayload,
        actor: ACTOR,
      },
      (view) => view,
    );
    await expect(refusal).rejects.toBeInstanceOf(AppError);
    await expect(refusal).rejects.toMatchObject({ code: 'CONFLICT', details: { limit: 20 } });
    expect(media.upload).not.toHaveBeenCalled();
  });
});
