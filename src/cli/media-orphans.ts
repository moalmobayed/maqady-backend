import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app.module';
import { loadDotenv } from '../common/config/dotenv';
import { loadConfig } from '../common/config/load-config';
import { serializeError } from '../common/logging/error-serializer';
import { runMediaOrphans } from '../modules/media/media-orphans.command';

/**
 * `npm run media:orphans [-- --delete]`: lists stored image files that no `images` row points
 * to, and removes them with `--delete` (design §9). It only tidies up; run it by hand.
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
    await runMediaOrphans(app, process.argv.slice(2), (line) => console.log(line));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ level: 'fatal', msg: 'media:orphans failed', err: serializeError(error) }),
  );
  process.exit(1);
});
