import { SessionService } from '../../../../src/modules/auth/session.service';
import { StaffService } from '../../../../src/modules/staff/staff.service';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

jest.setTimeout(60_000);

describe('StaffService (integration)', () => {
  let testApp: TestApp;
  const clock = new TestClock();

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('deactivating a member while their refresh is in flight neither deadlocks nor leaves the new token live', async () => {
    const admin = await staffSession(testApp, 'admin');
    const member = await staffSession(testApp, 'box_office');
    const actor = {
      kind: 'staff',
      id: admin.staffUserId,
      sessionId: admin.sessionId,
      role: 'admin',
    } as const;

    // The real refresh, paused once it holds the presented row and checked the member: the next
    // step inserts the new session row, whose foreign key reads the member's row.
    let reached!: () => void;
    const atCheck = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const refresh = testApp.app.get(SessionService).refresh({
      audience: 'staff',
      refreshToken: member.refreshToken,
      assertOwnerLive: async () => {
        reached();
        await gate;
      },
    });
    await atCheck;

    // The deactivation locks the member's row, then queues on the session row the refresh holds.
    const deactivation = testApp.app
      .get(StaffService)
      .updateMember(actor, member.staffUserId, { status: 'deactivated' });
    await waitForLockWaiters(testApp.knex, 1);
    release();

    const [refreshed, deactivated] = await Promise.allSettled([refresh, deactivation]);
    expect(refreshed.status === 'rejected' ? refreshed.reason : null).toBeNull();
    expect(deactivated.status === 'rejected' ? deactivated.reason : null).toBeNull();

    const live = await testApp
      .knex('sessions')
      .pluck('id')
      .where({ staff_user_id: member.staffUserId })
      .whereNull('revoked_at');
    expect(live).toEqual([]);
  });
});
