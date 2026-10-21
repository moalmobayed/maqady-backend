import { ApiProperty } from '@nestjs/swagger';
import type { ErrorBody } from '../types';

/** Example correlation id used throughout the API documentation. */
export const EXAMPLE_CORRELATION_ID = '0b6f2c5e-7d41-4a8e-9a0a-2c1f6e9d3b11';

/**
 * The one error shape (design §14.3), registered once as the `ErrorResponse` schema. The nested
 * `error` object is declared inline so the schema matches the contract agreed with the frontend.
 */
export class ErrorResponse {
  @ApiProperty({
    type: 'object',
    description: 'The error. Every Maqady error response has exactly this shape.',
    selfRequired: true,
    required: ['code', 'message', 'details', 'correlationId'],
    properties: {
      code: {
        type: 'string',
        nullable: false,
        description: 'Stable machine-readable code, for example RATE_LIMITED',
        example: 'NOT_FOUND',
      },
      message: {
        type: 'string',
        nullable: false,
        description: "Human-readable; don't parse it",
        example: 'The requested resource was not found.',
      },
      details: {
        type: 'object',
        nullable: true,
        additionalProperties: true,
        description: 'Extra structured information; its shape depends on the code',
        example: null,
      },
      correlationId: {
        type: 'string',
        format: 'uuid',
        nullable: false,
        description: 'Equals the X-Request-Id response header. Quote it when reporting a problem.',
        example: EXAMPLE_CORRELATION_ID,
      },
    },
  })
  error!: ErrorBody;
}
