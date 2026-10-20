import { ValidateBy, type ValidationOptions } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from './auth.constants';

const DIGIT = /[0-9]/;

/** Design §10.1: 8 to 128 characters, at least one digit. Applied when a password is set, not at sign-in. */
export function isAllowedPassword(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH &&
    DIGIT.test(value)
  );
}

/** The password policy as a class-validator decorator, for request DTOs that set a password (U2b, U9). */
export function IsAllowedPassword(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isAllowedPassword',
      validator: { validate: isAllowedPassword, defaultMessage: () => PASSWORD_POLICY_MESSAGE },
    },
    options,
  );
}
