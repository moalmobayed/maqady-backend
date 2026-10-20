import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { type LevelWithSilent, stdTimeFunctions } from 'pino';
import type { Options } from 'pino-http';
import { REQUEST_ID_HEADER, resolveCorrelationId } from './correlation-id';
import { serializeError } from './error-serializer';
import type { AuthenticatedRequest, LoggingOptions, RequestLogLine, RoutedRequest } from './types';

/**
 * Header paths censored wherever a header object is logged. Request lines never include headers;
 * this is the backstop for anything that logs a raw request or a header map by mistake.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers["x-hold-token"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers["x-hold-token"]',
  'headers.cookie',
];

export const REDACTION_CENSOR = '[Redacted]';

/**
 * nestjs-pino settings. Every line written during a request carries `correlationId`, and each
 * request ends with one line of method, route template, status and duration. URLs, query
 * strings, headers and bodies are never logged: they can hold personal data, such as an email
 * typed into search.
 */
export function buildLoggerParams(options: LoggingOptions): Params {
  const httpOptions: Options = {
    level: options.level,
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACTED_PATHS, censor: REDACTION_CENSOR },
    // Serializers get the raw objects, so nothing reaches a line unless listed here.
    wrapSerializers: false,
    serializers: {
      req: (req: IncomingMessage) => ({ method: req.method, route: routeTemplateOf(req) }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      err: serializeError,
    },
    genReqId: (req, res) => {
      const id = resolveCorrelationId(req.headers['x-request-id']);
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    customAttributeKeys: { reqId: 'correlationId' },
    // Child loggers carry only the correlation id, not a serialized request.
    quietReqLogger: true,
    quietResLogger: true,
    customLogLevel: requestLogLevel,
    customSuccessObject: (req, res, value: { responseTime: number }) =>
      requestLogLine(req, res, value.responseTime),
    customErrorObject: (req, res, _error, value: { responseTime: number }) =>
      requestLogLine(req, res, value.responseTime),
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
  };

  return { pinoHttp: options.destination ? [httpOptions, options.destination] : httpOptions };
}

export function requestLogLevel(
  _req: IncomingMessage,
  res: ServerResponse,
  error?: Error,
): LevelWithSilent {
  if (error || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return 'info';
}

export function requestLogLine(
  req: IncomingMessage,
  res: ServerResponse,
  responseTime: number,
): RequestLogLine {
  const { principal } = req as AuthenticatedRequest;
  return {
    method: req.method,
    route: routeTemplateOf(req),
    statusCode: res.statusCode,
    responseTime,
    principalKind: principal?.kind ?? null,
    principalId: principal?.id ?? null,
  };
}

/**
 * The Express route template that matched, for example `/api/v1/bookings/:ref`, or null.
 * Wildcard templates belong to middleware mounts (the logger's own is `/api/v1{/*splat}`),
 * which Express leaves in `req.route` when no real route matched. API routes have none.
 */
export function routeTemplateOf(req: IncomingMessage): string | null {
  const { route, baseUrl } = req as RoutedRequest;
  if (typeof route?.path !== 'string' || route.path.includes('*')) return null;
  return (typeof baseUrl === 'string' ? baseUrl : '') + route.path;
}
