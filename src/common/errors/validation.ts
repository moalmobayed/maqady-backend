import { type ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError } from './app-error';
import type { FieldError } from './types';

/**
 * Flattens class-validator's nested errors into one entry per invalid field, with dotted paths:
 * `seats.0.label` for the label of the first seat. Unknown properties appear as their own field.
 */
export function flattenValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

export function validationExceptionFactory(errors: ValidationError[]): AppError {
  return new AppError('VALIDATION_FAILED', undefined, { fields: flattenValidationErrors(errors) });
}

/**
 * The one global ValidationPipe (CLAUDE.md "Validation"). It strips nothing silently: an unknown
 * property is an error. It transforms payloads into DTO instances, and never copies the rejected
 * values into the error.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: validationExceptionFactory,
  });
}
