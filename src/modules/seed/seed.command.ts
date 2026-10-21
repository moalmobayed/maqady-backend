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
  SEED_API_URL_VARIABLE,
  SEED_REMOTE_ADMIN_EMAIL_VARIABLE,
} from './seed.constants';
import { SEED_STEPS } from './seed.steps';
import type { CalendarDate } from '../../common/time/types';
import type {
  RemoteSeedPlan,
  SeedApi,
  SeedContext,
  SeedHomeDate,
  SeedRefusals,
  SeedStep,
} from './types';

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
  await runSeedSteps(api, cinemaDateOf(app.get(Clock).now()), write, steps);
  write(`Done. Sign in to the dashboard as ${SEED_ADMIN_EMAIL}.`);
}

/**
 * What `npm run seed:remote` would seed, read from `SEED_API_URL`, `SEED_ADMIN_EMAIL` and
 * `SEED_ADMIN_PASSWORD`. The URL must use https, except on this machine, because the admin's
 * password travels in the sign-in request. No refusal echoes a value.
 */
export function remoteSeedPlan(env: Readonly<Record<string, string | undefined>>): RemoteSeedPlan {
  const refusals: string[] = [];
  const baseUrl = remoteBaseUrl(env[SEED_API_URL_VARIABLE], refusals);
  const email = env[SEED_REMOTE_ADMIN_EMAIL_VARIABLE]?.trim() ?? '';
  if (email === '') {
    refusals.push(
      `${SEED_REMOTE_ADMIN_EMAIL_VARIABLE} is required: an admin that already exists there`,
    );
  }
  const password = env[SEED_ADMIN_PASSWORD_VARIABLE] ?? '';
  if (password === '')
    refusals.push(`${SEED_ADMIN_PASSWORD_VARIABLE} is required: that admin's password`);
  return {
    refusals,
    target: refusals.length === 0 && baseUrl !== null ? { baseUrl, email, password } : null,
  };
}

function remoteBaseUrl(raw: string | undefined, refusals: string[]): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') {
    refusals.push(
      `${SEED_API_URL_VARIABLE} is required: the deployed API's base URL, ending in /api/v1`,
    );
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    refusals.push(`${SEED_API_URL_VARIABLE} must be an absolute URL`);
    return null;
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    refusals.push(`${SEED_API_URL_VARIABLE} must carry no credentials, query or fragment`);
    return null;
  }
  const onThisMachine = LOCAL_DATABASE_HOSTS.includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && onThisMachine)) {
    refusals.push(
      `${SEED_API_URL_VARIABLE} must use https (http only on this machine): the admin's password travels in the sign-in request`,
    );
    return null;
  }
  return url.href.replace(/\/+$/, '');
}

/**
 * `npm run seed:remote`: fills a deployed environment with the same data as `npm run seed`,
 * through that deployment's admin API, signed in as one of its existing admins. The server
 * itself stores the images, so no storage key leaves it. Today's cinema date is the server's,
 * from `GET /home`. Each step is idempotent, so it can run again.
 */
export async function runRemoteSeed(
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void,
  steps: readonly SeedStep[] = SEED_STEPS,
): Promise<void> {
  const { refusals, target } = remoteSeedPlan(env);
  if (target === null) {
    throw new Error(`The remote seed refuses to run:\n- ${refusals.join('\n- ')}`);
  }
  const api = new SeedApiClient(target.baseUrl);
  await api.signIn(target.email, target.password);
  const { cinemaDate } = await api.get<SeedHomeDate>('/home');
  await runSeedSteps(api, cinemaDate, write, steps);
  write('Done.');
}

/** Runs each step in order with a fresh context, writing one line per step. */
async function runSeedSteps(
  api: SeedApi,
  today: CalendarDate,
  write: (line: string) => void,
  steps: readonly SeedStep[],
): Promise<void> {
  const context: SeedContext = {
    api,
    today,
    theaterIds: new Map(),
    hallIds: new Map(),
    personIds: new Map(),
    movieIds: new Map(),
  };
  for (const step of steps) {
    const { created, kept } = await step.run(context);
    write(`${step.name}: ${created} created, ${kept} already there`);
  }
}
