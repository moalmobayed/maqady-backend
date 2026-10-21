import type { INestApplication } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.constants';
import type { AppConfig } from '../../common/config/types';
import { isAllowedPassword } from '../auth/password-policy';
import { Clock } from '../../common/time/clock';
import { cinemaDateOf } from '../../common/time/time';
import { StaffService } from '../staff/staff.service';
import { SeedApiClient } from './seed-api.client';
import {
  DEFAULT_SEED_ADMIN_PASSWORD,
  LOCAL_DATABASE_HOSTS,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_NAME,
  SEED_ADMIN_PASSWORD_VARIABLE,
} from './seed.constants';
import { SEED_STEPS } from './seed.steps';
import type { SeedContext, SeedRefusals, SeedStep } from './types';

/**
 * Why the seed must not run with this environment and configuration: production, a database
 * that is not on this machine, real storage or real email. A development tool never writes to Supabase Storage or sends an email.
 */
export function seedRefusals(
  env: Readonly<Record<string, string | undefined>>,
  config: AppConfig,
): SeedRefusals {
  const refusals: string[] = [];
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') {
    refusals.push('NODE_ENV is production: the seed is for development databases only');
  }
  if (config.storage.driver !== 'local') {
    refusals.push('STORAGE_DRIVER must be local: the seed never uploads to real storage');
  }
  if (config.email.driver !== 'simulated') {
    refusals.push('EMAIL_DRIVER must be simulated: the seed never sends email');
  }
  if (!isLocalDatabase(config.database.url)) {
    refusals.push(
      'DATABASE_URL must point at a local database (localhost, 127.0.0.1, ::1, a Unix socket or a Docker Compose service): the seed creates an admin with a known password',
    );
  }
  const password = env[SEED_ADMIN_PASSWORD_VARIABLE];
  if (password !== undefined && password !== '' && !isAllowedPassword(password)) {
    refusals.push(`${SEED_ADMIN_PASSWORD_VARIABLE} must meet the password policy`);
  }
  return refusals;
}

/**
 * Whether the database is on this machine: a loopback host, a Unix socket (no host) or a
 * single-label host such as a Docker Compose service (`postgres`). A host with a dot is a
 * hosted database, and the seed must never leave its admin with a known password there.
 */
function isLocalDatabase(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return LOCAL_DATABASE_HOSTS.includes(hostname) || /^[a-z0-9-]*$/.test(hostname);
}

/**
 * `npm run seed`: fills a development database with realistic data through the real admin API of
 * the running `app` at `baseUrl`, signed in as the seed admin (created through `StaffService`
 * when missing). Each step is idempotent, so the seed can run again. `write` receives one line
 * per step; no line contains a password or a token.
 */
export async function runSeed(
  app: INestApplication,
  baseUrl: string,
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void,
  steps: readonly SeedStep[] = SEED_STEPS,
): Promise<void> {
  const refusals = seedRefusals(env, app.get<AppConfig>(APP_CONFIG));
  if (refusals.length > 0) throw new Error(`The seed refuses to run:\n- ${refusals.join('\n- ')}`);

  const password = env[SEED_ADMIN_PASSWORD_VARIABLE] || DEFAULT_SEED_ADMIN_PASSWORD;
  const staff = app.get(StaffService);
  if (!(await staff.findByEmail(SEED_ADMIN_EMAIL))) {
    await staff.createActiveMember({
      email: SEED_ADMIN_EMAIL,
      fullName: SEED_ADMIN_NAME,
      role: 'admin',
      password,
    });
    write(`Created the seed admin ${SEED_ADMIN_EMAIL}.`);
  }
  const api = new SeedApiClient(baseUrl);
  await api.signIn(SEED_ADMIN_EMAIL, password);

  const context: SeedContext = {
    api,
    today: cinemaDateOf(app.get(Clock).now()),
    theaterIds: new Map(),
    hallIds: new Map(),
    personIds: new Map(),
    movieIds: new Map(),
  };
  for (const step of steps) {
    const { created, kept } = await step.run(context);
    write(`${step.name}: ${created} created, ${kept} already there`);
  }
  write(`Done. Sign in to the dashboard as ${SEED_ADMIN_EMAIL}.`);
}
