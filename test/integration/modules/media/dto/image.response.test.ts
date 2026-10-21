import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIObject } from '@nestjs/swagger';
import { load } from 'js-yaml';
import { buildOpenApiDocument } from '../../../../../src/common/swagger/openapi-document';
import {
  REAL_RESOLVERS_OFF,
  TestPrincipalResolversModule,
} from '../../../../support/foundations-probe.module';
import { MediaProbeModule } from '../../../../support/media-probe.module';
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

/** The schema without the prose (`description`, `example`), which may differ in wording. */
function structure(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structure);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'description' && key !== 'example')
      .map(([key, child]) => [key, structure(child)]),
  );
}

describe('ImageResponse in the OpenAPI document', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;
  let draft: OpenAPIObject;

  beforeAll(async () => {
    testApp = await createTestApp({
      imports: [MediaProbeModule, TestPrincipalResolversModule],
      overrides: REAL_RESOLVERS_OFF,
      resetData: false,
    });
    document = buildOpenApiDocument(testApp.app);
    draft = load(readFileSync(DRAFT, 'utf8')) as OpenAPIObject;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it.each(['Image', 'ImageVariant'])(
    'publishes %s exactly as the home-page contract agreed with the frontend',
    (name) => {
      expect(structure(document.components?.schemas?.[name])).toEqual(
        structure(draft.components?.schemas?.[name]),
      );
    },
  );

  it('documents an @ImageUpload() route as multipart with the file, its fields and its errors', () => {
    const operation = document.paths['/test-media/owners']?.post;
    const body = operation?.requestBody as {
      required: boolean;
      content: Record<string, { schema: { allOf: object[] } }>;
    };
    expect(Object.keys(body.content)).toEqual(['multipart/form-data']);
    expect(body.content['multipart/form-data']!.schema.allOf).toEqual([
      { $ref: '#/components/schemas/ProbeOwnerFields' },
      expect.objectContaining({
        required: ['file'],
        properties: { file: expect.objectContaining({ type: 'string', format: 'binary' }) },
      }),
    ]);

    const examples = (status: string): string[] =>
      Object.keys(
        (operation?.responses[status] as { content: Record<string, { examples: object }> }).content[
          'application/json'
        ]!.examples,
      );
    expect(examples('400')).toEqual(
      expect.arrayContaining(['VALIDATION_FAILED', 'IDEMPOTENCY_KEY_REQUIRED']),
    );
    expect(examples('413')).toEqual(
      expect.arrayContaining(['IMAGE_TOO_LARGE', 'PAYLOAD_TOO_LARGE']),
    );
    expect(examples('415')).toEqual(['UNSUPPORTED_IMAGE_TYPE']);
    expect(examples('422')).toEqual(
      expect.arrayContaining([
        'IMAGE_TOO_MANY_PIXELS',
        'IMAGE_WRONG_SHAPE',
        'IDEMPOTENCY_KEY_REUSED',
      ]),
    );
    expect(examples('503')).toEqual(['STORAGE_UNAVAILABLE']);
  });
});
