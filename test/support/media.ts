import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { AccessTokenService } from '../../src/common/auth/access-token.service';
import type { StaffPrincipal } from '../../src/common/auth/types';
import { TestPrincipalResolvers } from './foundations-probe.module';
import { createStaffMember } from './staff-auth';
import type { TestApp } from './types';

/**
 * Helpers of the media integration suites (U4a).
 *
 * `mediaAdmin()` is the one place these suites get a staff token. The staff member is real (a
 * `staff_users` row from `createStaffMember()`, which `images.created_by_staff_id` must reference
 * since U4b added `fk_images_created_by_staff_id`), and the token is resolved by U1's test
 * resolvers (`TestPrincipalResolversModule`): the suites pass `overrides: REAL_RESOLVERS_OFF` to
 * switch U2a's real staff resolver off.
 */
export async function mediaAdmin(
  testApp: TestApp,
): Promise<{ principal: StaffPrincipal; authorization: string }> {
  const { id } = await createStaffMember(testApp, { role: 'admin' });
  const sessionId = 7000 + id;
  const principal: StaffPrincipal = { kind: 'staff', id, sessionId, role: 'admin' };
  testApp.app.get(TestPrincipalResolvers).set('staff', sessionId, principal);
  const token = testApp.app
    .get(AccessTokenService)
    .sign({ audience: 'staff', subjectId: id, sessionId });
  return { principal, authorization: `Bearer ${token}` };
}

/** A new, empty directory for the local storage driver of one suite. */
export function mediaDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'maqady-media-it-'));
}

export async function removeMediaDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

/** Every file under the directory, as storage paths (`poster/<uuid>/small.webp`), sorted. */
export async function storedFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else found.push(relative(directory, path).split(sep).join('/'));
    }
  };
  await walk(directory);
  return found.sort();
}
