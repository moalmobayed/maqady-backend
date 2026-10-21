import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { loadConfig } from '../common/config/load-config';
import { serializeError } from '../common/logging/error-serializer';
import {
  buildOpenApiDocument,
  CONTRACT_FILE,
  renderOpenApiYaml,
} from '../common/swagger/openapi-document';

/**
 * Placeholder configuration: the document depends on code only, and nothing here is ever
 * contacted. The app is created but never listens, and Knex connects only on a first query.
 * The secrets are fixed dummies, never used to sign or encrypt anything.
 */
const CONTRACT_CONFIG = loadConfig({
  DATABASE_URL: 'postgres://contract@127.0.0.1:5432/contract',
  DB_SCHEMA: 'maqady',
  CORS_ORIGINS: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
  JWT_SECRET_CUSTOMER: Buffer.alloc(32, 1).toString('base64'),
  JWT_SECRET_STAFF: Buffer.alloc(32, 2).toString('base64'),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  QR_SIGNING_KEY: Buffer.alloc(32, 4).toString('base64'),
  FRONTEND_BASE_URL: 'http://localhost:5173',
  EMAIL_DRIVER: 'simulated',
  // The local driver writes nothing until an upload, and the document never uploads.
  STORAGE_DRIVER: 'local',
});

/** `npm run contract`: writes `contracts/openapi.yaml` from the controllers and DTOs. */
async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot({ config: CONTRACT_CONFIG }),
    { logger: false, bodyParser: false, abortOnError: false },
  );
  try {
    configureApp(app, CONTRACT_CONFIG);
    const document = buildOpenApiDocument(app);
    writeFileSync(CONTRACT_FILE, renderOpenApiYaml(document));
    const paths = Object.keys(document.paths).length;
    console.log(`Wrote ${relative(process.cwd(), CONTRACT_FILE)} (${paths} paths).`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'Contract generation failed',
      err: serializeError(error),
    }),
  );
  process.exit(1);
});
