import type { RateLimitsConfig } from '../rate-limit/types';
import type { EMAIL_DRIVERS, LOG_LEVELS } from './enums';

export type LogLevel = (typeof LOG_LEVELS)[number];

export type EmailDriver = (typeof EMAIL_DRIVERS)[number];

export interface DatabaseConfig {
  /** Postgres connection URL (Supabase: the session pooler, port 5432). */
  readonly url: string;
  /** Schema that holds every table; first on the connection's search_path. */
  readonly schema: string;
}

/** Signing secrets for access tokens, one per audience (design §10.2). Base64 text. */
export interface AuthConfig {
  readonly customerTokenSecret: string;
  readonly staffTokenSecret: string;
}

/** Keys for data encrypted at rest (design §14.1). Base64 text of 32 bytes each. */
export interface EncryptionConfig {
  /** Encrypts and decrypts. */
  readonly key: string;
  /** The key before the last rotation: decrypts only. */
  readonly previousKey?: string;
}

/**
 * How email is sent (ADR 0004). `simulated` records every email as sent without contacting
 * anyone (local runs, CI); `resend` sends through Resend's HTTP API.
 */
export type EmailConfig =
  | { readonly driver: 'simulated' }
  | {
      readonly driver: 'resend';
      /** Resend API key; never logged. */
      readonly apiKey: string;
      /** `addr@domain` or `Name <addr@domain>`, on the domain verified in Resend. */
      readonly from: string;
    };

/** The validated environment, built once at boot by `loadConfig()`. */
export interface AppConfig {
  readonly port: number;
  readonly logLevel: LogLevel;
  /** Exact origins the browser may call from, for example `https://maqady.example`. */
  readonly corsOrigins: readonly string[];
  readonly database: DatabaseConfig;
  readonly auth: AuthConfig;
  readonly encryption: EncryptionConfig;
  readonly rateLimits: RateLimitsConfig;
  /** Where links in emails point, without a trailing slash, for example `https://maqady.example`. */
  readonly frontendBaseUrl: string;
  readonly email: EmailConfig;
}

/** How long a base64 secret must decode to: at least `minBytes`, or exactly `exactBytes`. */
export interface SecretRule {
  readonly minBytes?: number;
  readonly exactBytes?: number;
}
