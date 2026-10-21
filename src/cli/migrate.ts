import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app.module';
import { loadDotenv } from '../common/config/dotenv';
import { loadConfig } from '../common/config/load-config';
import { MigrationRepository } from '../common/database/migration.repository';
import { serializeError } from '../common/logging/error-serializer';

/**
 * `npm run migrate`: applies pending migrations to `DATABASE_URL` and exits. The service also
 * migrates on every boot, so this is for running migrations without starting the server.
 */
async function main(): Promise<void> {
  loadDotenv();
  const config = loadConfig(process.env);
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ config }), {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  try {
    const { applied } = await app.get(MigrationRepository).migrateLatest();
    console.log(
      applied.length === 0 ? 'Already up to date.' : `Applied ${applied.length} migration(s).`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ level: 'fatal', msg: 'Migration failed', err: serializeError(error) }),
  );
  process.exit(1);
});
