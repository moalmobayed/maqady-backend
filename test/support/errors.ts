import { DatabaseError } from 'pg';

/** A node-pg `DatabaseError` as the driver raises it for a failed statement. */
export function postgresError(fields: {
  code: string;
  message?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}): DatabaseError {
  const error = new DatabaseError(fields.message ?? 'database error', 0, 'error');
  error.severity = 'ERROR';
  error.code = fields.code;
  error.constraint = fields.constraint;
  error.detail = fields.detail;
  error.table = fields.table;
  return error;
}

/** A Node socket error such as the one `connect()` raises when Postgres is down. */
export function socketError(code: string, message = `connect ${code} 127.0.0.1:5432`): Error {
  return Object.assign(new Error(message), { code, errno: -111, syscall: 'connect' });
}

/** An error in the shape Express's body parser raises (`http-errors`). */
export function bodyParserError(type: string, status: number, message: string): Error {
  return Object.assign(new Error(message), {
    type,
    status,
    statusCode: status,
    expose: status < 500,
  });
}
