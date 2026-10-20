import { Transform } from 'class-transformer';
import {
  registerDecorator,
  ValidateIf,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { isCalendarDate } from '../../../common/time/time';
import { CHARACTER_ROLES } from '../enums';
import { YOUTUBE_URL_MESSAGE } from '../catalog.constants';
import { parseYoutubeUrl } from '../youtube';

/**
 * The catalog's request validators and transforms, used by the DTOs of this folder only. Each
 * runs inside the one global `ValidationPipe`, so a failure is `VALIDATION_FAILED` with the
 * field's dotted path.
 */

/** Trims a string before it is validated. */
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

/** Trims a string; an optional text sent empty (after trimming) is stored as null. */
export function TrimToNull(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  });
}

/**
 * An optional field that can't be cleared: absent skips its validation, but `null` is validated
 * (and refused) like any other value. `@IsOptional()` would let `null` through to the service.
 */
export function OptionalNotNull(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}

/** True when none of `fields` was sent: a `PATCH` must change something. */
export function noneSent(body: object, fields: readonly string[]): boolean {
  const record = body as Record<string, unknown>;
  return fields.every((field) => record[field] === undefined);
}

/** A real calendar date written `YYYY-MM-DD` (so `2026-02-30` is refused). */
export function IsCalendarDate(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: `${String(propertyName)} must be a date written YYYY-MM-DD`, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isCalendarDate(value),
      },
    });
  };
}

/** A YouTube watch, youtu.be, shorts or embed link (`parseYoutubeUrl`). */
export function IsYoutubeUrl(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isYoutubeUrl',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: YOUTUBE_URL_MESSAGE, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && parseYoutubeUrl(value) !== null,
      },
    });
  };
}

/** A character name is only for the `actor` and `voice` roles of the same credit. */
export function CharacterNameForRole(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'characterNameForRole',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: 'characterName is only for the actor and voice roles', ...options },
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          if (value === undefined || value === null) return true;
          const { role } = args.object as { role?: unknown };
          return (CHARACTER_ROLES as readonly unknown[]).includes(role);
        },
      },
    });
  };
}

/**
 * No two items of the array share the values of `keys` (for example a person and a role). Items
 * that aren't objects are left to their own validation.
 */
export function UniqueBy(keys: readonly string[], options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'uniqueBy',
      target: target.constructor,
      propertyName: String(propertyName),
      constraints: [keys],
      options: {
        message: `${String(propertyName)} must not repeat the same ${keys.join(' and ')}`,
        ...options,
      },
      validator: {
        validate: (value: unknown) => {
          if (!Array.isArray(value)) return true;
          const seen = new Set<string>();
          for (const item of value as unknown[]) {
            if (typeof item !== 'object' || item === null) continue;
            const record = item as Record<string, unknown>;
            const key = JSON.stringify(keys.map((name) => record[name]));
            if (seen.has(key)) return false;
            seen.add(key);
          }
          return true;
        },
      },
    });
  };
}

/** An `https` link of at most 500 characters on one of `hosts` (any host when omitted). */
export function IsHttpsUrlOn(
  hosts: readonly string[] | null,
  options?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isHttpsUrlOn',
      target: target.constructor,
      propertyName: String(propertyName),
      options: {
        message:
          hosts === null
            ? `${String(propertyName)} must be an https link`
            : `${String(propertyName)} must be an https link on ${hosts.join(' or ')}`,
        ...options,
      },
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string' || !value.startsWith('https://')) return false;
          let url: URL;
          try {
            url = new URL(value);
          } catch {
            return false;
          }
          if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
          return hosts === null || hosts.includes(url.hostname);
        },
      },
    });
  };
}
