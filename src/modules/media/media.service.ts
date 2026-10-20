import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { isRetryableTransactionError } from '../../common/database/postgres-errors';
import { TransactionContext } from '../../common/database/transaction-context';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { Clock } from '../../common/time/clock';
import type { ImageResponse } from './dto/image.response';
import { IMAGE_VARIANT_NAMES } from './enums';
import { ImagePipeline } from './image-pipeline';
import { uploadOutcome } from './image-upload.context';
import { ImagesRepository } from './images.repository';
import { MAX_UPLOAD_TRANSACTION_ATTEMPTS } from './media.constants';
import { StorageAdapter } from './storage/storage.adapter';
import type {
  ImageRow,
  ProcessedImage,
  StoredImage,
  StoredImageVariants,
  StoredVariant,
  UploadImageInput,
  UploadOutcome,
} from './types';

/**
 * Images for the modules that show them (design §9): theaters (U4b), catalog (U6) and discovery
 * (U8). Exported by `MediaModule`; this unit has no routes of its own.
 *
 * - `upload()` is called from an `@ImageUpload()` route: process the file, store its variants,
 *   then one short transaction for the `images` row, the owner's link and the idempotency key.
 * - `findByIds()` and `toImageResponse()` build the `Image` of every response that shows one.
 * - `delete()` and `deleteMany()` remove rows now and their files once the caller commits.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly pipeline: ImagePipeline,
    private readonly storage: StorageAdapter,
    private readonly images: ImagesRepository,
    private readonly transactions: TransactionRepository,
    private readonly context: TransactionContext,
    private readonly idempotency: IdempotencyService,
    private readonly clock: Clock,
  ) {}

  /**
   * Turns the uploaded file into an image of `kind` and lets the owner link it (design §9):
   *
   * 1. the pipeline checks and converts the file, outside any transaction;
   * 2. the variants are stored under a new prefix `<kind>/<uuid>`;
   * 3. one short transaction claims the `Idempotency-Key` (if sent), inserts the `images` row,
   *    awaits `link(image)` and stores the response under the key; a deadlock retries it once;
   * 4. if that transaction fails, its files are deleted and the error is rethrown. A replay of an
   *    earlier identical request deletes this attempt's files and answers the stored response.
   *
   * Files `link()` schedules for deletion (a replaced image) go once the transaction commits.
   */
  async upload<T>(input: UploadImageInput<T>): Promise<UploadOutcome<T>> {
    if (this.context.isActive()) {
      // Its files could not be deleted if an enclosing transaction rolled back later.
      throw new AppError('INTERNAL', 'An image upload must not run inside a transaction.');
    }
    const processed = await this.pipeline.process(input.upload.buffer, input.kind);
    const prefix = `${input.kind}/${randomUUID()}`;
    const variants = await this.store(prefix, processed);
    const paths = pathsOf(variants);

    try {
      const outcome = await this.record(input, processed, prefix, variants);
      if (outcome.replayed) await this.removeQuietly(paths);
      return outcome;
    } catch (error) {
      await this.removeQuietly(paths);
      throw error;
    }
  }

  /** The images with these ids, in one query; ids without a row are absent from the map. */
  async findByIds(ids: readonly number[]): Promise<ReadonlyMap<number, StoredImage>> {
    const rows = await this.images.findByIds([...new Set(ids)]);
    return new Map(rows.map((row) => [row.id, storedImageOf(row)]));
  }

  /** Deletes the image now; its files go once the current transaction commits. */
  async delete(id: number): Promise<void> {
    await this.deleteMany([id]);
  }

  /**
   * Deletes the images in one statement; their files go once the current transaction commits,
   * and stay when it rolls back. An image still linked by an owner's foreign key fails the
   * statement, and so the caller's transaction.
   */
  async deleteMany(ids: readonly number[]): Promise<void> {
    const rows = await this.images.deleteByIds([...new Set(ids)]);
    const paths = rows.flatMap((row) => pathsOf(row.variants));
    if (paths.length === 0) return;
    await this.transactions.afterCommit(() => this.removeQuietly(paths));
  }

  /**
   * The `Image` of an API response (home-page contract): every variant smallest first with its
   * public URL, or null when there is no image. `alt` comes from the owner (a movie title, a
   * person's name, a caption).
   */
  toImageResponse(image: StoredImage | undefined, alt: string | null): ImageResponse | null {
    if (!image) return null;
    return {
      alt,
      variants: IMAGE_VARIANT_NAMES.map((name) => {
        const variant = image.variants[name];
        return {
          name,
          url: this.storage.publicUrl(variant.path),
          width: variant.width,
          height: variant.height,
        };
      }),
    };
  }

  /** Stores every variant; a failure part-way removes those already stored. */
  private async store(prefix: string, processed: ProcessedImage): Promise<StoredImageVariants> {
    const stored: Partial<Record<string, StoredVariant>> = {};
    try {
      for (const variant of processed.variants) {
        const path = `${prefix}/${variant.name}.webp`;
        await this.storage.put({ path, body: variant.data, contentType: 'image/webp' });
        stored[variant.name] = {
          path,
          width: variant.width,
          height: variant.height,
          bytes: variant.data.length,
        };
      }
    } catch (error) {
      await this.removeQuietly(processed.variants.map(({ name }) => `${prefix}/${name}.webp`));
      throw error;
    }
    return stored as StoredImageVariants;
  }

  private async record<T>(
    input: UploadImageInput<T>,
    processed: ProcessedImage,
    prefix: string,
    variants: StoredImageVariants,
  ): Promise<UploadOutcome<T>> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.transactions.run(() =>
          this.recordOnce(input, processed, prefix, variants),
        );
      } catch (error) {
        if (attempt < MAX_UPLOAD_TRANSACTION_ATTEMPTS && isRetryableTransactionError(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  private async recordOnce<T>(
    input: UploadImageInput<T>,
    processed: ProcessedImage,
    prefix: string,
    variants: StoredImageVariants,
  ): Promise<UploadOutcome<T>> {
    const { idempotency, successStatus } = input.upload;
    let claimId: number | undefined;
    if (idempotency) {
      const claim = await this.idempotency.claim(idempotency);
      if (claim.kind === 'replay') return uploadOutcome(claim.status, claim.body as T, true);
      claimId = claim.id;
    }

    const row = await this.images.insert({
      kind: input.kind,
      storage_prefix: prefix,
      variants,
      source_width: processed.sourceWidth,
      source_height: processed.sourceHeight,
      created_by_staff_id: input.actor.id,
      created_at: this.clock.now(),
    });
    const body = await input.link(storedImageOf(row));
    if (idempotency && claimId !== undefined) {
      await this.idempotency.complete(claimId, idempotency, successStatus, body);
    }
    return uploadOutcome(successStatus, body, false);
  }

  /** Deletes files, logging rather than throwing: `npm run media:orphans` tidies what is left. */
  private async removeQuietly(paths: readonly string[]): Promise<void> {
    try {
      await this.storage.remove(paths);
    } catch (error) {
      this.logger.error(
        { err: error, paths },
        'Image files could not be deleted; npm run media:orphans will remove them',
      );
    }
  }
}

function pathsOf(variants: StoredImageVariants): string[] {
  return IMAGE_VARIANT_NAMES.map((name) => variants[name].path);
}

function storedImageOf(row: ImageRow): StoredImage {
  return {
    id: row.id,
    kind: row.kind,
    storagePrefix: row.storage_prefix,
    variants: row.variants,
    sourceWidth: row.source_width,
    sourceHeight: row.source_height,
    createdByStaffId: row.created_by_staff_id,
    createdAt: row.created_at,
  };
}
