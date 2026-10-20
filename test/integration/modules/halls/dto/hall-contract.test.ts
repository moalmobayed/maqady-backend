import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../../../../../src/common/swagger/openapi-document';
import { createTestApp } from '../../../../support/test-app';
import type { TestApp } from '../../../../support/types';

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  responses: Record<string, { content?: Record<string, { examples: Record<string, unknown> }> }>;
  'x-idempotency-key'?: string;
}

interface Schema {
  required?: string[];
  properties?: Record<string, unknown>;
}

describe('Hall schemas and operations in the OpenAPI document', () => {
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

  it('documents the 7 admin hall operations with their tag, prose and error codes', () => {
    const operations = Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/admin/halls') || path.endsWith('/halls'))
      .flatMap(([path, item]) =>
        Object.entries(item as Record<string, Operation>)
          .filter(([, value]) => typeof value === 'object' && 'responses' in value)
          .map(([method, value]) => ({ key: `${method.toUpperCase()} ${path}`, value })),
      );
    expect(operations.map(({ key }) => key).sort()).toEqual(
      [
        'GET /admin/theaters/{id}/halls',
        'POST /admin/theaters/{id}/halls',
        'GET /admin/halls/{id}',
        'PATCH /admin/halls/{id}',
        'DELETE /admin/halls/{id}',
        'GET /admin/halls/{id}/layout',
        'PUT /admin/halls/{id}/layout',
      ].sort(),
    );
    for (const { value } of operations) {
      expect(value.tags).toEqual(['Admin: halls']);
      expect(value.summary).toBeTruthy();
      expect(value.description).toMatch(/^Admin only/);
      expect(Object.keys(value.responses)).toEqual(expect.arrayContaining(['401', '403', '500']));
    }
    expect(examples('/admin/halls/{id}/layout', 'put', '409')).toEqual(
      expect.arrayContaining(['CONFLICT', 'HALL_IN_USE']),
    );
    expect(examples('/admin/halls/{id}/layout', 'put', '400')).toContain('VALIDATION_FAILED');
    expect(examples('/admin/halls/{id}', 'patch', '409')).toEqual(
      expect.arrayContaining(['CONFLICT', 'HALL_NOT_RETIRABLE']),
    );
    expect(examples('/admin/halls/{id}', 'delete', '409')).toEqual(['HALL_NOT_DELETABLE']);
    expect(examples('/admin/theaters/{id}/halls', 'post', '409')).toEqual(['CONFLICT']);
  });

  it('publishes the HallLayout schema the seat maps reuse, and the hall enums', () => {
    expect(schema('HallLayout').required).toEqual(
      expect.arrayContaining([
        'hallId',
        'rowCount',
        'seatsPerRow',
        'aisleAfter',
        'rows',
        'seatMarks',
        'seatCount',
        'wheelchairCount',
        'zoneSeatCounts',
        'updatedAt',
      ]),
    );
    expect(schema('HallLayoutRow').properties?.zone).toEqual(
      expect.objectContaining({ allOf: [{ $ref: '#/components/schemas/SeatZone' }] }),
    );
    expect(document.components!.schemas!.SeatZone).toEqual(
      expect.objectContaining({ enum: ['front', 'middle', 'back'] }),
    );
    expect(document.components!.schemas!.SeatMarkKind).toEqual(
      expect.objectContaining({ enum: ['wheelchair', 'no_seat'] }),
    );
    expect(document.components!.schemas!.HallStatus).toEqual(
      expect.objectContaining({ enum: ['draft', 'active', 'retired'] }),
    );
    expect(schema('HallResponse').required).toEqual(expect.arrayContaining(['deletable']));
    expect(schema('HallResponsePage').required).toEqual(['items', 'nextCursor', 'total']);
  });
});
