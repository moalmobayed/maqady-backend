import { ValidateBy } from 'class-validator';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const WEB_PROTOCOLS = new Set(['http:', 'https:']);

export function isPostgresUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return POSTGRES_PROTOCOLS.has(url.protocol) && url.hostname !== '';
  } catch {
    return false;
  }
}

/** Splits a comma-separated list, trimming each entry and dropping empty ones. */
export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** An origin is `scheme://host[:port]` with nothing after it, exactly as browsers send it. */
export function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return WEB_PROTOCOLS.has(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

export function isOriginList(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const origins = splitList(value);
  return origins.length > 0 && origins.every(isOrigin);
}

export function IsPostgresUrl(): PropertyDecorator {
  return ValidateBy({
    name: 'isPostgresUrl',
    validator: {
      validate: isPostgresUrl,
      defaultMessage: () => 'must be a postgres:// or postgresql:// connection URL',
    },
  });
}

export function IsOriginList(): PropertyDecorator {
  return ValidateBy({
    name: 'isOriginList',
    validator: {
      validate: isOriginList,
      defaultMessage: () =>
        'must be a comma-separated list of origins such as https://maqady.example (no path, no trailing slash)',
    },
  });
}
