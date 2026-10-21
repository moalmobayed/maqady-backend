import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app.module';
import { loadDotenv } from '../common/config/dotenv';
import { loadConfig } from '../common/config/load-config';
import { serializeError } from '../common/logging/error-serializer';
import { runAdminCreate } from '../modules/staff/admin-create.command';

/**
 * `npm run admin:create`: creates the first admin from `BOOTSTRAP_ADMIN_EMAIL`,
 * `BOOTSTRAP_ADMIN_NAME` and `BOOTSTRAP_ADMIN_PASSWORD` against `DATABASE_URL`, unless an active
 * admin exists. Neither the email nor the password is printed or logged.
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
    await runAdminCreate(app, process.env, (line) => console.log(line));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'Creating the first admin failed',
      err: serializeError(error),
    }),
  );
  process.exit(1);
});
