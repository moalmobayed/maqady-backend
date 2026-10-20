import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isIsoInstant } from './time';

/**
 * A query or body value that must be an instant in ISO 8601 with its offset, such as
 * `2026-10-16T00:00:00+03:00` or `2026-10-15T21:00:00Z` (`isIsoInstant`). A bare date, a time
 * without an offset or an impossible date is refused.
 */
export function IsIsoInstant(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isIsoInstant',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isIsoInstant(value),
        defaultMessage: (args) =>
          `${args?.property ?? 'value'} must be an ISO 8601 time with its offset, such as 2026-10-16T00:00:00+03:00`,
      },
    },
    options,
  );
}
