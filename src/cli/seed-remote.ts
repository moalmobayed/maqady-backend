import { serializeError } from '../common/logging/error-serializer';
import { runRemoteSeed } from '../modules/seed/seed.command';

/**
 * `npm run seed:remote`: fills a deployed environment (for example staging) with the development
 * seed through its own admin API (README "Seeding a deployed environment"). It reads only
 * `SEED_API_URL`, `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, never `.env`, so it cannot pick
 * up a local database or key by accident. Safe to run again.
 */
async function main(): Promise<void> {
  await runRemoteSeed(process.env, (line) => console.log(line));
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ level: 'fatal', msg: 'The remote seed failed', err: serializeError(error) }),
  );
  process.exit(1);
});
