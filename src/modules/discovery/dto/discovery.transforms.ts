import { Transform } from 'class-transformer';

/**
 * Query-string transforms of the discovery DTOs. Each runs inside the one global
 * `ValidationPipe` before the validators, so a bad value is `VALIDATION_FAILED` on its field.
 */

/** `a,b,c` → `['a', 'b', 'c']`: trimmed, empties dropped. A repeated parameter is joined first. */
export function CommaSeparated(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    const text = Array.isArray(value) ? value.join(',') : value;
    if (typeof text !== 'string') return text;
    return text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
  });
}

/**
 * `1,2` → `[1, 2]`; a part that isn't a positive whole number of at most 15 digits (so always a
 * safe integer) stays a string, so `@IsInt` refuses it with one message.
 */
export function CommaSeparatedIds(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    const text = Array.isArray(value) ? value.join(',') : value;
    if (typeof text !== 'string') return text;
    return text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => (/^[1-9][0-9]{0,14}$/.test(part) ? Number(part) : part));
  });
}

/** `true` / `false` → a boolean; anything else stays as sent, so `@IsBoolean` refuses it. */
export function QueryBoolean(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });
}

/** Trims a string before it is validated. */
export function TrimQuery(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
