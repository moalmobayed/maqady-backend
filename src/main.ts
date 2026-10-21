import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadDotenv } from './common/config/dotenv';
import { loadConfig } from './common/config/load-config';
import { MigrationRepository } from './common/database/migration.repository';
import { ERROR_CATALOGUE } from './common/errors/error-catalogue';
import { serializeError } from './common/logging/error-serializer';
import { bootstrapAdminRequested, runAdminCreate } from './modules/staff/admin-create.command';

/**
 * Boot order: validate the environment, create the app, migrate the database, then create the
 * first admin when `BOOTSTRAP_ADMIN_PASSWORD` is set (hosts with no shell). A bad environment, a
 * failed migration or a bad bootstrap admin stops the process before it serves anything.
 */
async function createApp(): Promise<NestExpressApplication> {
  bootStep('loading configuration');
  loadDotenv();
  const config = loadConfig(process.env);

  bootStep('creating the app');
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ config }), {
    bufferLogs: true,
    bodyParser: false,
    abortOnError: false,
  });
  configureApp(app, config);

  bootStep('migrating the database');
  await app.get(MigrationRepository).migrateLatest();
  if (bootstrapAdminRequested(process.env)) {
    bootStep('checking the first admin');
    await runAdminCreate(app, process.env, (line) => new Logger('Bootstrap').log(line));
  }
  return app;
}

let currentBootStep = 'not started';

/**
 * One unbuffered JSON line per boot step. The app's own logs are buffered until it is ready, so
 * these show where a boot that hangs or fails got to.
 */
function bootStep(step: string): void {
  currentBootStep = step;
  console.log(
    JSON.stringify({ level: 'info', time: new Date().toISOString(), msg: `Boot: ${step}` }),
  );
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
function logBootFailure(error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      msg: 'Boot failed',
      step: currentBootStep,
      err: serializeError(error),
    }),
  );
}

function exitOnBootFailure(error: unknown): never {
  logBootFailure(error);
  process.exit(1);
}

/** How long a request waits for the first boot before it is answered 503 (boot carries on). */
const VERCEL_BOOT_WAIT_MS = 20_000;

let vercelListener: Promise<RequestListener> | undefined;

function bootForVercel(): Promise<RequestListener> {
  const boot = createApp().then(async (app) => {
    await app.init();
    bootStep('ready');
    return app.getHttpAdapter().getInstance() as RequestListener;
  });
  // A failed boot is logged once and forgotten, so the next request boots again.
  boot.catch((error: unknown) => {
    logBootFailure(error);
    vercelListener = undefined;
  });
  return boot;
}

/** The catalogue's 503, in the shape every error response has. */
function answerUnavailable(res: ServerResponse): void {
  if (res.headersSent) return;
  const correlationId = randomUUID();
  res.statusCode = ERROR_CATALOGUE.SERVICE_UNAVAILABLE.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Retry-After', '5');
  res.setHeader('X-Request-Id', correlationId);
  res.end(
    JSON.stringify({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: ERROR_CATALOGUE.SERVICE_UNAVAILABLE.message,
        details: null,
        correlationId,
      },
    }),
  );
}

/**
 * Serves one request on Vercel (README "Deploying to Vercel"). The app boots once, on the first
 * request; concurrent first requests share that boot. A request never hangs on it: a failed boot
 * answers 503 and is retried by the next request, and a boot still running after
 * `VERCEL_BOOT_WAIT_MS` answers 503 while it carries on. The process never exits, since Vercel
 * would leave the request open.
 */
function handleVercelRequest(req: IncomingMessage, res: ServerResponse): void {
  vercelListener ??= bootForVercel();
  const waited = setTimeout(() => {
    console.error(
      JSON.stringify({
        level: 'warn',
        time: new Date().toISOString(),
        msg: `Boot still running after ${VERCEL_BOOT_WAIT_MS} ms`,
        step: currentBootStep,
      }),
    );
    answerUnavailable(res);
  }, VERCEL_BOOT_WAIT_MS);
  vercelListener.then(
    (listener) => {
      clearTimeout(waited);
      if (!res.headersSent) listener(req, res);
    },
    () => {
      clearTimeout(waited);
      answerUnavailable(res);
    },
  );
}

if (process.env.VERCEL === '1') {
  // Vercel's launcher captures the server this module starts listening while it is imported,
  // and forwards each request to it. It waits only a second for that `listen()`, and booting
  // takes longer, so the server listens at once and the app boots on the first request.
  createServer(handleVercelRequest).listen(Number(process.env.PORT ?? 3000));
} else {
  bootstrap().catch(exitOnBootFailure);
}
