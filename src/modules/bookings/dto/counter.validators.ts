import { ValidateBy, type ValidationArguments } from 'class-validator';

/**
 * Validation decorators of the box office request DTOs (U13): a field that belongs to one choice
 * of another field (a `customerId` only with `kind: existing`, a `receiptReference` only with
 * `method: card_terminal`) is refused when sent for another choice, so the counter screen learns
 * of a mix-up instead of having it silently ignored.
 */

/**
 * The property is refused unless `allowed(body)` holds: sent at all (not undefined, nor null for
 * a nullable field) for a choice it does not belong to, it fails with `message`.
 */
export function OnlyWhen<T extends object>(
  allowed: (body: T) => boolean,
  message: string,
): PropertyDecorator {
  return ValidateBy({
    name: 'onlyWhen',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        value === undefined || value === null || allowed((args?.object ?? {}) as T),
      defaultMessage: () => message,
    },
  });
}
