import { Injectable } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import { AppError } from '../../common/errors/app-error';
import { DETECTED_IMAGE_TYPES } from './enums';
import { planCrop } from './image-shape';
import { detectImageType } from './image-type';
import { KIND_RULES, MAX_INPUT_PIXELS, WEBP_OPTIONS } from './media.constants';
import type { CropRegion, ImageKind, ProcessedImage, ProcessedVariant, VariantSpec } from './types';

/**
 * Turns one uploaded file into the WebP variants of its kind (design §9 steps 2–3), cheapest
 * check first:
 *
 * 1. the magic bytes: JPEG or PNG, else `UNSUPPORTED_IMAGE_TYPE`;
 * 2. the size from the header alone: above 40 megapixels is `IMAGE_TOO_MANY_PIXELS`, never
 *    decoded;
 * 3. the shape of the EXIF-oriented picture (`planCrop`): `IMAGE_WRONG_SHAPE`;
 * 4. per variant: decode, rotate by EXIF, crop, resize (never up), encode WebP. sharp writes no
 *    metadata unless asked, so EXIF (location included), XMP and ICC are stripped, and colours
 *    are converted to sRGB. A file sharp can't decode is `UNSUPPORTED_IMAGE_TYPE`.
 *
 * Jobs run one at a time, in arrival order, and sharp itself uses one thread with its cache off:
 * the free host has little memory and CPU (design §3). No database connection is held meanwhile.
 */
@Injectable()
export class ImagePipeline {
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    sharp.concurrency(1);
    sharp.cache(false);
  }

  process(buffer: Buffer, kind: ImageKind): Promise<ProcessedImage> {
    const job = this.queue.then(() => this.run(buffer, kind));
    // The next job waits for this one, whether it succeeds or fails.
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async run(buffer: Buffer, kind: ImageKind): Promise<ProcessedImage> {
    if (detectImageType(buffer) === null) throw unsupported();

    const metadata = await readHeader(buffer);
    const { width, height } = orientedSize(metadata);
    if (width * height > MAX_INPUT_PIXELS) {
      throw new AppError('IMAGE_TOO_MANY_PIXELS', undefined, {
        maxPixels: MAX_INPUT_PIXELS,
        width,
        height,
      });
    }
    const crop = planCrop(kind, width, height);

    const variants: ProcessedVariant[] = [];
    for (const spec of KIND_RULES[kind].variants) {
      variants.push(await renderVariant(buffer, crop, spec, kind));
    }
    return { kind, sourceWidth: width, sourceHeight: height, variants };
  }
}

async function readHeader(buffer: Buffer): Promise<Metadata> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) throw unsupported();
    return metadata;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unsupported(error);
  }
}

/** The size as displayed: EXIF orientations 5–8 swap width and height. */
function orientedSize(metadata: Metadata): { width: number; height: number } {
  if (metadata.autoOrient) return metadata.autoOrient;
  const swapped = (metadata.orientation ?? 1) >= 5;
  return swapped
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

async function renderVariant(
  buffer: Buffer,
  crop: CropRegion,
  spec: VariantSpec,
  kind: ImageKind,
): Promise<ProcessedVariant> {
  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .extract(crop)
      .resize(spec.maxWidth, spec.maxHeight, {
        // The crop already has the kind's exact ratio; a gallery photo keeps its own.
        fit: KIND_RULES[kind].aspect === null ? 'inside' : 'cover',
        withoutEnlargement: true,
      })
      .webp(WEBP_OPTIONS)
      .toBuffer({ resolveWithObject: true });
    return { name: spec.name, data, width: info.width, height: info.height };
  } catch (error) {
    throw unsupported(error);
  }
}

function unsupported(cause?: unknown): AppError {
  return new AppError(
    'UNSUPPORTED_IMAGE_TYPE',
    undefined,
    { allowed: [...DETECTED_IMAGE_TYPES] },
    cause === undefined ? {} : { cause },
  );
}
