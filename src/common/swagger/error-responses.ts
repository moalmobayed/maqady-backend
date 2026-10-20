import { applyDecorators } from '@nestjs/common';
import { ApiResponse, type ApiResponseOptions, getSchemaPath } from '@nestjs/swagger';
import { ErrorResponse, EXAMPLE_CORRELATION_ID } from '../errors/dto/error-response.dto';
import { ERROR_CATALOGUE } from '../errors/error-catalogue';
import type { ErrorCode, ErrorDetails, ErrorResponseBody } from '../errors/types';

/** The `X-Request-Id` response header, for success responses' `headers`. */
export const REQUEST_ID_RESPONSE_HEADER = {
  'X-Request-Id': {
    description: 'Correlation id for this request. Quote it when reporting a problem.',
    schema: { type: 'string', format: 'uuid' },
  },
};

const RETRY_AFTER_RESPONSE_HEADER = {
  'Retry-After': {
    description: 'Seconds to wait before retrying',
    schema: { type: 'integer' },
  },
};

/** Example `details` for the codes whose details aren't null. */
const EXAMPLE_DETAILS: Partial<Record<ErrorCode, ErrorDetails>> = {
  VALIDATION_FAILED: {
    fields: [{ field: 'seats.0.label', messages: ['label must be a string'] }],
  },
  CONFLICT: { constraint: 'uq_movies_featured_position' },
};

export function exampleErrorBody(code: ErrorCode): ErrorResponseBody {
  return {
    error: {
      code,
      message: ERROR_CATALOGUE[code].message,
      details: EXAMPLE_DETAILS[code] ?? null,
      correlationId: EXAMPLE_CORRELATION_ID,
    },
  };
}

/**
 * The documented response for one HTTP status and the codes that share it: the `ErrorResponse`
 * schema, one example per code, `X-Request-Id`, and `Retry-After` on a 429.
 */
export function errorResponseFor(status: number, codes: readonly ErrorCode[]): ApiResponseOptions {
  return {
    status,
    description: codes
      .map((code) => `\`${code}\`: ${ERROR_CATALOGUE[code].description}`)
      .join('\n\n'),
    headers: {
      ...REQUEST_ID_RESPONSE_HEADER,
      ...(status === 429 ? RETRY_AFTER_RESPONSE_HEADER : {}),
    },
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ErrorResponse) },
        examples: Object.fromEntries(
          codes.map((code) => [code, { summary: code, value: exampleErrorBody(code) }]),
        ),
      },
    },
  };
}

/**
 * Declares an operation's error responses in one line, grouped by status:
 *
 * @example @ApiErrorResponses('VALIDATION_FAILED', 'SEAT_TAKEN', 'RATE_LIMITED')
 *
 * `500 INTERNAL` is declared on every operation already.
 */
export function ApiErrorResponses(...codes: ErrorCode[]): MethodDecorator & ClassDecorator {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of new Set(codes)) {
    const { status } = ERROR_CATALOGUE[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  const responses = [...byStatus.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, group]) => ApiResponse(errorResponseFor(status, group)));
  return applyDecorators(...responses);
}
