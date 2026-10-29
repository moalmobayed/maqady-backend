import sharp from 'sharp';
import { downloadedImage, placeholderImage } from '../../../../src/modules/seed/seed-images';

describe('downloadedImage', () => {
  function answer(body: Buffer, type: string, status = 200): void {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(body, { status, headers: { 'content-type': type } }));
  }

  it('crops the downloaded picture to exactly the size asked for, as a JPEG', async () => {
    answer(await placeholderImage(500, 750, '#1f4e79', 'a portrait poster'), 'image/jpeg');

    const image = await downloadedImage('https://example.com/poster.jpg', 800, 1200);

    const { width, height, format } = await sharp(image).metadata();
    expect({ width, height, format }).toEqual({ width: 800, height: 1200, format: 'jpeg' });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/poster.jpg',
      expect.objectContaining({ headers: { 'User-Agent': expect.any(String) } }),
    );
  });

  it('refuses an answer that is not a picture', async () => {
    answer(Buffer.from('<html>moved</html>'), 'text/html');

    await expect(downloadedImage('https://example.com/a.jpg', 800, 800)).rejects.toThrow(
      'Seed: the picture https://example.com/a.jpg answered 200 text/html',
    );
  });

  it('refuses a failed download', async () => {
    answer(Buffer.from('gone'), 'image/jpeg', 404);

    await expect(downloadedImage('https://example.com/a.jpg', 800, 800)).rejects.toThrow(
      'answered 404',
    );
  });
});
