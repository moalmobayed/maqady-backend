import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../../../../../src/common/swagger/openapi-document';
import {
  loadHomePageDraft,
  referencedSchemaNames,
  schemaStructure,
} from '../../../../support/discovery';
import { createTestApp } from '../../../../support/test-app';
import type { TestApp } from '../../../../support/types';

const DISCOVERY_OPERATIONS = [
  'GET /home',
  'GET /genres',
  'GET /movies',
  'GET /movies/{id}',
  'GET /movies/{id}/similar',
  'GET /movies/{id}/showtimes',
  'GET /people',
  'GET /theaters',
  'GET /theaters/{id}',
  'GET /theaters/{id}/showtimes',
];

describe('Discovery in the OpenAPI document', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;
  const draft = loadHomePageDraft();

  beforeAll(async () => {
    testApp = await createTestApp({ resetData: false });
    document = buildOpenApiDocument(testApp.app);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const homeSchemas = referencedSchemaNames(draft, 'HomeResponse');

  it('reaches the whole home page from HomeResponse in the draft', () => {
    expect(homeSchemas).toEqual(
      expect.arrayContaining([
        'HomeResponse',
        'FeaturedMovie',
        'FeaturedMovieDetails',
        'MovieCard',
        'MovieCardList',
        'TickerItem',
        'GenreRef',
        'GenreWithCount',
        'Video',
        'Image',
        'ImageVariant',
        'TheaterCard',
        'OpenState',
        'Phone',
        'AgeRating',
        'MovieStatus',
        'VideoKind',
        'Facility',
      ]),
    );
    expect(homeSchemas).toHaveLength(18);
  });

  it.each(homeSchemas)(
    'publishes %s exactly as the home-page contract agreed with the frontend',
    (name) => {
      expect(document.components?.schemas?.[name]).toBeDefined();
      expect(schemaStructure(document.components?.schemas?.[name])).toEqual(
        schemaStructure(draft.components?.schemas?.[name]),
      );
    },
  );

  it('publishes GET /home as the draft does: id, tag, no security, the HomeResponse and its errors', () => {
    const generated = (document.paths['/home'] as Record<string, OperationObject>).get!;
    const agreed = (draft.paths['/home'] as Record<string, OperationObject>).get!;
    expect(Object.keys(document.paths['/home']!)).toEqual(['get']);
    expect(generated.operationId).toBe(agreed.operationId);
    expect(generated.tags).toEqual(agreed.tags);
    expect(generated.security).toEqual(agreed.security);
    expect(generated.parameters ?? []).toEqual(agreed.parameters ?? []);
    expect(Object.keys(generated.responses).sort()).toEqual(Object.keys(agreed.responses).sort());
    const ok = generated.responses['200'] as {
      headers: Record<string, unknown>;
      content: Record<string, { schema: unknown }>;
    };
    const agreedOk = agreed.responses['200'] as typeof ok;
    expect(ok.content['application/json']!.schema).toEqual(
      agreedOk.content['application/json']!.schema,
    );
    expect(Object.keys(ok.headers)).toEqual(Object.keys(agreedOk.headers));
    for (const status of ['429', '500', '503']) {
      const error = generated.responses[status] as {
        content: Record<string, { schema: unknown }>;
      };
      expect(error.content['application/json']!.schema).toEqual({
        $ref: '#/components/schemas/ErrorResponse',
      });
    }
  });

  it('documents every discovery operation as public, tagged, described and with its errors', () => {
    const operations = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.entries(item as Record<string, OperationObject>)
        .filter(([, operation]) => operation.tags?.includes('Discovery'))
        .map(([method, operation]) => ({ key: `${method.toUpperCase()} ${path}`, operation })),
    );
    expect(operations.map(({ key }) => key).sort()).toEqual([...DISCOVERY_OPERATIONS].sort());
    for (const { key, operation } of operations) {
      expect({ key, tags: operation.tags }).toEqual({ key, tags: ['Discovery'] });
      expect(operation.summary).toBeTruthy();
      expect(operation.description).toMatch(/^Public/);
      expect(operation.security).toEqual([]);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['200', '429', '500', '503']),
      );
      if (key.includes('{id}')) expect(Object.keys(operation.responses)).toContain('404');
    }
  });
});
