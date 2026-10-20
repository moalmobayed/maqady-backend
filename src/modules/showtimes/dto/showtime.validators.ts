import { ValidateBy, type ValidationArguments } from 'class-validator';
import { addDays, isCalendarDate } from '../../../common/time/time';
import { MAX_DATE_SPAN_DAYS, START_TIME_MESSAGE, START_TIME_PATTERN } from '../showtimes.constants';

/** Validation decorators of the showtime request DTOs. */

/** A real calendar date written `YYYY-MM-DD` (so `2026-02-30` is refused); `each` for arrays. */
export function IsCinemaDate(each = false): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCinemaDate',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isCalendarDate(value),
        defaultMessage: (args?: ValidationArguments) =>
          `${args?.property ?? 'date'} must hold dates written YYYY-MM-DD`,
      },
    },
    { each },
  );
}

/** A 24-hour start time `HH:mm`: `19:30`, `00:30` (on the calendar day after the cinema date). */
export function IsStartTime(): PropertyDecorator {
  return ValidateBy({
    name: 'isStartTime',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && START_TIME_PATTERN.test(value),
      defaultMessage: () => START_TIME_MESSAGE,
    },
  });
}

/** Every date of the list lies within `MAX_DATE_SPAN_DAYS` days, first and last included. */
export function WithinDateSpan(): PropertyDecorator {
  return ValidateBy({
    name: 'withinDateSpan',
    validator: {
      validate: (value: unknown) => {
        if (!Array.isArray(value)) return true;
        const dates = value.filter(
          (date): date is string => typeof date === 'string' && isCalendarDate(date),
        );
        if (dates.length < 2) return true;
        const sorted = [...dates].sort();
        return addDays(sorted[0]!, MAX_DATE_SPAN_DAYS - 1) >= sorted[sorted.length - 1]!;
      },
      defaultMessage: (args?: ValidationArguments) =>
        `${args?.property ?? 'dates'} must lie within ${MAX_DATE_SPAN_DAYS} days, first and last included`,
    },
  });
}
