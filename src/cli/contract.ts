import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import type { AppConfig } from '../common/config/types';
import { serializeError } from '../common/logging/error-serializer';
import {
  buildOpenApiDocument,
  CONTRACT_FILE,
  renderOpenApiYaml,
} from '../common/swagger/openapi-document';

/**
 * Placeholder configuration: the document depends on code only, and nothing here is ever
 * contacted. The app is created but never listens, and Knex connects only on a first query.
 */
const CONTRACT_CONFIG: AppConfig = {
  port: 3000,
  logLevel: 'silent',
  corsOrigins: ['http://localhost:5173'],
  database: { url: 'postgres://contract@127.0.0.1:5432/contract', schema: 'maqady' },
};

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
