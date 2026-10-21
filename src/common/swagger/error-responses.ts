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
  MOVIE_NOT_PUBLISHABLE: { missing: ['synopsis', 'genres'] },
  MOVIE_NOT_FEATURABLE: { reasons: ['no_hero_video'] },
  FEATURED_POSITION_TAKEN: { position: 1, movieId: 12 },
  MOVIE_NOT_DELETABLE: { reasons: ['has_bookings'] },
  THEATER_NOT_PUBLISHABLE: { missing: ['prices', 'hours'] },
  THEATER_NOT_DELETABLE: { reasons: ['not_draft'] },
  HALL_IN_USE: {
    showtimes: [{ id: 81, startsAt: '2026-10-16T19:30:00+03:00', movieTitle: 'The Nile Light' }],
  },
  HALL_NOT_DELETABLE: { reasons: ['has_showtimes'] },
  HALL_NOT_RETIRABLE: { reasons: ['has_future_showtimes'] },
  SHOWTIME_CONFLICT: {
    conflicts: [
      {
        showtimeId: 81,
        movieTitle: 'The Nile Light',
        startsAt: '2026-10-16T19:30:00+03:00',
        endsAt: '2026-10-16T21:38:00+03:00',
        cleaningEndsAt: '2026-10-16T21:58:00+03:00',
      },
    ],
  },
  SHOWTIME_NOT_SCHEDULABLE: { reasons: ['movie_not_now_showing'] },
  SHOWTIMES_NOT_CREATED: {
    results: [
      {
        cinemaDate: '2026-10-16',
        result: 'conflict',
        conflicts: [
          {
            showtimeId: 81,
            movieTitle: 'The Nile Light',
            startsAt: '2026-10-16T19:30:00+03:00',
            endsAt: '2026-10-16T21:38:00+03:00',
            cleaningEndsAt: '2026-10-16T21:58:00+03:00',
          },
        ],
      },
      { cinemaDate: '2026-10-17', result: 'outside_opening_hours', conflicts: [] },
    ],
  },
  SHOWTIME_NOT_EDITABLE: { reason: 'started' },
  TICKET_NOT_AVAILABLE: { status: 'held' },
  SHOWTIME_NOT_BOOKABLE: { reason: 'sales_paused' },
  OUTSIDE_OPENING_HOURS: {
    window: { opensAt: '2026-10-16T12:00:00+03:00', closesAt: '2026-10-17T01:00:00+03:00' },
  },
  TIME_DOES_NOT_EXIST: { date: '2026-04-24', time: '00:30', cinemaDate: '2026-04-23' },
  IMAGE_TOO_LARGE: { maxBytes: 10485760 },
  UNSUPPORTED_IMAGE_TYPE: { allowed: ['jpeg', 'png'] },
  IMAGE_TOO_MANY_PIXELS: { maxPixels: 40000000, width: 8000, height: 6000 },
  IMAGE_WRONG_SHAPE: {
    kind: 'poster',
    aspect: '2:3',
    minWidth: 400,
    minHeight: 600,
    width: 1200,
    height: 1200,
  },
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
