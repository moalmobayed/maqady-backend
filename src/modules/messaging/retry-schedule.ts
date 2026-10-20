import { RETRY_BACKOFF_MINUTES } from './messaging.constants';

/**
 * Minutes to wait after the given number of failed attempts (1-based): 1, 5, 15, 60, 180, then
 * 360 for every later attempt.
 */
export function retryDelayMinutes(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), RETRY_BACKOFF_MINUTES.length) - 1;
  return RETRY_BACKOFF_MINUTES[index] ?? RETRY_BACKOFF_MINUTES[RETRY_BACKOFF_MINUTES.length - 1]!;
}
