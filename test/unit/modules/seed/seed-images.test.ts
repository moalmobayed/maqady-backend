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

  describe('when the host answers too many requests or a server error', () => {
    function responses(...answers: Response[]): void {
      const spy = jest.spyOn(globalThis, 'fetch');
      for (const response of answers) spy.mockResolvedValueOnce(response);
    }
    const busy = (status: number, retryAfter?: string): Response =>
      new Response('busy', {
        status,
        headers: {
          'content-type': 'text/html',
          ...(retryAfter ? { 'retry-after': retryAfter } : {}),
        },
      });

    it('asks again after the Retry-After the host gave, then crops the picture', async () => {
      const picture = await placeholderImage(400, 300, '#1f4e79', 'a mall');
      responses(
        busy(429, '2'),
        new Response(picture, { headers: { 'content-type': 'image/jpeg' } }),
      );
      const wait = jest.fn().mockResolvedValue(undefined);

      const image = await downloadedImage('https://example.com/mall.jpg', 1600, 1067, wait);

      expect(await sharp(image).metadata()).toMatchObject({ width: 1600, height: 1067 });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(wait.mock.calls).toEqual([[2000]]);
    });

    it('waits longer each time without a Retry-After, capped at 30 seconds, then gives up', async () => {
      responses(busy(503), busy(503), busy(429, '120'), busy(503));
      const wait = jest.fn().mockResolvedValue(undefined);

      await expect(downloadedImage('https://example.com/mall.jpg', 800, 800, wait)).rejects.toThrow(
        'Seed: the picture https://example.com/mall.jpg answered 503 text/html',
      );
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(wait.mock.calls).toEqual([[5000], [10000], [30000]]);
    });

    it('does not ask again after a 404', async () => {
      responses(busy(404));
      const wait = jest.fn().mockResolvedValue(undefined);

      await expect(downloadedImage('https://example.com/a.jpg', 800, 800, wait)).rejects.toThrow(
        'answered 404',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    });
  });
});
