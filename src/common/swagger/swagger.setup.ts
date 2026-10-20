import type { INestApplication } from '@nestjs/common';
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { API_DOCS_JSON_PATH, API_DOCS_PATH, API_DOCS_YAML_PATH } from './swagger.constants';

/** Serves Swagger UI at `/api/docs`, and the document at `/api/docs/openapi.json` (and `.yaml`). */
export function setupSwagger(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: API_DOCS_JSON_PATH,
    yamlDocumentUrl: API_DOCS_YAML_PATH,
    customSiteTitle: 'Maqady API docs',
    swaggerOptions: { displayOperationId: true },
  });
}
