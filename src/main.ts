import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadDotenv } from './common/config/dotenv';
import { loadConfig } from './common/config/load-config';
import { MigrationRepository } from './common/database/migration.repository';
import { serializeError } from './common/logging/error-serializer';

/**
 * Boot order: validate the environment, create the app, migrate the database, then listen.
 * A bad environment or a failed migration stops the process before it serves anything.
 */
async function bootstrap(): Promise<void> {
  loadDotenv();
  const config = loadConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ config }), {
    bufferLogs: true,
    bodyParser: false,
    abortOnError: false,
  });
  configureApp(app, config);
  app.enableShutdownHooks();

  await app.get(MigrationRepository).migrateLatest();
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`Listening on port ${config.port}`);
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet, so the failure is written as one JSON line by hand.
  console.error(
    JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      msg: 'Boot failed',
      err: serializeError(error),
    }),
  );
  process.exit(1);
});
