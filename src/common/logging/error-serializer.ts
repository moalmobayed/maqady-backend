import { isPostgresError } from '../database/postgres-errors';
import type { SerializedError } from './types';

const MAX_CAUSE_DEPTH = 3;
const STACK_FRAME = /^\s+at\s/;

/**
 * Turns anything thrown into a log-safe object.
 *
 * - A Postgres error keeps its SQLSTATE, its constraint name and its stack frames. Its message
 *   and detail are dropped, because they can carry row values such as `Key (email)=(…)`.
 * - Any other `Error` keeps its name, message, code and stack.
 * - A thrown non-error value is reduced to its type, since it could be anything.
 */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return { type: error === null ? 'null' : typeof error };
  }

  const cause =
    depth < MAX_CAUSE_DEPTH && error.cause !== undefined
      ? { cause: serializeError(error.cause, depth + 1) }
      : {};

  if (isPostgresError(error)) {
    return {
      type: 'DatabaseError',
      code: error.code,
      ...(error.constraint ? { constraint: error.constraint } : {}),
      stack: stackFramesOnly(error.stack),
      ...cause,
    };
  }

  const { code } = error as { code?: unknown };
  return {
    type: error.name,
    message: error.message,
    ...(typeof code === 'string' ? { code } : {}),
    ...(error.stack ? { stack: error.stack } : {}),
    ...cause,
  };
}

/** A stack trace starts with the message, which a Postgres error must not leak; keep the frames. */
function stackFramesOnly(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const frames = stack.split('\n').filter((line) => STACK_FRAME.test(line));
  return frames.length > 0 ? frames.join('\n') : undefined;
}
