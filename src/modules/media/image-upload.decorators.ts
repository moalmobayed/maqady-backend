import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiExtraModels, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { NoRequestTransaction } from '../../common/idempotency/idempotency.decorators';
import { ApiErrorResponses } from '../../common/swagger/error-responses';
import { uploadPayloadOf } from './image-upload.context';
import { ImageUploadInterceptor } from './image-upload.interceptor';
import { UPLOAD_FILE_FIELD } from './media.constants';
import type { ImageUploadOptions, ImageUploadPayload } from './types';

const FILE_SCHEMA = {
  type: 'object',
  required: [UPLOAD_FILE_FIELD],
  properties: {
    [UPLOAD_FILE_FIELD]: {
      type: 'string',
      format: 'binary',
      description:
        'The image: one JPG or PNG of at most 10 MB and 40 megapixels. The server rotates it by its EXIF orientation, strips its metadata (location included) and stores WebP copies in web sizes only.',
    },
  },
};

/**
 * Makes a route an image upload (design §9), on top of the route's own access decorator and,
 * for a `POST`, `@Strict()`:
 *
 * - no request transaction (`@NoRequestTransaction()`): the image work holds no connection, and
 *   `MediaService.upload()` opens its own short transaction, which records the key;
 * - `ImageUploadInterceptor` receives the one file (`@UploadedImage()`), and the text fields
 *   arrive in `@Body()`, validated against `options.fields` like any request DTO;
 * - the multipart request body and the upload's error codes in the API documentation.
 */
export function ImageUpload(options: ImageUploadOptions = {}): MethodDecorator {
  const { fields } = options;
  return applyDecorators(
    NoRequestTransaction(),
    UseInterceptors(ImageUploadInterceptor),
    ApiConsumes('multipart/form-data'),
    ...(fields ? [ApiExtraModels(fields)] : []),
    ApiBody({
      schema: fields ? { allOf: [{ $ref: getSchemaPath(fields) }, FILE_SCHEMA] } : FILE_SCHEMA,
    }),
    ApiErrorResponses(
      'VALIDATION_FAILED',
      'IMAGE_TOO_LARGE',
      'UNSUPPORTED_IMAGE_TYPE',
      'IMAGE_TOO_MANY_PIXELS',
      'IMAGE_WRONG_SHAPE',
      'STORAGE_UNAVAILABLE',
    ),
  );
}

/** The file `ImageUploadInterceptor` received, for `MediaService.upload()`. */
export const UploadedImage = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ImageUploadPayload => {
    const payload = uploadPayloadOf(context.switchToHttp().getRequest<Request>());
    if (!payload) {
      throw new AppError('INTERNAL', '@UploadedImage() needs @ImageUpload() on the route.');
    }
    return payload;
  },
);
