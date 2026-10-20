import type { LOG_LEVELS } from './enums';

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface DatabaseConfig {
  /** Postgres connection URL (Supabase: the session pooler, port 5432). */
  readonly url: string;
  /** Schema that holds every table; first on the connection's search_path. */
  readonly schema: string;
}

/** The validated environment, built once at boot by `loadConfig()`. */
export interface AppConfig {
  readonly port: number;
  readonly logLevel: LogLevel;
  /** Exact origins the browser may call from, for example `https://maqady.example`. */
  readonly corsOrigins: readonly string[];
  readonly database: DatabaseConfig;
}
