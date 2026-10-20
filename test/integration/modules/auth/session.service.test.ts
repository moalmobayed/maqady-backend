import { sha256Hex } from '../../../../src/common/crypto/hashing';
import { SessionService } from '../../../../src/modules/auth/session.service';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { createStaffMember } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

describe('SessionService (integration)', () => {
  let testApp: TestApp;
  const clock = new TestClock();

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('a sign-out racing a refresh of the same family also revokes the token that refresh issued', async () => {
    const member = await createStaffMember(testApp, { role: 'box_office' });
    const sessions = testApp.app.get(SessionService);
    const opened = await sessions.open({
      owner: { audience: 'staff', id: member.id },
      lifetimeSeconds: 3600,
    });

    // A refresh in flight, done by hand: it holds the head row and has inserted the next token.
    const refresh = await testApp.knex.transaction();
    let nextId: number;
    try {
      await refresh('sessions').select('id').where({ id: opened.sessionId }).forUpdate();
      const now = clock.now();
      const [next] = await refresh('sessions')
        .insert({
          family_id: opened.familyId,
          staff_user_id: member.id,
          customer_id: null,
          token_hash: sha256Hex('next-token'),
          created_at: now,
          expires_at: opened.expiresAt,
        })
        .returning<{ id: number }[]>('id');
      nextId = next!.id;
      await refresh('sessions')
        .update({ rotated_at: now, replaced_by_id: nextId })
        .where({ id: opened.sessionId });

      const signOut = sessions.revokeFamilyOf(opened.sessionId, 'sign_out');
      await waitForLockWaiters(testApp.knex, 1);
      await refresh.commit();
      await expect(signOut).resolves.toBe(2);
    } catch (error) {
      if (!refresh.isCompleted()) await refresh.rollback();
      throw error;
    }

    const rows = await testApp
      .knex('sessions')
      .select('id', 'revoked_reason')
      .where({ family_id: opened.familyId })
      .orderBy('id');
    expect(rows).toEqual([
      { id: opened.sessionId, revoked_reason: 'sign_out' },
      { id: nextId, revoked_reason: 'sign_out' },
    ]);
  });

  it('revokes every session of an owner and leaves other owners alone', async () => {
    const first = await createStaffMember(testApp, { role: 'box_office' });
    const second = await createStaffMember(testApp, { role: 'box_office' });
    const sessions = testApp.app.get(SessionService);
    for (const id of [first.id, first.id, second.id]) {
      await sessions.open({ owner: { audience: 'staff', id }, lifetimeSeconds: 3600 });
    }
    await expect(
      sessions.revokeAllFor({ audience: 'staff', id: first.id }, 'account_deactivated'),
    ).resolves.toBe(2);
    const live = await testApp
      .knex('sessions')
      .pluck('staff_user_id')
      .whereNull('revoked_at')
      .whereIn('staff_user_id', [first.id, second.id]);
    expect(live).toEqual([second.id]);
  });

  it('keeps customer sessions in their own column, refreshable only for the customer audience', async () => {
    const sessions = testApp.app.get(SessionService);
    const opened = await sessions.open({
      owner: { audience: 'customer', id: 77 },
      lifetimeSeconds: 2_592_000,
    });
    await expect(
      sessions.refresh({
        audience: 'staff',
        refreshToken: opened.refreshToken,
        assertOwnerLive: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      sessions.refresh({
        audience: 'customer',
        refreshToken: opened.refreshToken,
        assertOwnerLive: () => Promise.resolve(),
      }),
    ).resolves.toMatchObject({ ownerId: 77, expiresAt: opened.expiresAt });
  });
});
