import { ValidateBy } from 'class-validator';
import { parseRateLimitRule } from '../rate-limit/rate-limit.constants';
import type { SecretRule } from './types';

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

const BASE64_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * Decodes a base64 or base64url secret (as `openssl rand -base64 32` prints it). Undefined when
 * the text is not base64 at all.
 */
export function decodeSecret(value: string): Buffer | undefined {
  const trimmed = value.trim();
  if (!BASE64_PATTERN.test(trimmed)) return undefined;
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

/** A base64 secret of at least `minBytes` bytes, or of exactly `exactBytes`. */
export function isSecret(value: unknown, rule: SecretRule): boolean {
  if (typeof value !== 'string') return false;
  const bytes = decodeSecret(value);
  if (!bytes) return false;
  if (rule.exactBytes !== undefined) return bytes.length === rule.exactBytes;
  return bytes.length >= (rule.minBytes ?? 1);
}

export function IsSecret(rule: SecretRule): PropertyDecorator {
  const size =
    rule.exactBytes !== undefined
      ? `exactly ${rule.exactBytes} bytes`
      : `at least ${rule.minBytes ?? 1} bytes`;
  return ValidateBy({
    name: 'isSecret',
    validator: {
      validate: (value: unknown) => isSecret(value, rule),
      defaultMessage: () =>
        `must be base64 encoding ${size}; generate one with: openssl rand -base64 32`,
    },
  });
}

export function IsRateLimitRule(): PropertyDecorator {
  return ValidateBy({
    name: 'isRateLimitRule',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && parseRateLimitRule(value) !== undefined,
      defaultMessage: () => 'must be <count>/<window>, the window in s, m or h, for example 300/1m',
    },
  });
}

/**
 * Where email links point (design §13.1): an absolute `http(s)://` URL, optionally with a path,
 * and no credentials, query or fragment, because paths and `?token=` are appended to it.
 */
export function isFrontendBaseUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      WEB_PROTOCOLS.has(url.protocol) &&
      url.hostname !== '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      !value.includes('?') &&
      !value.includes('#')
    );
  } catch {
    return false;
  }
}

/** The base URL without its trailing slashes, so `${base}${path}` never doubles one. */
export function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

const EMAIL_ADDRESS = '[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+';
const EMAIL_FROM_PATTERN = new RegExp(`^(${EMAIL_ADDRESS}|[^<>]+ <${EMAIL_ADDRESS}>)$`);

/** A sender as Resend takes it: `addr@domain` or `Name <addr@domain>`. */
export function isEmailFrom(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_FROM_PATTERN.test(value);
}

export function IsFrontendBaseUrl(): PropertyDecorator {
  return ValidateBy({
    name: 'isFrontendBaseUrl',
    validator: {
      validate: isFrontendBaseUrl,
      defaultMessage: () =>
        'must be an http:// or https:// URL such as https://maqady.example, with no query or fragment',
    },
  });
}

export function IsEmailFrom(): PropertyDecorator {
  return ValidateBy({
    name: 'isEmailFrom',
    validator: {
      validate: isEmailFrom,
      defaultMessage: () =>
        'must be an address such as tickets@maqady.example or Maqady <tickets@maqady.example>',
    },
  });
}

/** An API key: non-empty, no whitespace. The value is never echoed. */
export function IsApiKey(): PropertyDecorator {
  return ValidateBy({
    name: 'isApiKey',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && /^\S+$/.test(value),
      defaultMessage: () => 'must be an API key with no spaces',
    },
  });
}
