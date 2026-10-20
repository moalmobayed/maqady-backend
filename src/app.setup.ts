import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import {
  API_PREFIX,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  CORS_MAX_AGE_SECONDS,
  CORS_METHODS,
  JSON_BODY_LIMIT,
  TRUSTED_PROXY_HOPS,
} from './app.constants';
import type { AppConfig } from './common/config/types';
import { buildOpenApiDocument } from './common/swagger/openapi-document';
import { setupSwagger } from './common/swagger/swagger.setup';

/**
 * The HTTP settings shared by `main.ts`, `npm run contract` and the test app.
 *
 * Create the app with `bodyParser: false`: this registers the only body parser, JSON with a
 * 1 MB limit, so form-encoded bodies are never parsed.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
  app.use(
    helmet({
      // Render serves HTTPS (with HSTS); without this directive Swagger UI also loads over plain
      // HTTP, from localhost or a LAN address during development.
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  app.enableCors({
    origin: [...config.corsOrigins],
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: CORS_EXPOSED_HEADERS,
    credentials: false,
    maxAge: CORS_MAX_AGE_SECONDS,
  });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.setGlobalPrefix(API_PREFIX);
  setupSwagger(app, buildOpenApiDocument(app));
}
