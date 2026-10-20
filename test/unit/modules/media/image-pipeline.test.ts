import sharp from 'sharp';
import { AppError } from '../../../../src/common/errors/app-error';
import { ImagePipeline } from '../../../../src/modules/media/image-pipeline';
import type { ImageKind, ProcessedImage } from '../../../../src/modules/media/types';
import {
  jpeg,
  orientedJpegWithMetadata,
  png,
  textFile,
  truncatedJpeg,
} from '../../../support/media-fixtures';

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the pipeline to refuse the upload');
}

function sizes(image: ProcessedImage): string[] {
  return image.variants.map(({ name, width, height }) => `${name} ${width}x${height}`);
}

/** The colour of one pixel of a WebP, as [r, g, b]. */
async function pixel(webp: Buffer, left: number, top: number): Promise<number[]> {
  const raw = await sharp(webp).extract({ left, top, width: 1, height: 1 }).raw().toBuffer();
  return [...raw.subarray(0, 3)];
}

/** Which of red, green or blue a lossy-encoded flat colour clearly is. */
function dominant([red = 0, green = 0, blue = 0]: number[]): string {
  if (red > 200 && green < 60 && blue < 60) return 'red';
  if (blue > 200 && red < 60 && green < 60) return 'blue';
  return `rgb(${red}, ${green}, ${blue})`;
}

