import { createHash } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import { defer, map, type Observable, switchMap } from 'rxjs';
import { AppError } from '../../common/errors/app-error';
import { IDEMPOTENT_REPLAYED_HEADER } from '../../common/idempotency/idempotency.constants';
import { hashedPartsOf, hashRequest } from '../../common/idempotency/request-hash';
import { idempotencyKeyOf, scopeOf } from '../../common/idempotency/write.interceptor';
import { attachUploadPayload, isUploadOutcome } from './image-upload.context';
import { MAX_UPLOAD_BYTES, MULTER_LIMITS, UPLOAD_FILE_FIELD } from './media.constants';
import type { ImageUploadPayload } from './types';

/** One file of at most 10 MB, held in memory: it is processed at once and never kept. */
const receiveSingleFile = multer({ storage: multer.memoryStorage(), limits: MULTER_LIMITS }).single(
  UPLOAD_FILE_FIELD,
);

/** Fixed messages, so no part of the body or a client file name reaches the response. */
const MULTER_MESSAGES: Readonly<Record<string, string>> = {
  LIMIT_FILE_COUNT: 'Send exactly one file.',
  LIMIT_UNEXPECTED_FILE: `Send exactly one file, in the "${UPLOAD_FILE_FIELD}" field.`,
  LIMIT_PART_COUNT: 'The upload has too many parts.',
  LIMIT_FIELD_COUNT: 'The upload has too many fields.',
  LIMIT_FIELD_KEY: 'A field name is too long.',
  LIMIT_FIELD_VALUE: 'A field value is too long.',
  MISSING_FIELD_NAME: 'A field has no name.',
};

/**
 * Receives the file of an upload route (`@ImageUpload()`), after the guards and the write
 * interceptor's key check have run, so nothing is read for a refused request:
 *
 * 1. Multer reads one file of at most 10 MB into memory; too large is `413 IMAGE_TOO_LARGE`; no
 *    file, a second file, another field or a malformed body is `400 VALIDATION_FAILED`.
 * 2. The payload for `@UploadedImage()`: the bytes, their SHA-256 and, when an
 *    `Idempotency-Key` was sent, the key with its scope and a request hash that covers the file.
 * 3. When the handler returns `MediaService.upload()`'s outcome, answers its status (a replay's
 *    stored status, with `Idempotent-Replayed: true`) and its body.
 *
 * It injects nothing, so any module's route can use it.
 */
@Injectable()
export class ImageUploadInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    return defer(() => receive(request, response)).pipe(
      switchMap((payload) => {
        attachUploadPayload(request, payload);
        return next.handle();
      }),
      map((result: unknown) => {
        if (!isUploadOutcome(result)) return result;
        response.status(result.status);
        if (result.replayed) response.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
        return result.body;
      }),
    );
  }
}

async function receive(request: Request, response: Response): Promise<ImageUploadPayload> {
  await new Promise<void>((resolve, reject) => {
    receiveSingleFile(request, response, (error?: unknown) =>
      error === undefined ? resolve() : reject(toUploadError(error)),
    );
  });
  const { file } = request;
  if (!file || file.fieldname !== UPLOAD_FILE_FIELD) {
    throw invalidUpload(`Send one JPG or PNG file in the "${UPLOAD_FILE_FIELD}" field.`);
  }

  const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');
  const key = idempotencyKeyOf(request, false);
  return {
    buffer: file.buffer,
    byteSize: file.size,
    fileSha256,
    successStatus: response.statusCode,
    ...(key === undefined
      ? {}
      : {
          idempotency: {
            scope: scopeOf(request.principal),
            key,
            requestHash: hashRequest({
              ...hashedPartsOf(request),
              // The text fields alone would let one key replay a different file.
              body: { fields: { ...(request.body as Record<string, unknown>) }, fileSha256 },
            }),
          },
        }),
  };
}

/** Multer's and the multipart parser's failures, as API errors. */
export function toUploadError(error: unknown): AppError {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new AppError('IMAGE_TOO_LARGE', undefined, { maxBytes: MAX_UPLOAD_BYTES });
    }
    return invalidUpload(MULTER_MESSAGES[error.code] ?? 'The upload could not be read.');
  }
  // busboy's errors (no boundary, malformed part, cut-off body): the message may quote the body.
  return invalidUpload('The upload could not be read; send it as multipart/form-data.');
}

function invalidUpload(message: string): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fields: [{ field: UPLOAD_FILE_FIELD, messages: [message] }],
  });
}
