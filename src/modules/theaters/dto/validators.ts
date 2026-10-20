import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationArguments } from 'class-validator';
import { isCalendarDate } from '../../../common/time/time';
import {
  CLOSED_WITH_TIMES_MESSAGE,
  CLOSES_MESSAGE,
  isValidClosing,
  minuteOfDay,
  OPEN_WITHOUT_TIMES_MESSAGE,
  OPENS_MESSAGE,
  opensMinuteOf,
} from '../opening-hours';
import type { WallClockHoursInput } from '../types';

/**
 * Validation decorators of the theater request DTOs. Opening times follow `opening-hours.ts`:
 * `opens` from 06:00 to 23:59, `closes` after it, a `closes` at or before 06:00 on the next day.
 */

/** Trims a string before it is validated, so length checks and the database see the same text. */
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

/**
 * A finite number with at most `places` decimals. class-validator's `maxDecimalPlaces` reads the
 * decimals from `toString()`, which writes numbers below 1e-6 with an exponent (`1e-7`) and then
 * throws instead of refusing; `toExponential()` always has the exponent, so it is read here.
 */
export function HasAtMostDecimals(places: number): PropertyDecorator {
  return ValidateBy({
    name: 'hasAtMostDecimals',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) && decimalsOf(value) <= places,
      defaultMessage: (args?: ValidationArguments) =>
        `${args?.property ?? 'value'} must be a number with at most ${places} decimals`,
    },
  });
}

/** A real calendar date written `YYYY-MM-DD`. */
export function IsCalendarDate(): PropertyDecorator {
  return ValidateBy({
    name: 'isCalendarDate',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && isCalendarDate(value),
      defaultMessage: (args?: ValidationArguments) =>
        `${args?.property ?? 'value'} must be a date written YYYY-MM-DD`,
    },
  });
}

/**
 * `opens` of a day with a `closed` flag: required when open, refused when closed. With
 * `optional`, it may be left out when open (a `PATCH`, checked as a whole by the service).
 */
export function IsOpensTime(options: { optional?: boolean } = {}): PropertyDecorator {
  return ValidateBy({
    name: 'isOpensTime',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        opensProblem(value, hoursOf(args), options.optional === true) === null,
      defaultMessage: (args?: ValidationArguments) =>
        opensProblem(args?.value, hoursOf(args), options.optional === true) ?? OPENS_MESSAGE,
    },
  });
}

/** `closes` of a day with a `closed` flag and `opens`: as `IsOpensTime`, and after `opens`. */
export function IsClosesTime(options: { optional?: boolean } = {}): PropertyDecorator {
  return ValidateBy({
    name: 'isClosesTime',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        closesProblem(value, hoursOf(args), options.optional === true) === null,
      defaultMessage: (args?: ValidationArguments) =>
        closesProblem(args?.value, hoursOf(args), options.optional === true) ?? CLOSES_MESSAGE,
    },
  });
}

/** The decimals of a finite number: `3.00609e+1` has 5 digits after the point, less 1. */
function decimalsOf(value: number): number {
  const [mantissa = '', exponent = '0'] = value.toExponential().split('e');
  const fractionDigits = mantissa.split('.')[1]?.length ?? 0;
  return Math.max(0, fractionDigits - Number(exponent));
}

function hoursOf(args: ValidationArguments | undefined): Partial<WallClockHoursInput> {
  return args?.object ?? {};
}

function opensProblem(
  value: unknown,
  day: Partial<WallClockHoursInput>,
  optional: boolean,
): string | null {
  if (value === undefined) {
    return day.closed === false && !optional ? OPEN_WITHOUT_TIMES_MESSAGE : null;
  }
  if (day.closed === true) return CLOSED_WITH_TIMES_MESSAGE;
  return typeof value === 'string' && opensMinuteOf(value) !== null ? null : OPENS_MESSAGE;
}

function closesProblem(
  value: unknown,
  day: Partial<WallClockHoursInput>,
  optional: boolean,
): string | null {
  if (value === undefined) {
    return day.closed === false && !optional ? OPEN_WITHOUT_TIMES_MESSAGE : null;
  }
  if (day.closed === true) return CLOSED_WITH_TIMES_MESSAGE;
  if (typeof value !== 'string' || minuteOfDay(value) === null) return CLOSES_MESSAGE;
  // Against `opens` only when it is valid; a bad `opens` has its own message.
  const { opens } = day;
  if (typeof opens !== 'string' || opensMinuteOf(opens) === null) return null;
  return isValidClosing(opens, value) ? null : CLOSES_MESSAGE;
}