describe('ImagePipeline (real sharp)', () => {
  const pipeline = new ImagePipeline();

  describe('refusals, cheapest check first', () => {
    it('refuses a text file renamed .jpg by its magic bytes', async () => {
      const error = await refusal(pipeline.process(textFile(), 'poster'));
      expect(error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
      expect(error.status).toBe(415);
      expect(error.details).toEqual({ allowed: ['jpeg', 'png'] });
    });

    it('refuses a 42-megapixel PNG from its header alone, without decoding it', async () => {
      const huge = await png(7000, 6000);
      expect(huge.length).toBeLessThan(10 * 1024 * 1024);
      const decode = jest.spyOn(sharp.prototype, 'toBuffer');

      const error = await refusal(pipeline.process(huge, 'gallery'));

      expect(error.code).toBe('IMAGE_TOO_MANY_PIXELS');
      expect(error.status).toBe(422);
      expect(error.details).toEqual({ maxPixels: 40_000_000, width: 7000, height: 6000 });
      expect(decode).not.toHaveBeenCalled();
    });

    it('accepts exactly 40 megapixels', async () => {
      const result = await pipeline.process(await png(8000, 5000), 'gallery');
      expect(result.sourceWidth * result.sourceHeight).toBe(40_000_000);
    });

    it('refuses a truncated JPEG as unsupported', async () => {
      const error = await refusal(pipeline.process(await truncatedJpeg(), 'poster'));
      expect(error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    });

    it('refuses a poster 5 % off 2:3 and a 599 × 599 person photo', async () => {
      const poster = await refusal(pipeline.process(await jpeg(1050, 1500), 'poster'));
      expect(poster.code).toBe('IMAGE_WRONG_SHAPE');
      expect(poster.details).toEqual(expect.objectContaining({ width: 1050, height: 1500 }));
      const person = await refusal(pipeline.process(await png(599, 599), 'person'));
      expect(person.code).toBe('IMAGE_WRONG_SHAPE');
    });
  });

  describe('variants', () => {
    it.each<[ImageKind, number, number, string[]]>([
      ['poster', 1000, 1500, ['small 200x300', 'medium 400x600', 'large 800x1200']],
      ['person', 600, 600, ['small 150x150', 'medium 300x300', 'large 600x600']],
      ['gallery', 3000, 1000, ['small 480x160', 'medium 1024x341', 'large 1920x640']],
      ['gallery', 900, 1600, ['small 270x480', 'medium 576x1024', 'large 900x1600']],
      // A 4:3 cover is cropped to 1600 × 900, and never enlarged to 1920 × 1080.
      ['backdrop', 1600, 1200, ['small 640x360', 'medium 1280x720', 'large 1600x900']],
      ['backdrop', 3840, 2160, ['small 640x360', 'medium 1280x720', 'large 1920x1080']],
    ])('makes the %s variants of a %i × %i upload', async (kind, width, height, expected) => {
      const result = await pipeline.process(await jpeg(width, height), kind);
      expect(result.kind).toBe(kind);
      expect(result.sourceWidth).toBe(width);
      expect(result.sourceHeight).toBe(height);
      expect(sizes(result)).toEqual(expected);
    });

    it('never upscales a small upload: a 400 × 600 poster gives 200, 400 and 400 wide', async () => {
      const result = await pipeline.process(await png(400, 600), 'poster');
      expect(sizes(result)).toEqual(['small 200x300', 'medium 400x600', 'large 400x600']);
    });

    it('centre-crops a poster 1 % off to exactly 2:3', async () => {
      const result = await pipeline.process(await jpeg(1010, 1500), 'poster');
      expect(sizes(result)).toEqual(['small 200x300', 'medium 400x600', 'large 800x1200']);
    });

    it('writes WebP files whose reported sizes match their real ones', async () => {
      const result = await pipeline.process(await png(1000, 1500), 'poster');
      for (const variant of result.variants) {
        const metadata = await sharp(variant.data).metadata();
        expect(metadata.format).toBe('webp');
        expect([metadata.width, metadata.height]).toEqual([variant.width, variant.height]);
      }
    });
  });

  describe('orientation and metadata', () => {
    it('rotates by EXIF orientation and strips EXIF (GPS included), XMP and ICC', async () => {
      // Stored 1500 × 1000 with orientation 6: displayed 1000 × 1500, a valid 2:3 poster.
      const upload = await orientedJpegWithMetadata(1500, 1000);
      const before = await sharp(upload).metadata();
      expect(before.orientation).toBe(6);
      expect(before.exif).toBeDefined();
      expect(before.icc).toBeDefined();

      const result = await pipeline.process(upload, 'poster');

      expect([result.sourceWidth, result.sourceHeight]).toEqual([1000, 1500]);
      const large = result.variants.find((variant) => variant.name === 'large')!;
      expect([large.width, large.height]).toEqual([800, 1200]);
      // The red left quarter of the stored image is now at the top.
      expect(dominant(await pixel(large.data, 400, 20))).toBe('red');
      expect(dominant(await pixel(large.data, 400, 1180))).toBe('blue');
      for (const variant of result.variants) {
        const metadata = await sharp(variant.data).metadata();
        expect(metadata.exif).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(metadata.orientation).toBeUndefined();
        expect(variant.data.includes(Buffer.from('Maqady test'))).toBe(false);
      }
    });
  });

  describe('one job at a time', () => {
    it('runs concurrent uploads one after the other, in arrival order, even after a failure', async () => {
      const queued = new ImagePipeline();
      const events: string[] = [];
      const run = jest
        .spyOn(queued as unknown as { run: (b: Buffer, k: ImageKind) => Promise<unknown> }, 'run')
        .mockImplementation(async (buffer: Buffer) => {
          const name = buffer.toString();
          events.push(`start ${name}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          events.push(`end ${name}`);
          if (name === 'first') throw new AppError('UNSUPPORTED_IMAGE_TYPE');
          return {};
        });

      const results = await Promise.allSettled([
        queued.process(Buffer.from('first'), 'poster'),
        queued.process(Buffer.from('second'), 'poster'),
        queued.process(Buffer.from('third'), 'poster'),
      ]);

      expect(run).toHaveBeenCalledTimes(3);
      expect(events).toEqual([
        'start first',
        'end first',
        'start second',
        'end second',
        'start third',
        'end third',
      ]);
      expect(results.map((result) => result.status)).toEqual([
        'rejected',
        'fulfilled',
        'fulfilled',
      ]);
    });
  });
});
