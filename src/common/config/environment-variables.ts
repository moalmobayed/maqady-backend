import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { LOG_LEVELS } from './enums';
import type { LogLevel } from './types';
import { IsOriginList, IsPostgresUrl } from './validators';

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
}
