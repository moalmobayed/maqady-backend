import { AppError } from '../../common/errors/app-error';

/** `VALIDATION_FAILED` for one field, in the shape the global `ValidationPipe` uses. */
export function fieldError(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', undefined, { fields: [{ field, messages: [message] }] });
}

/** `VALIDATION_FAILED` for several fields with one message each. */
export function fieldErrors(fields: readonly (readonly [string, string])[]): AppError {
  return new AppError('VALIDATION_FAILED', undefined, {
    fields: fields.map(([field, message]) => ({ field, messages: [message] })),
  });
}
