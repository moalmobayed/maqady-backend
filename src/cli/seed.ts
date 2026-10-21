import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import { API_PREFIX } from '../app.constants';
import { configureApp } from '../app.setup';
import { loadDotenv } from '../common/config/dotenv';
import { loadConfig } from '../common/config/load-config';
import { MigrationRepository } from '../common/database/migration.repository';
import { serializeError } from '../common/logging/error-serializer';
import { runSeed, seedRefusals } from '../modules/seed/seed.command';

/**
 * `npm run seed`: fills the development database at `DATABASE_URL` with realistic Cairo and
 * Giza theaters, people and movies (README "Development seed"). It refuses production, real
 * storage and real email; it boots the real app on 127.0.0.1 at a free port, migrates, then
 * drives the admin API. Safe to run again.
 */
async function main(): Promise<void> {
  loadDotenv();
  // One line per step is the output; the app's request lines would drown it.
  const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn' });
  const refusals = seedRefusals(process.env, config);
  if (refusals.length > 0) throw new Error(`The seed refuses to run:\n- ${refusals.join('\n- ')}`);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ config }), {
    bufferLogs: true,
    bodyParser: false,
    abortOnError: false,
  });
  configureApp(app, config);
  try {
    await app.get(MigrationRepository).migrateLatest();
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    await runSeed(app, `http://127.0.0.1:${port}/${API_PREFIX}`, process.env, (line) =>
      console.log(line),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ level: 'fatal', msg: 'The seed failed', err: serializeError(error) }),
  );
  process.exit(1);
});
