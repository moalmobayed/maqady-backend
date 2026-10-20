import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { isUuid, REQUEST_ID_HEADER, resolveCorrelationId } from '../logging/correlation-id';
import { serializeError } from '../logging/error-serializer';
import { resolveException, resolveRetryAfterSeconds } from './error-mapping';
import type { ErrorResponseBody, ResolvedError } from './types';

/**
 * The one global exception filter (design §14.3). Whatever is thrown, the client receives
 * `{ "error": { "code", "message", "details", "correlationId" } }`, the status from the
 * catalogue and an `X-Request-Id` header equal to `correlationId`. A `RATE_LIMITED` response
 * always carries `Retry-After`.
 *
 * Unexpected errors are logged with their stack; database errors are logged by SQLSTATE and
 * constraint only. Client errors (4xx) are not logged again: the request line records them.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      // The seat-map gateway (U10) handles its own errors; nothing can be written back here.
      this.logger.error({ err: serializeError(exception) }, 'Unhandled non-HTTP error');
      return;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const correlationId = correlationIdOf(request);
    const resolved = resolveException(exception, { method: request.method, path: request.path });

    this.log(resolved, exception, request, correlationId);

    if (response.headersSent) {
      // A streamed response failed midway; abort it so the client can't mistake it for complete.
      response.destroy();
      return;
    }

    response.setHeader(REQUEST_ID_HEADER, correlationId);
    if (resolved.code === 'RATE_LIMITED') {
      const seconds = resolveRetryAfterSeconds(resolved, response.getHeaders());
      response.setHeader('Retry-After', String(seconds));
    }

    const body: ErrorResponseBody = {
      error: {
        code: resolved.code,
        message: resolved.message,
        details: resolved.details,
        correlationId,
      },
    };
    response.status(resolved.status).json(body);
  }

  private log(
    resolved: ResolvedError,
    exception: unknown,
    request: Request,
    correlationId: string,
  ): void {
    if (resolved.log === 'none') return;
    const fields = {
      code: resolved.code,
      err: serializeError(exception),
      // Requests that failed before the logging middleware ran (an unreadable body, for
      // example) have no request-bound logger, so the id is added explicitly.
      ...(request.log === undefined ? { correlationId } : {}),
    };
    if (resolved.log === 'warn') {
      this.logger.warn(fields, 'Request failed: %s', resolved.code);
    } else {
      this.logger.error(fields, 'Request failed: %s', resolved.code);
    }
  }
}

/**
 * The id the logging middleware gave this request, or, when it never ran (body-parser errors
 * happen before it), one resolved from `X-Request-Id` the same way.
 */
function correlationIdOf(request: Request): string {
  if (typeof request.id === 'string' && isUuid(request.id)) return request.id;
  const id = resolveCorrelationId(request.headers['x-request-id']);
  request.id = id;
  return id;
}
