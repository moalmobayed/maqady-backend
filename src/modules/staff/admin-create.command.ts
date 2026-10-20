import type { INestApplicationContext } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { MigrationRepository } from '../../common/database/migration.repository';
import { isAllowedPassword } from '../auth/password-policy';
import { PASSWORD_POLICY_MESSAGE } from '../auth/auth.constants';
import { StaffBootstrapService } from './staff-bootstrap.service';
import {
  BOOTSTRAP_ADMIN_VARIABLES,
  EMAIL_MAX_LENGTH,
  STAFF_FULL_NAME_MAX_LENGTH,
} from './staff.constants';
import type { BootstrapAdminParse, BootstrapAdminResult } from './types';

/**
 * Reads the first admin from `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` and
 * `BOOTSTRAP_ADMIN_PASSWORD`. A problem names the variable and the rule, never the value.
 */
export function parseBootstrapAdminEnv(
  env: Readonly<Record<string, string | undefined>>,
): BootstrapAdminParse {
  const email = env[BOOTSTRAP_ADMIN_VARIABLES.email]?.trim() ?? '';
  const fullName = env[BOOTSTRAP_ADMIN_VARIABLES.fullName]?.trim() ?? '';
  const password = env[BOOTSTRAP_ADMIN_VARIABLES.password] ?? '';
  const problems: string[] = [];
  // The same check as the sign-in form's (`StaffSignInRequest`), so the admin can sign in.
  if (email.length > EMAIL_MAX_LENGTH || !isEmail(email)) {
    problems.push(
      `${BOOTSTRAP_ADMIN_VARIABLES.email} must be an email address of at most ${EMAIL_MAX_LENGTH} characters`,
    );
  }
  if (fullName.length === 0 || fullName.length > STAFF_FULL_NAME_MAX_LENGTH) {
    problems.push(
      `${BOOTSTRAP_ADMIN_VARIABLES.fullName} must be 1 to ${STAFF_FULL_NAME_MAX_LENGTH} characters`,
    );
  }
  if (!isAllowedPassword(password)) {
    problems.push(`${BOOTSTRAP_ADMIN_VARIABLES.password}: ${PASSWORD_POLICY_MESSAGE}`);
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, input: { email, fullName, password } };
}

/**
 * `npm run admin:create` (design §10.1): migrates, then creates the first admin unless an active
 * admin exists. Safe to run again, and concurrently. `write` receives the one line of output,
 * which never contains the email or the password.
 */
export async function runAdminCreate(
  app: INestApplicationContext,
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void,
): Promise<BootstrapAdminResult> {
  const parsed = parseBootstrapAdminEnv(env);
  if (!parsed.ok) {
    throw new Error(`Cannot create the first admin:\n- ${parsed.problems.join('\n- ')}`);
  }
  await app.get(MigrationRepository).migrateLatest();
  const result = await app.get(StaffBootstrapService).ensureFirstAdmin(parsed.input);
  write(
    result.created
      ? `Created admin #${result.id}. Sign in at /admin/login, then remove ${BOOTSTRAP_ADMIN_VARIABLES.password} from the environment.`
      : 'An active admin already exists. Nothing changed.',
  );
  return result;
}
