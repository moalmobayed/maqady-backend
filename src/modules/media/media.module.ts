import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.constants';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { ImagePipeline } from './image-pipeline';
import { ImagesRepository } from './images.repository';
import { MediaOrphansService } from './media-orphans.service';
import { MediaService } from './media.service';
import { createStorageAdapter } from './storage/storage.factory';
import { StorageAdapter } from './storage/storage.adapter';

/**
 * Images and their storage (design §5, §9). Owners of upload routes (theaters, catalog) import
 * it and call `MediaService`; their routes use `@ImageUpload()` and `@UploadedImage()` from
 * `image-upload.decorators.ts`, and their responses `ImageResponse`. No routes of its own.
 */
@Module({
  imports: [IdempotencyModule],
  providers: [
    ImagesRepository,
    ImagePipeline,
    { provide: StorageAdapter, inject: [APP_CONFIG], useFactory: createStorageAdapter },
    MediaService,
    MediaOrphansService,
  ],
  exports: [MediaService],
})
export class MediaModule {}
