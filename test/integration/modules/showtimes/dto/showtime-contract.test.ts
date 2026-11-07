import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../../../../../src/common/swagger/openapi-document';
import { createTestApp } from '../../../../support/test-app';
import type { TestApp } from '../../../../support/types';

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  responses: Record<string, { content?: Record<string, { examples: Record<string, unknown> }> }>;
  parameters?: { name: string; in: string; required?: boolean }[];
}

interface Schema {
  required?: string[];
  properties?: Record<string, { nullable?: boolean; enum?: string[]; description?: string }>;
  enum?: string[];
}

describe('Showtime schemas and operations in the OpenAPI document', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;

  const operation = (path: string, method: string): Operation =>
    (document.paths[path] as Record<string, Operation>)[method]!;
  const examples = (path: string, method: string, status: string): string[] =>
    Object.keys(
      operation(path, method).responses[status]?.content?.['application/json']?.examples ?? {},
    );
  const schema = (name: string): Schema => document.components!.schemas![name] as Schema;

  beforeAll(async () => {
    testApp = await createTestApp({ resetData: false });
    document = buildOpenApiDocument(testApp.app);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('documents the 6 admin showtime operations with their tag, prose, idempotency and error codes', () => {
    const operations = Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/admin/showtime'))
      .flatMap(([path, item]) =>
        Object.entries(item as Record<string, Operation>)
          .filter(([, value]) => typeof value === 'object' && 'responses' in value)
          .map(([method, value]) => ({ key: `${method.toUpperCase()} ${path}`, value })),
      );
    expect(operations.map(({ key }) => key).sort()).toEqual(
      [
        'GET /admin/showtimes',
        'POST /admin/showtimes',
        'GET /admin/showtimes/{id}',
        'PATCH /admin/showtimes/{id}',
        'POST /admin/showtime-checks',
        // U14: the impact of a cancellation, read from bookings and payments.
        'GET /admin/showtimes/{id}/cancellation-preview',
      ].sort(),
    );
    for (const { value } of operations) {
      expect(value.tags).toEqual(['Admin: showtimes']);
      expect(value.summary).toBeTruthy();
      expect(value.description).toMatch(/^Admin only/);
      expect(Object.keys(value.responses)).toEqual(expect.arrayContaining(['401', '403', '500']));
    }
    const keyHeader = (path: string, method: string) =>
      operation(path, method).parameters?.find((parameter) => parameter.name === 'Idempotency-Key');
    expect(keyHeader('/admin/showtimes', 'post')).toMatchObject({ in: 'header', required: true });
    expect(keyHeader('/admin/showtimes/{id}', 'patch')).toMatchObject({ required: true });
    // The dry run stores nothing, so it takes no key.
    expect(keyHeader('/admin/showtime-checks', 'post')).toBeUndefined();
    expect(examples('/admin/showtimes', 'post', '400')).toContain('IDEMPOTENCY_KEY_REQUIRED');
    expect(Object.keys(operation('/admin/showtime-checks', 'post').responses)).toContain('200');
    expect(Object.keys(operation('/admin/showtimes', 'post').responses)).toContain('201');

    expect(examples('/admin/showtimes', 'post', '409').sort()).toEqual(
      ['SHOWTIMES_NOT_CREATED', 'SHOWTIME_NOT_SCHEDULABLE'].sort(),
    );
    expect(examples('/admin/showtime-checks', 'post', '409')).toEqual(['SHOWTIME_NOT_SCHEDULABLE']);
    expect(examples('/admin/showtimes/{id}', 'patch', '409').sort()).toEqual(
      ['SHOWTIME_CONFLICT', 'SHOWTIME_NOT_EDITABLE', 'SHOWTIME_NOT_SCHEDULABLE'].sort(),
    );
    expect(examples('/admin/showtimes/{id}', 'patch', '422').sort()).toEqual(
      ['IDEMPOTENCY_KEY_REUSED', 'OUTSIDE_OPENING_HOURS', 'TIME_DOES_NOT_EXIST'].sort(),
    );
  });

  it('publishes ShowtimePrices for the public routes, and the showtime enums', () => {
    expect(schema('ShowtimePrices').required?.sort()).toEqual(['back', 'front', 'middle']);
    expect(schema('ShowtimeStatus').enum).toEqual(['scheduled', 'cancelled']);
    expect(schema('ShowtimeCancelReason').enum).toEqual([
      'technical_issue',
      'print_not_delivered',
      'low_sales',
      'private_event',
    ]);
    expect(schema('ShowtimeCheckResult').enum).toEqual([
      'available',
      'conflict',
      'outside_opening_hours',
      'time_does_not_exist',
      'in_past',
    ]);
  });

  it('describes every property of the showtime responses, with nullability', () => {
    const admin = schema('AdminShowtimeResponse');
    expect(admin.required).toEqual(
      expect.arrayContaining(['id', 'startsAt', 'cinemaDate', 'prices', 'fromPrice', 'movable']),
    );
    for (const name of [
      'AdminShowtimeResponse',
      'AdminShowtimeDetailResponse',
      'ShowtimeTimelineResponse',
      'ShowtimeCheckResponse',
      'DateCheckResponse',
      'ShowtimeBatchResponse',
      'BatchItemResponse',
      'ShowtimeConflictResponse',
      'SuggestedStartResponse',
      'OpeningWindowResponse',
    ]) {
      for (const [property, value] of Object.entries(schema(name).properties ?? {})) {
        expect({ name, property, described: typeof value.description === 'string' }).toEqual({
          name,
          property,
          described: true,
        });
      }
    }
    expect(admin.properties!.cancelReason!.nullable).toBe(true);
    expect(schema('DateCheckResponse').properties!.startsAt!.nullable).toBe(true);
    expect(schema('ShowtimeTimelineResponse').properties!.window!.nullable).toBe(true);
  });
});
