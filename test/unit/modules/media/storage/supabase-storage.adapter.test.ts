import { AppError } from '../../../../../src/common/errors/app-error';
import { serializeError } from '../../../../../src/common/logging/error-serializer';
import { SupabaseStorageAdapter } from '../../../../../src/modules/media/storage/supabase-storage.adapter';

const SERVICE_KEY = 'service-role-key-0123456789-abcdefghij';
const adapter = new SupabaseStorageAdapter({
  driver: 'supabase',
  supabaseUrl: 'https://abcd.supabase.co',
  serviceRoleKey: SERVICE_KEY,
  bucket: 'media',
});

const PATH = 'poster/0f1e2d3c-4b5a-4968-8776-655443322110/small.webp';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(...responses: (Response | Error)[]): jest.SpyInstance {
  const spy = jest.spyOn(global, 'fetch');
  for (const response of responses) {
    if (response instanceof Error) spy.mockRejectedValueOnce(response);
    else spy.mockResolvedValueOnce(response);
  }
  return spy;
}

/** The URL, method, headers and body of the n-th fetch call. */
function call(spy: jest.SpyInstance, index = 0) {
  const [url, init] = spy.mock.calls[index] as [string, RequestInit];
  return {
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body,
    signal: init.signal,
  };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a storage error');
}

describe('SupabaseStorageAdapter', () => {
  describe('put', () => {
    it('uploads to /object/<bucket>/<path> with the key, WebP type, a year of caching and no upsert', async () => {
      const spy = mockFetch(json({ Key: `media/${PATH}` }));
      const body = Buffer.from('webp bytes');

      await adapter.put({ path: PATH, body, contentType: 'image/webp' });

      const request = call(spy);
      expect(request.url).toBe(`https://abcd.supabase.co/storage/v1/object/media/${PATH}`);
      expect(request.method).toBe('POST');
      expect(request.headers).toEqual({
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'x-upsert': 'false',
      });
      expect(request.body).toBe(body);
      expect(request.signal).toBeInstanceOf(AbortSignal);
    });

    it('refuses a malformed path without calling Supabase', async () => {
      const spy = mockFetch();
      for (const path of [
        '../secrets/key.webp',
        '/poster/a.webp',
        'poster//a.webp',
        'Poster/A.webp',
      ]) {
        const error = await failure(
          adapter.put({ path, body: Buffer.alloc(1), contentType: 'image/webp' }),
        );
        expect(error.code).toBe('INTERNAL');
      }
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes by prefixes in one JSON request', async () => {
      const spy = mockFetch(json([]));
      await adapter.remove([PATH, PATH.replace('small', 'large')]);

      const request = call(spy);
      expect(request.url).toBe('https://abcd.supabase.co/storage/v1/object/media');
      expect(request.method).toBe('DELETE');
      expect(request.headers).toEqual(
        expect.objectContaining({
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': 'application/json',
        }),
      );
      expect(JSON.parse(request.body as string)).toEqual({
        prefixes: [PATH, PATH.replace('small', 'large')],
      });
    });

    it('sends 2,500 paths in batches of 1,000', async () => {
      const spy = mockFetch(json([]), json([]), json([]));
      const paths = Array.from({ length: 2500 }, (_, index) => `gallery/x/${index}.webp`);
      await adapter.remove(paths);

      expect(spy).toHaveBeenCalledTimes(3);
      const batches = [0, 1, 2].map(
        (index) => (JSON.parse(call(spy, index).body as string) as { prefixes: string[] }).prefixes,
      );
      expect(batches.map((batch) => batch.length)).toEqual([1000, 1000, 500]);
      expect(batches.flat()).toEqual(paths);
    });

    it('makes no request for no paths', async () => {
      const spy = mockFetch();
      await adapter.remove([]);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('pages through a folder and recurses into sub-folders (id null)', async () => {
      const page = Array.from({ length: 1000 }, (_, index) => ({
        name: `f${String(index).padStart(4, '0')}.webp`,
        id: `id-${index}`,
        updated_at: '2026-10-20T08:00:00.000Z',
        metadata: { size: 10 },
      }));
      const spy = mockFetch(
        json([{ name: 'poster', id: null }]),
        json(page),
        json([{ name: 'z.webp', id: 'z', updated_at: '2026-10-20T09:00:00.000Z', metadata: {} }]),
      );

      const entries = await adapter.list('');

      expect(spy).toHaveBeenCalledTimes(3);
      expect(call(spy, 0).url).toBe('https://abcd.supabase.co/storage/v1/object/list/media');
      expect(call(spy, 0).method).toBe('POST');
      expect(JSON.parse(call(spy, 0).body as string)).toEqual({
        prefix: '',
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      });
      expect(JSON.parse(call(spy, 1).body as string)).toEqual(
        expect.objectContaining({ prefix: 'poster', offset: 0 }),
      );
      expect(JSON.parse(call(spy, 2).body as string)).toEqual(
        expect.objectContaining({ prefix: 'poster', offset: 1000 }),
      );
      expect(entries).toHaveLength(1001);
      expect(entries[0]).toEqual({
        path: 'poster/f0000.webp',
        updatedAt: new Date('2026-10-20T08:00:00.000Z'),
        bytes: 10,
      });
      expect(entries[1000]).toEqual({
        path: 'poster/z.webp',
        updatedAt: new Date('2026-10-20T09:00:00.000Z'),
        bytes: null,
      });
    });

    it('treats an answer that is not an array as a bug', async () => {
      mockFetch(json({ message: 'unexpected' }));
      expect((await failure(adapter.list('poster'))).code).toBe('INTERNAL');
    });
  });

  it('builds public URLs without a request', () => {
    const spy = mockFetch();
    expect(adapter.publicUrl(PATH)).toBe(
      `https://abcd.supabase.co/storage/v1/object/public/media/${PATH}`,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  describe('errors', () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const refused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });

    it.each<[string, Response | Error]>([
      ['a network failure', refused],
      ['the 15-second timeout', timeout],
      ['429', json({ error: 'too many' }, 429)],
      ['500', json({ error: 'boom' }, 500)],
      ['503', json({ error: 'down' }, 503)],
    ])('answers %s with STORAGE_UNAVAILABLE', async (_label, response) => {
      mockFetch(response);
      const error = await failure(
        adapter.put({ path: PATH, body: Buffer.alloc(1), contentType: 'image/webp' }),
      );
      expect(error.code).toBe('STORAGE_UNAVAILABLE');
      expect(error.status).toBe(503);
      expectNoKey(error);
    });

    it.each([400, 401, 403, 404])(
      'answers %i with INTERNAL: our key or bucket is wrong',
      async (status) => {
        mockFetch(
          json({ statusCode: String(status), error: 'Unauthorized', message: SERVICE_KEY }, status),
        );
        const error = await failure(adapter.remove([PATH]));
        expect(error.code).toBe('INTERNAL');
        expect((error.cause as Error).message).toBe(`Supabase Storage remove answered ${status}`);
        expectNoKey(error);
      },
    );

    it('names the kind of network failure in the cause', async () => {
      mockFetch(refused);
      const error = await failure(adapter.remove([PATH]));
      expect((error.cause as Error).message).toBe(
        'Supabase Storage remove got no answer (TypeError ECONNREFUSED)',
      );
    });
  });
});

/** The service key appears nowhere in the error, its details, its cause or its log form. */
function expectNoKey(error: AppError): void {
  const everything = JSON.stringify({
    message: error.message,
    details: error.details,
    logged: serializeError(error),
  });
  expect(everything).not.toContain(SERVICE_KEY);
}
