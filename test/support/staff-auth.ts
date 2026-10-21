import { randomUUID } from 'node:crypto';
import type { StaffRole } from '../../src/common/auth/types';
import { StaffAuthService } from '../../src/modules/staff/staff-auth.service';
import { StaffService } from '../../src/modules/staff/staff.service';
import type { CreatedStaffMember, StaffMemberFixture, StaffSession, TestApp } from './types';

/**
 * Real staff members and real tokens for integration tests of admin routes (U2a). Everything
 * goes through the real services and the database; nothing is signed by hand. Sign-in here calls
 * the service, not the HTTP route, so it never meets the sign-in rate limit.
 *
 * @example
 * const admin = await staffSession(testApp, 'admin');
 * await testApp.http().get('/api/v1/admin/staff').set('Authorization', admin.authorization);
 */

/** The password `createStaffMember()` sets unless told otherwise; it meets the policy. */
export const DEFAULT_STAFF_PASSWORD = 'Passw0rd-staff';

/** An active staff member of `role`, with a unique email unless one is given. */
export async function createStaffMember(
  testApp: TestApp,
  fixture: StaffMemberFixture,
): Promise<CreatedStaffMember> {
  const unique = randomUUID().slice(0, 8);
  const email =
    fixture.email ?? `staff-${fixture.role.replace('_', '-')}-${unique}@test.maqady.local`;
  const password = fixture.password ?? DEFAULT_STAFF_PASSWORD;
  const member = await testApp.app.get(StaffService).createActiveMember({
    email,
    fullName: fixture.fullName ?? `Test ${fixture.role} ${unique}`,
    role: fixture.role,
    password,
  });
  return { id: member.id, email: member.email, password, role: member.role };
}

/** Signs an existing member in through the real service: a new session and its tokens. */
export async function signInStaff(
  testApp: TestApp,
  email: string,
  password: string,
): Promise<StaffSession> {
  const { tokens } = await testApp.app.get(StaffAuthService).signIn({ email, password });
  return {
    staffUserId: tokens.staffUserId,
    sessionId: tokens.sessionId,
    email,
    password,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    authorization: `Bearer ${tokens.accessToken}`,
  };
}

/** A new active member of `role`, signed in. */
export async function staffSession(
  testApp: TestApp,
  role: StaffRole,
  fixture: Omit<StaffMemberFixture, 'role'> = {},
): Promise<StaffSession> {
  const member = await createStaffMember(testApp, { ...fixture, role });
  return signInStaff(testApp, member.email, member.password);
}
