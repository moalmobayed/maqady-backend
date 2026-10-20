// The environment is validated before Nest loads, so the decorators' metadata API is loaded here.
import 'reflect-metadata';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { LOG_LEVELS } from './enums';
import type { LogLevel } from './types';
import { ACCESS_TOKEN_SECRET_MIN_BYTES, DATA_ENCRYPTION_KEY_BYTES } from './config.constants';
import { IsOriginList, IsPostgresUrl, IsRateLimitRule, IsSecret } from './validators';

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
}
