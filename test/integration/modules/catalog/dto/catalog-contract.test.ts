import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
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

/**
 * The schema without its prose (`description`, `example`) and with a lone `allOf: [$ref]` read
 * as the `$ref` it wraps: @nestjs/swagger wraps every enum reference that way so the property
 * keeps its description (OpenAPI 3.0 ignores siblings of `$ref`), which is the same shape.
 */
function structure(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structure);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value).filter(
    ([key, child]) =>
      key !== 'description' && key !== 'example' && !(key === 'nullable' && child === false),
  );
  const shape = Object.fromEntries(entries.map(([key, child]) => [key, structure(child)]));
  const keys = Object.keys(shape);
  const allOf = shape.allOf as unknown[] | undefined;
  if (keys.length === 1 && keys[0] === 'allOf' && Array.isArray(allOf) && allOf.length === 1) {
    return allOf[0];
  }
  return shape;
}

describe('The catalog in the OpenAPI document', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;
  let draft: OpenAPIObject;

  beforeAll(async () => {
    testApp = await createTestApp({ resetData: false });
    document = buildOpenApiDocument(testApp.app);
    draft = load(readFileSync(DRAFT, 'utf8')) as OpenAPIObject;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it.each(['GenreRef', 'Video', 'VideoKind', 'AgeRating'])(
    'publishes %s exactly as the home-page contract agreed with the frontend',
    (name) => {
      expect(document.components?.schemas?.[name]).toBeDefined();
      expect(structure(document.components?.schemas?.[name])).toEqual(
        structure(draft.components?.schemas?.[name]),
      );
    },
  );

  it('documents the 23 admin catalog operations, each with a summary, a description and its errors', () => {
    const operations: [string, OperationObject][] = Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/admin/movies') || path.startsWith('/admin/people'))
      .flatMap(([path, item]) =>
        Object.entries(item as Record<string, OperationObject>).map(
          ([method, operation]) =>
            [`${method.toUpperCase()} ${path}`, operation] as [string, OperationObject],
        ),
      );
    expect(operations).toHaveLength(23);
    for (const [name, operation] of operations) {
      expect({ name, tags: operation.tags }).toEqual({
        name,
        tags: [name.includes('/admin/people') ? 'Admin: people' : 'Admin: movies'],
      });
      expect(operation.summary).toBeTruthy();
      expect(operation.description).toContain('Admin only');
      expect(operation.security).toEqual([{ staff: [] }]);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['401', '403', '429']),
      );
    }
    const examples = (path: string, method: 'patch' | 'delete', status: string): string[] =>
      Object.keys(
        (
          (document.paths[path] as Record<string, OperationObject>)[method]!.responses[status] as {
            content: Record<string, { examples: object }>;
          }
        ).content['application/json']!.examples,
      );
    expect(examples('/admin/movies/{id}', 'patch', '409')).toEqual(
      expect.arrayContaining([
        'CONFLICT',
        'MOVIE_NOT_PUBLISHABLE',
        'MOVIE_NOT_FEATURABLE',
        'FEATURED_POSITION_TAKEN',
      ]),
    );
    expect(examples('/admin/movies/{id}', 'delete', '409')).toEqual(['MOVIE_NOT_DELETABLE']);
  });
});
