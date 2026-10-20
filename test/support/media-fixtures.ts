import { crc32, deflateSync } from 'node:zlib';
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

/**
 * A PNG whose header claims `width` × `height` but whose pixel data is a few bytes: what a
 * decompression bomb or a giant panorama looks like before decoding. Built byte by byte, since
 * sharp refuses to create an image this large.
 */
export function pngHeader(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(16))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
