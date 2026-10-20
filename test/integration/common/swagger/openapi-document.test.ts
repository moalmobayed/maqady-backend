import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIObject } from '@nestjs/swagger';
import { load } from 'js-yaml';
import {
  buildOpenApiDocument,
  CONTRACT_FILE,
  renderOpenApiYaml,
} from '../../../../src/common/swagger/openapi-document';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const DRAFT_FILE = join(REPOSITORY_ROOT, 'contracts', 'drafts', 'home-page.openapi.yaml');
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The shape of a schema: annotations (descriptions, examples) and default `nullable: false` removed. */
function shapeOf(value: Json): Json {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value === null || typeof value !== 'object') return value;
  const shape: { [key: string]: Json } = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'description' || key === 'example' || key === 'examples') continue;
    if (key === 'nullable' && child === false) continue;
    shape[key] = shapeOf(child);
  }
  return shape;
}

/** The JSON schema `$ref` of a response, following the draft's `#/components/responses/…` refs. */
function responseSchemaRef(document: OpenAPIObject, response: unknown): string | undefined {
  let resolved = response as {
    $ref?: string;
    content?: Record<string, { schema?: { $ref?: string } }>;
  };
  if (resolved.$ref) {
    const name = resolved.$ref.split('/').pop()!;
    resolved = document.components!.responses![name] as typeof resolved;
  }
  return resolved.content?.['application/json']?.schema?.$ref;
}

describe('OpenAPI document and Swagger UI (integration)', () => {
  let testApp: TestApp;
  let served: OpenAPIObject;
  const draft = load(readFileSync(DRAFT_FILE, 'utf8')) as OpenAPIObject;

  beforeAll(async () => {
    testApp = await createTestApp({ resetData: false });
    const response = await testApp.http().get('/api/docs/openapi.json');
    served = response.body as OpenAPIObject;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('serves Swagger UI at /api/docs', async () => {
    const response = await testApp.http().get('/api/docs');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.text).toContain('<title>Maqady API docs</title>');
    expect(response.text).toContain('swagger-ui-bundle.js');

    const init = await testApp.http().get('/api/docs/swagger-ui-init.js');
    expect(init.status).toBe(200);
    expect(init.text).toContain('"operationId": "getReadiness"');
  });

  it('serves the document at /api/docs/openapi.json, and as YAML', async () => {
    expect(served.openapi).toBe('3.0.3');
    expect(served.info).toEqual(
      expect.objectContaining({ title: 'Maqady API', version: PACKAGE_VERSION }),
    );
    expect(served.info).not.toHaveProperty('contact');
    expect(Object.keys(served.paths)).toEqual(['/health', '/health/ready']);
    expect(served.servers?.map((server) => server.url)).toEqual([
      '/api/v1',
      'http://localhost:3000/api/v1',
    ]);
    expect(Object.keys(served.components?.securitySchemes ?? {})).toEqual(['customer', 'staff']);

    const yaml = await testApp.http().get('/api/docs/openapi.yaml');
    expect(yaml.status).toBe(200);
    expect(load(yaml.text)).toEqual(served);
  });

  describe('matches the contract agreed with the frontend', () => {
    it.each(['HealthResponse', 'ErrorResponse'])('schema %s has the same shape', (name) => {
      const generated = served.components!.schemas![name] as Json;
      const agreed = draft.components!.schemas![name] as Json;
      expect(shapeOf(generated)).toEqual(shapeOf(agreed));
    });

    it.each(['/health', '/health/ready'])('GET %s has the same operation and responses', (path) => {
      const agreed = draft.paths[path]!.get!;
      const generated = served.paths[path]!.get!;
      expect(generated.operationId).toBe(agreed.operationId);
      expect(generated.summary).toBe(agreed.summary);
      expect(generated.tags).toEqual(agreed.tags);
      expect(generated.security).toEqual(agreed.security);
      for (const [status, response] of Object.entries(agreed.responses)) {
        expect(generated.responses).toHaveProperty(status);
        expect(responseSchemaRef(served, generated.responses[status])).toBe(
          responseSchemaRef(draft, response),
        );
      }
    });
  });

  it('documents 500 INTERNAL on every operation, with the shared error schema', () => {
    for (const item of Object.values(served.paths)) {
      expect(responseSchemaRef(served, item.get!.responses['500'])).toBe(
        '#/components/schemas/ErrorResponse',
      );
    }
  });

  it('is what contracts/openapi.yaml holds (run `npm run contract` after changing the API)', () => {
    const committed = readFileSync(CONTRACT_FILE, 'utf8');
    expect(committed).toBe(renderOpenApiYaml(buildOpenApiDocument(testApp.app)));
  });
});
