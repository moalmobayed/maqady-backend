import sharp from 'sharp';

/**
 * Images generated with real sharp for the media tests; no binary fixture is committed. Each is
 * a flat colour, so files stay small even at 40+ megapixels.
 */

export function jpeg(width: number, height: number, colour = '#3a6ea5'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();
}

export function png(width: number, height: number, colour = '#3a6ea5'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer();
}

/**
 * A JPEG stored `width` × `height` with EXIF orientation 6 (displayed rotated 90° clockwise, so
 * `height` × `width`), a GPS position, a copyright line and an ICC profile. Its left quarter is
 * red, which ends up at the top once the orientation is applied.
 */
export async function orientedJpegWithMetadata(width: number, height: number): Promise<Buffer> {
  const red = await sharp({
    create: { width: Math.round(width / 4), height, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#0000ff' } })
    .composite([{ input: red, left: 0, top: 0 }])
    .jpeg()
    .withIccProfile('p3')
    .withExif({
      IFD0: { Copyright: 'Maqady test', Artist: 'A Photographer' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '30/1 2/1 0/1' },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** A file that is not an image at all, whatever its name says. */
export function textFile(): Buffer {
  return Buffer.from('This is a text file renamed to poster.jpg\n'.repeat(20), 'utf8');
}

/** The first half of a real JPEG: it passes the magic-byte check but can't be decoded. */
export async function truncatedJpeg(): Promise<Buffer> {
  const whole = await jpeg(800, 1200);
  return whole.subarray(0, Math.floor(whole.length / 2));
}
