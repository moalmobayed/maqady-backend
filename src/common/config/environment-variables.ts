// The environment is validated before Nest loads, so the decorators' metadata API is loaded here.
import 'reflect-metadata';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { EMAIL_DRIVERS, LOG_LEVELS, STORAGE_DRIVERS } from './enums';
import type { EmailDriver, LogLevel, StorageDriver } from './types';
import { ACCESS_TOKEN_SECRET_MIN_BYTES, DATA_ENCRYPTION_KEY_BYTES } from './config.constants';
import {
  IsApiKey,
  IsBaseUrl,
  IsEmailFrom,
  IsFrontendBaseUrl,
  IsOriginList,
  IsPostgresUrl,
  IsRateLimitRule,
  IsSecret,
  IsStorageOrigin,
} from './validators';

const usesSupabaseStorage = (variables: EnvironmentVariables): boolean =>
  variables.STORAGE_DRIVER === 'supabase';

/**
 * The raw environment variables this service reads, as validated at boot.
 *
 * Validation messages name the variable but never echo its value, because values can be secrets.
 * Later units add the variables they own (design §14.5), each with its own rule.
 */
export class EnvironmentVariables {
  @IsDefined({ message: 'is required' })
  @IsPostgresUrl()
  DATABASE_URL!: string;

  @IsDefined({ message: 'is required' })
  @Matches(/^[a-z_][a-z0-9_]{0,62}$/, {
    message: 'must be a lower-case SQL identifier such as maqady',
  })
  DB_SCHEMA!: string;

  @IsDefined({ message: 'is required' })
  @IsOriginList()
  CORS_ORIGINS!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer between 1 and 65535' })
  @Min(1, { message: 'must be an integer between 1 and 65535' })
  @Max(65535, { message: 'must be an integer between 1 and 65535' })
  PORT?: number;

  @IsOptional()
  @IsIn(LOG_LEVELS, { message: `must be one of ${LOG_LEVELS.join(', ')}` })
  LOG_LEVEL?: LogLevel;

  // Secrets (design §10.2, §14.1). Messages never echo the value.

  @IsDefined({ message: 'is required' })
  @IsSecret({ minBytes: ACCESS_TOKEN_SECRET_MIN_BYTES })
  JWT_SECRET_CUSTOMER!: string;

  @IsDefined({ message: 'is required' })
  @IsSecret({ minBytes: ACCESS_TOKEN_SECRET_MIN_BYTES })
  JWT_SECRET_STAFF!: string;

  @IsDefined({ message: 'is required' })
  @IsSecret({ exactBytes: DATA_ENCRYPTION_KEY_BYTES })
  DATA_ENCRYPTION_KEY!: string;

  @IsOptional()
  @IsSecret({ exactBytes: DATA_ENCRYPTION_KEY_BYTES })
  DATA_ENCRYPTION_PREVIOUS_KEY?: string;

  // Rate limits (design §10.6), `<count>/<window>`. Unset means the design's default.

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_DEFAULT?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_SIGN_IN_EMAIL?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_SIGN_IN_IP?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_REGISTRATION_IP?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_EMAIL_REQUEST_EMAIL?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_EMAIL_REQUEST_IP?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_VERIFICATION_RESEND_CUSTOMER?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_HOLD_IP?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_HOLD_CUSTOMER?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_PAYMENT?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_TICKET_EMAIL?: string;

  @IsOptional()
  @IsRateLimitRule()
  RATE_LIMIT_SEARCH?: string;

  // The live seat map's limits (design §10.6, §12). Unset means the design's default.

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer between 1 and 10000' })
  @Min(1, { message: 'must be an integer between 1 and 10000' })
  @Max(10000, { message: 'must be an integer between 1 and 10000' })
  WS_CONNECTIONS_PER_IP?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'must be an integer between 1 and 100' })
  @Min(1, { message: 'must be an integer between 1 and 100' })
  @Max(100, { message: 'must be an integer between 1 and 100' })
  WS_SUBSCRIPTIONS_PER_CONNECTION?: number;

  // Email (design §13.1, ADR 0004). The key is a secret: messages never echo it.

  @IsDefined({ message: 'is required' })
  @IsFrontendBaseUrl()
  FRONTEND_BASE_URL!: string;

  @IsDefined({ message: 'is required' })
  @IsIn(EMAIL_DRIVERS, { message: `must be one of ${EMAIL_DRIVERS.join(', ')}` })
  EMAIL_DRIVER!: EmailDriver;

  @ValidateIf((variables: EnvironmentVariables) => variables.EMAIL_DRIVER === 'resend')
  @IsDefined({ message: 'is required when EMAIL_DRIVER is resend' })
  @IsApiKey()
  RESEND_API_KEY?: string;

  @ValidateIf((variables: EnvironmentVariables) => variables.EMAIL_DRIVER === 'resend')
  @IsDefined({ message: 'is required when EMAIL_DRIVER is resend' })
  @IsEmailFrom()
  EMAIL_FROM?: string;

  // Image storage (design §9, §14.5). No default driver: a deploy that forgot it must not write
  // to the host's ephemeral disk. The service role key is never echoed.

  @IsDefined({ message: 'is required' })
  @IsIn(STORAGE_DRIVERS, { message: `must be one of ${STORAGE_DRIVERS.join(', ')}` })
  STORAGE_DRIVER!: StorageDriver;

  @ValidateIf(usesSupabaseStorage)
  @IsDefined({ message: 'is required when STORAGE_DRIVER is supabase' })
  @IsStorageOrigin()
  SUPABASE_URL?: string;

  @ValidateIf(usesSupabaseStorage)
  @IsDefined({ message: 'is required when STORAGE_DRIVER is supabase' })
  @Matches(/^\S{20,}$/, {
    message:
      'must be the service role key from the Supabase dashboard (at least 20 characters, no spaces)',
  })
  SUPABASE_SERVICE_ROLE_KEY?: string;

  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9._-]{1,62}$/, {
    message: 'must be a bucket name such as media (lower-case letters, digits, ".", "_", "-")',
  })
  STORAGE_BUCKET?: string;

  @IsOptional()
  @MinLength(1, { message: 'must be a directory path' })
  LOCAL_STORAGE_DIR?: string;

  @IsOptional()
  @IsBaseUrl()
  LOCAL_STORAGE_PUBLIC_URL?: string;
}
