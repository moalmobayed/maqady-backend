import type { INestApplication } from '@nestjs/common';
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { API_DOCS_JSON_PATH, API_DOCS_PATH, API_DOCS_YAML_PATH } from './swagger.constants';

/**
 * The `swagger-ui-dist` files the Swagger UI page loads (`swagger-ui-init.js` is generated).
 * @nestjs/swagger only finds their folder at run time, so a file tracer (Vercel) would ship none
 * of them; resolving each by name here makes the tracer include it.
 */
export const SWAGGER_UI_ASSETS: readonly string[] = [
  require.resolve('swagger-ui-dist/swagger-ui.css'),
  require.resolve('swagger-ui-dist/swagger-ui-bundle.js'),
  require.resolve('swagger-ui-dist/swagger-ui-standalone-preset.js'),
  require.resolve('swagger-ui-dist/favicon-16x16.png'),
  require.resolve('swagger-ui-dist/favicon-32x32.png'),
];

/** Serves Swagger UI at `/api/docs`, and the document at `/api/docs/openapi.json` (and `.yaml`). */
export function setupSwagger(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: API_DOCS_JSON_PATH,
    yamlDocumentUrl: API_DOCS_YAML_PATH,
    customSiteTitle: 'Maqady API docs',
    swaggerOptions: { displayOperationId: true },
  });
}
