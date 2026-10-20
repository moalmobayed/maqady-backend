import { Readable } from 'node:stream';
import type { CallHandler } from '@nestjs/common';
import multer from 'multer';
import { lastValueFrom, of } from 'rxjs';
import { AppError } from '../../../../src/common/errors/app-error';
import { uploadOutcome, uploadPayloadOf } from '../../../../src/modules/media/image-upload.context';
import {
  ImageUploadInterceptor,
  toUploadError,
} from '../../../../src/modules/media/image-upload.interceptor';
import type { ImageUploadPayload } from '../../../../src/modules/media/types';
import { fakeContext } from '../../../support/execution-context';

const BOUNDARY = 'maqady-test-boundary';

type FakeRequest = Readable & { body?: unknown };

interface Part {
  readonly name: string;
  readonly value: string | Buffer;
  readonly filename?: string;
}

function multipartBody(parts: readonly Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    const type = part.filename ? 'Content-Type: image/jpeg\r\n' : '';
    chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n${type}\r\n`));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

/** An Express-like request whose body streams the given bytes. */
function request(body: Buffer, headers: Record<string, string> = {}): FakeRequest {
  return Object.assign(Readable.from([body]), {
    method: 'POST',
    url: '/api/v1/admin/movies/3/photos',
    params: { id: '3' },
    route: { path: '/api/v1/admin/movies/:id/photos' },
    principal: { kind: 'staff', id: 7, sessionId: 70, role: 'admin' },
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': String(body.length),
      ...headers,
    },
  });
}

function response(statusCode = 201) {
  const headers: Record<string, string> = {};
  return {
    statusCode,
    headers,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };
}

async function intercept(
  req: FakeRequest,
  res = response(),
  handlerResult: unknown = { handled: true },
): Promise<{ result: unknown; payload: ImageUploadPayload | undefined }> {
  const next: CallHandler = { handle: () => of(handlerResult) };
  const result = await lastValueFrom(
    new ImageUploadInterceptor().intercept(fakeContext({ request: req, response: res }), next),
  );
  return { result, payload: uploadPayloadOf(req as never) };
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the upload to be refused');
}

const FILE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe('ImageUploadInterceptor', () => {
  it('reads the one file and hands its bytes, size, hash and route status to @UploadedImage()', async () => {
    const req = request(
      multipartBody([
        { name: 'caption', value: 'Opening night' },
        { name: 'file', value: FILE, filename: 'poster.jpg' },
      ]),
    );

    const { result, payload } = await intercept(req, response(201));

    expect(result).toEqual({ handled: true });
    expect(payload).toEqual({
      buffer: FILE,
      byteSize: FILE.length,
      fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      successStatus: 201,
    });
    expect(req.body).toEqual({ caption: 'Opening night' });
  });

  it('scopes the key to the staff member and hashes the file with the text fields', async () => {
    const send = async (file: Buffer, caption: string) =>
      (
        await intercept(
          request(
            multipartBody([
              { name: 'caption', value: caption },
              { name: 'file', value: file, filename: 'a.jpg' },
            ]),
            { 'idempotency-key': 'key-1' },
          ),
        )
      ).payload!.idempotency!;

    const first = await send(FILE, 'Still');
    const same = await send(FILE, 'Still');
    const otherFile = await send(Buffer.concat([FILE, Buffer.from([9])]), 'Still');
    const otherCaption = await send(FILE, 'Behind the scenes');

    expect(first.scope).toBe('staff:7');
    expect(first.key).toBe('key-1');
    expect(same.requestHash).toBe(first.requestHash);
    expect(otherFile.requestHash).not.toBe(first.requestHash);
    expect(otherCaption.requestHash).not.toBe(first.requestHash);
  });

  it('answers an upload outcome with its status, and marks a replay', async () => {
    const res = response(201);
    const { result } = await intercept(
      request(multipartBody([{ name: 'file', value: FILE, filename: 'a.jpg' }])),
      res,
      uploadOutcome(200, { photoId: 3 }, true),
    );
    expect(result).toEqual({ photoId: 3 });
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({ 'Idempotent-Replayed': 'true' });
  });

  it('leaves the status alone for a first upload', async () => {
    const res = response(201);
    await intercept(
      request(multipartBody([{ name: 'file', value: FILE, filename: 'a.jpg' }])),
      res,
      uploadOutcome(201, { photoId: 3 }, false),
    );
    expect(res.statusCode).toBe(201);
    expect(res.headers).toEqual({});
  });

  it('refuses a file over 10 MB with IMAGE_TOO_LARGE', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0xff);
    const error = await refusal(
      intercept(request(multipartBody([{ name: 'file', value: big, filename: 'big.jpg' }]))),
    );
    expect(error.code).toBe('IMAGE_TOO_LARGE');
    expect(error.status).toBe(413);
    expect(error.details).toEqual({ maxBytes: 10485760 });
  });

  it.each<[string, Part[]]>([
    ['no file', [{ name: 'caption', value: 'x' }]],
    [
      'two files',
      [
        { name: 'file', value: FILE, filename: 'a.jpg' },
        { name: 'file', value: FILE, filename: 'b.jpg' },
      ],
    ],
    ['a file in another field', [{ name: 'photo', value: FILE, filename: 'a.jpg' }]],
  ])('refuses %s with VALIDATION_FAILED on "file"', async (_label, parts) => {
    const error = await refusal(intercept(request(multipartBody(parts))));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({
      fields: [{ field: 'file', messages: [expect.any(String)] }],
    });
  });

  it('refuses a body that is not multipart at all', async () => {
    const body = Buffer.from('{"file":"x"}');
    const error = await refusal(intercept(request(body, { 'content-type': 'application/json' })));
    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a cut-off multipart body without quoting it', async () => {
    const whole = multipartBody([{ name: 'file', value: FILE, filename: 'secret-name.jpg' }]);
    const cut = whole.subarray(0, whole.length - 30);
    const error = await refusal(intercept(request(cut)));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(error.details)).not.toContain('secret-name');
  });
});

describe('toUploadError', () => {
  it.each([
    ['LIMIT_FILE_SIZE', 'IMAGE_TOO_LARGE'],
    ['LIMIT_FILE_COUNT', 'VALIDATION_FAILED'],
    ['LIMIT_UNEXPECTED_FILE', 'VALIDATION_FAILED'],
    ['LIMIT_PART_COUNT', 'VALIDATION_FAILED'],
    ['LIMIT_FIELD_COUNT', 'VALIDATION_FAILED'],
    ['LIMIT_FIELD_KEY', 'VALIDATION_FAILED'],
    ['LIMIT_FIELD_VALUE', 'VALIDATION_FAILED'],
    ['MISSING_FIELD_NAME', 'VALIDATION_FAILED'],
  ] as const)('maps Multer %s to %s', (code, expected) => {
    expect(toUploadError(new multer.MulterError(code, 'file')).code).toBe(expected);
  });

  it('maps any other failure to VALIDATION_FAILED with a fixed message', () => {
    const error = toUploadError(new Error('Malformed part header near "private text"'));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(error.details)).not.toContain('private text');
  });
});
