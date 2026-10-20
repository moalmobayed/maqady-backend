import { DECORATORS, type OpenAPIObject } from '@nestjs/swagger';
import { EXAMPLE_CORRELATION_ID } from '../../../../src/common/errors/dto/error-response.dto';
import {
  ApiErrorResponses,
  errorResponseFor,
  exampleErrorBody,
} from '../../../../src/common/swagger/error-responses';
import { assertUniqueOperationIds } from '../../../../src/common/swagger/openapi-document';

describe('errorResponseFor', () => {
  it('documents the ErrorResponse schema with one example per code and X-Request-Id', () => {
    const response = errorResponseFor(503, ['SERVICE_UNAVAILABLE']) as Record<string, unknown>;
    expect(response).toMatchObject({
      status: 503,
      headers: { 'X-Request-Id': { schema: { type: 'string', format: 'uuid' } } },
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          examples: {
            SERVICE_UNAVAILABLE: {
              summary: 'SERVICE_UNAVAILABLE',
              value: {
                error: {
                  code: 'SERVICE_UNAVAILABLE',
                  message: 'The service is temporarily unavailable.',
                  details: null,
                  correlationId: EXAMPLE_CORRELATION_ID,
                },
              },
            },
          },
        },
      },
    });
    expect(response.description).toContain('`SERVICE_UNAVAILABLE`:');
    expect(response.headers).not.toHaveProperty('Retry-After');
  });

  it('adds the Retry-After header to a 429', () => {
    const response = errorResponseFor(429, ['RATE_LIMITED']) as {
      headers: Record<string, unknown>;
    };
    expect(response.headers['Retry-After']).toEqual({
      description: 'Seconds to wait before retrying',
      schema: { type: 'integer' },
    });
  });

  it('shows field details in the VALIDATION_FAILED example', () => {
    expect(exampleErrorBody('VALIDATION_FAILED').error.details).toEqual({
      fields: [{ field: 'seats.0.label', messages: ['label must be a string'] }],
    });
  });
});

describe('ApiErrorResponses', () => {
  class Probe {
    @ApiErrorResponses('RATE_LIMITED', 'VALIDATION_FAILED', 'NOT_FOUND', 'VALIDATION_FAILED')
    handler(): void {}
  }

  it('declares one response per status, with each code documented once', () => {
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      Probe.prototype.handler,
    ) as Record<
      string,
      {
        description: string;
        content: { 'application/json': { examples: Record<string, unknown> } };
      }
    >;
    expect(Object.keys(responses).sort()).toEqual(['400', '404', '429']);
    expect(Object.keys(responses['400']!.content['application/json'].examples)).toEqual([
      'VALIDATION_FAILED',
    ]);
    expect(responses['404']!.description).toContain('`NOT_FOUND`:');
  });
});

describe('assertUniqueOperationIds', () => {
  const documentWith = (paths: OpenAPIObject['paths']): OpenAPIObject => ({
    openapi: '3.0.3',
    info: { title: 't', version: '1' },
    paths,
  });

  it('accepts distinct operation ids', () => {
    const document = documentWith({
      '/movies': { get: { operationId: 'listMovies', responses: {} } },
      '/movies/{id}': { get: { operationId: 'getMovie', responses: {} } },
    });
    expect(() => assertUniqueOperationIds(document)).not.toThrow();
  });

  it('names both routes when two share an operation id', () => {
    const document = documentWith({
      '/movies': { get: { operationId: 'list', responses: {} } },
      '/theaters': { get: { operationId: 'list', responses: {} } },
    });
    expect(() => assertUniqueOperationIds(document)).toThrow(
      'Operation id "list" is used by both GET /movies and GET /theaters',
    );
  });
});
