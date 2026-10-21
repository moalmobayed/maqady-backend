import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { StaffAuthService } from '../../../../src/modules/staff/staff-auth.service';
import { StaffService } from '../../../../src/modules/staff/staff.service';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { createStaffMember, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

// Real scrypt hashing on every sign-in.
jest.setTimeout(60_000);

describe('StaffAuthService (integration)', () => {
  let testApp: TestApp;
  const clock = new TestClock();

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('a sign-in racing the deactivation of its member is refused and leaves no live session', async () => {
    const admin = await staffSession(testApp, 'admin');
    const member = await createStaffMember(testApp, { role: 'box_office' });
    const actor = {
      kind: 'staff',
      id: admin.staffUserId,
      sessionId: admin.sessionId,
      role: 'admin',
    } as const;

    // The deactivation, as PATCH /admin/staff/{id} runs it, held open before its commit.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let deactivated!: () => void;
    const changed = new Promise<void>((resolve) => (deactivated = resolve));
    const deactivation = testApp.app.get(TransactionRepository).run(async () => {
      await testApp.app.get(StaffService).updateMember(actor, member.id, { status: 'deactivated' });
      deactivated();
      await gate;
    });
    await changed;

    // The sign-in still reads the member as active (the change is not committed yet).
    const signIn = testApp.app
      .get(StaffAuthService)
      .signIn({ email: member.email, password: member.password });
    await waitForLockWaiters(testApp.knex, 1);
    release();

    const [signedIn, change] = await Promise.allSettled([signIn, deactivation]);
    expect(change.status).toBe('fulfilled');
    expect(signedIn.status === 'rejected' ? signedIn.reason : 'signed in').toMatchObject({
      code: 'ACCOUNT_DEACTIVATED',
    });
    const live = await testApp
      .knex('sessions')
      .pluck('id')
      .where({ staff_user_id: member.id })
      .whereNull('revoked_at');
    expect(live).toEqual([]);
  });
});
