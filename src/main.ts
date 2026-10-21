import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadDotenv } from './common/config/dotenv';
import { loadConfig } from './common/config/load-config';
import { MigrationRepository } from './common/database/migration.repository';
import { serializeError } from './common/logging/error-serializer';
import { bootstrapAdminRequested, runAdminCreate } from './modules/staff/admin-create.command';

/**
 * Boot order: validate the environment, create the app, migrate the database, then create the
 * first admin when `BOOTSTRAP_ADMIN_PASSWORD` is set (hosts with no shell). A bad environment, a
 * failed migration or a bad bootstrap admin stops the process before it serves anything.
 */
async function createApp(): Promise<NestExpressApplication> {
  loadDotenv();
  const config = loadConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ config }), {
    bufferLogs: true,
    bodyParser: false,
    abortOnError: false,
  });
  configureApp(app, config);

  await app.get(MigrationRepository).migrateLatest();
  if (bootstrapAdminRequested(process.env)) {
    await runAdminCreate(app, process.env, (line) => new Logger('Bootstrap').log(line));
  }
  return app;
}

/** A server, a container or a developer machine: boot, then listen on `PORT`. */
async function bootstrap(): Promise<void> {
  const app = await createApp();
  app.enableShutdownHooks();
  const { port } = loadConfig(process.env);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Listening on port ${port}`);
}

/** The failure is written as one JSON line by hand: the logger may not exist yet. */
function exitOnBootFailure(error: unknown): never {
  console.error(
    JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      msg: 'Boot failed',
      err: serializeError(error),
    }),
  );
  process.exit(1);
}

let vercelListener: Promise<RequestListener> | undefined;

/**
 * Vercel (README "Deploying to Vercel") calls this default export once per request instead of
 * using a listening server: its launcher waits only a second for `listen()`, and booting takes
 * longer (migrations, the first admin). The app boots once, on the first request; concurrent
 * first requests share that boot.
 */
export default function handleVercelRequest(req: IncomingMessage, res: ServerResponse): void {
  vercelListener ??= createApp().then(async (app) => {
    await app.init();
    return app.getHttpAdapter().getInstance() as RequestListener;
  });
  vercelListener.then((listener) => listener(req, res), exitOnBootFailure);
}

/**
 * Vercel's launcher wraps a plain function with its own request helpers (a parsed `req.body`, its
 * own `res.send`), which would clash with Express's, unless the function has a `listen` method,
 * as an Express app does. This handler hands each request to Express, so it opts out the same
 * way. Vercel never calls it.
 */
handleVercelRequest.listen = (): never => {
  throw new Error('handleVercelRequest only serves requests; Vercel runs the server');
};

if (process.env.VERCEL !== '1') {
  bootstrap().catch(exitOnBootFailure);
}
