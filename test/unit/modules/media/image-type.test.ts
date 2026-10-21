import { detectImageType } from '../../../../src/modules/media/image-type';
import { jpeg, png, textFile } from '../../../support/media-fixtures';

describe('detectImageType', () => {
  it('recognises a JPEG and a PNG by their first bytes', async () => {
    expect(detectImageType(await jpeg(10, 10))).toBe('jpeg');
    expect(detectImageType(await png(10, 10))).toBe('png');
  });

  it.each([
    ['a text file renamed .jpg', textFile()],
    ['a GIF', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')],
    ['a WebP', Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1')],
    ['an empty buffer', Buffer.alloc(0)],
    ['two bytes of a JPEG signature', Buffer.from([0xff, 0xd8])],
    ['seven bytes of a PNG signature', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a])],
  ])('refuses %s', (_label, buffer) => {
    expect(detectImageType(buffer)).toBeNull();
  });
});
