import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIObject } from '@nestjs/swagger';
import { load } from 'js-yaml';
import { buildOpenApiDocument } from '../../../../../src/common/swagger/openapi-document';
import { createTestApp } from '../../../../support/test-app';
import type { TestApp } from '../../../../support/types';

const DRAFT = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'contracts',
  'drafts',
  'home-page.openapi.yaml',
);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The shape of a schema: prose (descriptions, examples) and the default `nullable: false` removed. */
function shapeOf(value: Json | undefined): Json | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((child) => shapeOf(child) as Json);
  if (value === null || typeof value !== 'object') return value;
  const shape: { [key: string]: Json } = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'description' || key === 'example' || key === 'examples') continue;
    if (key === 'nullable' && child === false) continue;
    shape[key] = shapeOf(child) as Json;
  }
  return shape;
}

describe('Theater schemas and operations in the OpenAPI document', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;
  const draft = load(readFileSync(DRAFT, 'utf8')) as OpenAPIObject;

  beforeAll(async () => {
    testApp = await createTestApp({ resetData: false });
    document = buildOpenApiDocument(testApp.app);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it.each(['Phone', 'OpenState', 'Facility'])(
    'publishes %s exactly as the home-page contract agreed with the frontend',
    (name) => {
      expect(shapeOf(document.components?.schemas?.[name] as Json)).toEqual(
        shapeOf(draft.components?.schemas?.[name] as Json),
      );
    },
  );

  it('publishes the #29 postal code and WhatsApp patterns on every theater schema that carries them', () => {
    const schemas = document.components?.schemas as Record<
      string,
      { properties?: Record<string, { pattern?: string }> }
    >;
    const patterns = (field: string): Record<string, string | undefined> =>
      Object.fromEntries(
        Object.entries(schemas)
          .filter(([, schema]) => schema.properties?.[field] !== undefined)
          .map(([name, schema]) => [name, schema.properties![field]!.pattern]),
      );
    const whatsapp = patterns('whatsapp');
    expect(Object.keys(whatsapp).sort()).toEqual(
      ['CreateTheaterRequest', 'PublicTheater', 'TheaterResponse', 'UpdateTheaterRequest'].sort(),
    );
    for (const pattern of Object.values(whatsapp)) expect(pattern).toBe('^\\+[1-9][0-9]{6,14}$');
    for (const pattern of Object.values(patterns('postalCode'))) expect(pattern).toBe('^[0-9]{5}$');
  });

  it('documents the 16 admin theater operations, with their tag and error codes', () => {
    const operations = Object.entries(document.paths)
      // The theater's halls are U5's routes (`Admin: halls`).
      .filter(([path]) => path.startsWith('/admin/theaters') && !path.endsWith('/halls'))
      .flatMap(([path, item]) =>
        Object.entries(
          item as Record<string, { tags?: string[]; summary?: string; description?: string }>,
        )
          .filter(([, operation]) => typeof operation === 'object' && 'responses' in operation)
          .map(([method, operation]) => ({ key: `${method.toUpperCase()} ${path}`, operation })),
      );
    expect(operations).toHaveLength(16);
    for (const { operation } of operations) {
      expect(operation.tags).toEqual(['Admin: theaters']);
      expect(operation.summary).toBeTruthy();
      expect(operation.description).toMatch(/^Admin only/);
    }
    const examples = (path: string, method: string, status: string): string[] => {
      const response = (
        document.paths[path] as Record<string, { responses: Record<string, unknown> }>
      )[method]!.responses[status] as {
        content: Record<string, { examples: Record<string, unknown> }>;
      };
      return Object.keys(response.content['application/json']!.examples);
    };
    expect(examples('/admin/theaters/{id}', 'patch', '409')).toEqual(
      expect.arrayContaining(['CONFLICT', 'THEATER_NOT_PUBLISHABLE']),
    );
    expect(examples('/admin/theaters/{id}', 'delete', '409')).toEqual(['THEATER_NOT_DELETABLE']);
    expect(examples('/admin/theaters/{id}/photos', 'post', '422')).toEqual(
      expect.arrayContaining(['IMAGE_WRONG_SHAPE', 'IMAGE_TOO_MANY_PIXELS']),
    );
    expect(examples('/admin/theaters/{id}', 'get', '403')).toContain('FORBIDDEN');
  });
});
