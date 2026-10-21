import { ERROR_CATALOGUE } from './error-catalogue';
import type { AppErrorOptions, ErrorCode, ErrorDetails } from './types';

/**
 * The only error services throw (CLAUDE.md "Errors"). The HTTP status comes from the catalogue,
 * so a code is always sent with the same status. The global exception filter turns it into the
 * error response.
 *
 * @example throw new AppError('NOT_FOUND');
 * @example throw new AppError('SEAT_TAKEN', 'Some seats were just taken.', { seats: ['C4'] });
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly status: number;
  readonly details: ErrorDetails | null;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly code: ErrorCode,
    message?: string,
    details: ErrorDetails | null = null,
    options: AppErrorOptions = {},
  ) {
    super(
      message ?? ERROR_CATALOGUE[code].message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.status = ERROR_CATALOGUE[code].status;
    this.details = details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
