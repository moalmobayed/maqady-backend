import type { Response } from 'supertest';
import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { OneTimeTokenService } from '../../../../src/modules/auth/one-time-token.service';
import { StaffService } from '../../../../src/modules/staff/staff.service';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { listHttpRoutes, samplePath } from '../../../support/routes';
import { createStaffMember, signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { StaffSession, TestApp } from '../../../support/types';

// The project-level `testTimeout` in jest.config.js is not applied (Jest reads it globally), and
// these suites hash real passwords with scrypt, so they set their own.
jest.setTimeout(60_000);

const STAFF = '/api/v1/admin/staff';
const ME = '/api/v1/admin/me';

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

describe('Staff management routes (integration)', () => {
  let testApp: TestApp;
  const clock = new TestClock();

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** Empties the staff tables (and what references them) so each test sees only its members. */
  async function resetStaff(): Promise<void> {
    await testApp.knex.raw(
      'TRUNCATE TABLE one_time_tokens, sessions, audit_events, idempotency_keys, staff_users RESTART IDENTITY CASCADE',
    );
  }

  const activeAdminCount = async (): Promise<number> => {
    const [row] = await testApp
      .knex('staff_users')
      .count<{ n: number }[]>({ n: 'id' })
      .where({ role: 'admin', status: 'active' });
    return row!.n;
  };

  const patch = (session: StaffSession, id: number, body: object) =>
    testApp.http().patch(`${STAFF}/${id}`).set('Authorization', session.authorization).send(body);

  describe('GET /admin/staff', () => {
    let admin: StaffSession;

    beforeAll(async () => {
      await resetStaff();
      admin = await staffSession(testApp, 'admin', { fullName: 'Zeina Admin' });
      await createStaffMember(testApp, { role: 'box_office', fullName: 'Badr Hassan' });
      await createStaffMember(testApp, { role: 'box_office', fullName: 'Amal Samir' });
      await createStaffMember(testApp, { role: 'admin', fullName: 'Badr Hassan' });
      const gone = await createStaffMember(testApp, { role: 'box_office', fullName: 'Dina Fawzy' });
      await testApp.knex('staff_users').update({ status: 'deactivated' }).where({ id: gone.id });
    });

    const list = (query: string) =>
      testApp.http().get(`${STAFF}${query}`).set('Authorization', admin.authorization);

    it('pages through every member by name then id, with nextCursor and total', async () => {
      const names: string[] = [];
      const ids: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response = await list(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        expect(response.status).toBe(200);
        expect(response.body.total).toBe(5);
        names.push(...(response.body.items as { fullName: string }[]).map((item) => item.fullName));
        ids.push(...(response.body.items as { id: number }[]).map((item) => item.id));
        cursor = response.body.nextCursor;
        pages += 1;
      } while (cursor !== null);

      expect(pages).toBe(3);
      expect(names).toEqual([
        'Amal Samir',
        'Badr Hassan',
        'Badr Hassan',
        'Dina Fawzy',
        'Zeina Admin',
      ]);
      // The two members with one name come in id order, and nobody repeats.
      expect(ids[1]).toBeLessThan(ids[2]!);
      expect(new Set(ids).size).toBe(5);
    });

    it('returns the columns of the Staff screen and never a password hash', async () => {
      const response = await list('?limit=100');
      const zeina = (response.body.items as { id: number }[]).find(
        (item: { id: number }) => item.id === admin.staffUserId,
      );
      expect(zeina).toEqual({
        id: admin.staffUserId,
        fullName: 'Zeina Admin',
        email: admin.email,
        role: 'admin',
        status: 'active',
        lastSignInAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[23]:00$/),
        createdAt: expect.stringMatching(/\+0[23]:00$/),
      });
      const never = (
        response.body.items as { fullName: string; lastSignInAt: string | null }[]
      ).find((item: { fullName: string }) => item.fullName === 'Amal Samir');
      expect(never?.lastSignInAt).toBeNull();
      expect(JSON.stringify(response.body)).not.toContain('scrypt');
    });

    it('filters by role and status, with total counting the same filter', async () => {
      const boxOffice = await list('?role=box_office');
      expect(boxOffice.body.total).toBe(3);
      expect(
        (boxOffice.body.items as { role: string }[]).every((item) => item.role === 'box_office'),
      ).toBe(true);

      const deactivated = await list('?status=deactivated&role=box_office');
      expect(deactivated.body).toEqual({
        items: [expect.objectContaining({ fullName: 'Dina Fawzy', status: 'deactivated' })],
        nextCursor: null,
        total: 1,
      });
    });

    it('refuses unknown filters, a bad limit and a tampered cursor', async () => {
      expectError(await list('?role=owner'), 400, 'VALIDATION_FAILED');
      expectError(await list('?limit=101'), 400, 'VALIDATION_FAILED');
      expectError(await list('?sort=name'), 400, 'VALIDATION_FAILED');
      const numericCursor = Buffer.from(JSON.stringify([5, 1])).toString('base64url');
      expectError(await list(`?cursor=${numericCursor}`), 400, 'VALIDATION_FAILED');
    });
  });

  describe('PATCH /admin/staff/{id}', () => {
    let admin: StaffSession;

    beforeEach(async () => {
      await resetStaff();
      admin = await staffSession(testApp, 'admin');
    });

    it('changes a role and audits only the changed field name', async () => {
      const member = await createStaffMember(testApp, { role: 'box_office' });
      const response = await patch(admin, member.id, { role: 'admin', status: 'active' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: member.id, role: 'admin', status: 'active' });
      const audits = await testApp
        .knex('audit_events')
        .select('actor_staff_user_id', 'entity_id', 'changed_fields', 'metadata')
        .where({ action: 'staff_user.updated' });
      expect(audits).toEqual([
        {
          actor_staff_user_id: admin.staffUserId,
          entity_id: member.id,
          changed_fields: ['role'],
          metadata: { role: 'admin', status: 'active' },
        },
      ]);
    });

    it('a change to nothing answers 200 and writes nothing', async () => {
      const member = await createStaffMember(testApp, { role: 'box_office' });
      const response = await patch(admin, member.id, { role: 'box_office' });
      expect(response.status).toBe(200);
      expect(
        await testApp
          .knex('audit_events')
          .count({ n: 'id' })
          .where({ action: 'staff_user.updated' }),
      ).toEqual([{ n: 0 }]);
    });

    it('answers NOT_FOUND for an unknown member and VALIDATION_FAILED for a bad id or body', async () => {
      expectError(await patch(admin, 999_999, { role: 'admin' }), 404, 'NOT_FOUND');
      expectError(
        await testApp
          .http()
          .patch(`${STAFF}/abc`)
          .set('Authorization', admin.authorization)
          .send({ role: 'admin' }),
        400,
        'VALIDATION_FAILED',
      );
      const empty = await patch(admin, admin.staffUserId, {});
      expectError(empty, 400, 'VALIDATION_FAILED');
      expect(empty.body.error.details.fields).toEqual([
        { field: 'role', messages: expect.arrayContaining(['send role, status or both']) },
      ]);
      expectError(
        await patch(admin, admin.staffUserId, { status: 'invited' }),
        400,
        'VALIDATION_FAILED',
      );
      expectError(await patch(admin, admin.staffUserId, { role: null }), 400, 'VALIDATION_FAILED');
      expectError(
        await patch(admin, admin.staffUserId, { email: 'x@y.z' }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('refuses to demote or deactivate the only active admin with LAST_ADMIN', async () => {
      expectError(await patch(admin, admin.staffUserId, { role: 'box_office' }), 409, 'LAST_ADMIN');
      expectError(
        await patch(admin, admin.staffUserId, { status: 'deactivated' }),
        409,
        'LAST_ADMIN',
      );
      expect(await activeAdminCount()).toBe(1);
      expect((await testApp.http().get(ME).set('Authorization', admin.authorization)).status).toBe(
        200,
      );
    });

    it('deactivation takes effect on the next request, ends refreshes and voids unused links', async () => {
      const member = await staffSession(testApp, 'box_office');
      const link = await testApp.app.get(OneTimeTokenService).issue({
        purpose: 'staff_password_reset',
        owner: { kind: 'staff', id: member.staffUserId },
        lifetimeSeconds: 3600,
      });
      expect((await testApp.http().get(ME).set('Authorization', member.authorization)).status).toBe(
        200,
      );

      const response = await patch(admin, member.staffUserId, { status: 'deactivated' });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('deactivated');

      expectError(
        await testApp.http().get(ME).set('Authorization', member.authorization),
        403,
        'ACCOUNT_DEACTIVATED',
      );
      expectError(
        await testApp
          .http()
          .post('/api/v1/admin/auth/tokens')
          .send({ refreshToken: member.refreshToken }),
        403,
        'ACCOUNT_DEACTIVATED',
      );
      const revoked = await testApp
        .knex('sessions')
        .pluck('revoked_reason')
        .where({ staff_user_id: member.staffUserId });
      expect(revoked).toEqual(['account_deactivated']);
      await expect(
        testApp.app
          .get(OneTimeTokenService)
          .consume({ purpose: 'staff_password_reset', token: link.token }),
      ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('demotion signs the member out; signed in again, they are box office and refused on admin routes', async () => {
      const other = await staffSession(testApp, 'admin');
      expect(
        (await testApp.http().get(STAFF).set('Authorization', other.authorization)).status,
      ).toBe(200);

      expect((await patch(admin, other.staffUserId, { role: 'box_office' })).status).toBe(200);
      expectError(
        await testApp.http().get(STAFF).set('Authorization', other.authorization),
        401,
        'SESSION_REVOKED',
      );

      const again = await signInStaff(testApp, other.email, other.password);
      expectError(
        await testApp.http().get(STAFF).set('Authorization', again.authorization),
        403,
        'FORBIDDEN',
      );
      const profile = await testApp.http().get(ME).set('Authorization', again.authorization);
      expect(profile.body.role).toBe('box_office');
    });

    it('a role change applies on the next request even without a new sign-in (role read from the database)', async () => {
      const other = await staffSession(testApp, 'box_office');
      expectError(
        await testApp.http().get(STAFF).set('Authorization', other.authorization),
        403,
        'FORBIDDEN',
      );
      expect((await patch(admin, other.staffUserId, { role: 'admin' })).status).toBe(200);
      expect(
        (await testApp.http().get(STAFF).set('Authorization', other.authorization)).status,
      ).toBe(200);
    });

    it('reactivates: a member with a password becomes active, one who never set it returns to invited', async () => {
      const member = await createStaffMember(testApp, { role: 'box_office' });
      await patch(admin, member.id, { status: 'deactivated' });
      const back = await patch(admin, member.id, { status: 'active' });
      expect(back.body.status).toBe('active');
      expect((await signInStaff(testApp, member.email, member.password)).accessToken).toBeTruthy();

      const now = clock.now();
      const [invited] = await testApp
        .knex('staff_users')
        .insert({
          email: 'never-set@maqady.example',
          full_name: 'Never Set',
          role: 'box_office',
          status: 'invited',
          password_hash: null,
          created_at: now,
          updated_at: now,
        })
        .returning<{ id: number }[]>('id');
      expectError(await patch(admin, invited!.id, { status: 'active' }), 400, 'VALIDATION_FAILED');
      expect((await patch(admin, invited!.id, { status: 'deactivated' })).body.status).toBe(
        'deactivated',
      );
      expect((await patch(admin, invited!.id, { status: 'active' })).body.status).toBe('invited');
    });

    it('two concurrent demotions of the last two admins leave exactly one (service level)', async () => {
      const second = await createStaffMember(testApp, { role: 'admin' });
      const staff = testApp.app.get(StaffService);
      const transactions = testApp.app.get(TransactionRepository);
      const actor = {
        kind: 'staff',
        id: admin.staffUserId,
        sessionId: admin.sessionId,
        role: 'admin',
      } as const;

      // Hold both admin rows, so the two changes start together and queue on the same lock.
      const gate = await testApp.knex.transaction();
      await gate('staff_users')
        .select('id')
        .whereIn('id', [admin.staffUserId, second.id])
        .forUpdate();
      const racing = Promise.allSettled([
        transactions.run(() =>
          staff.updateMember(actor, admin.staffUserId, { role: 'box_office' }),
        ),
        transactions.run(() => staff.updateMember(actor, second.id, { status: 'deactivated' })),
      ]);
      await waitForLockWaiters(testApp.knex, 2);
      await gate.commit();
      const results = await racing;

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.reason).toMatchObject({ code: 'LAST_ADMIN' });
      expect(await activeAdminCount()).toBe(1);
    });

    it('two admins demoting each other at the same moment leave exactly one admin, over 10 rounds', async () => {
      const second = await createStaffMember(testApp, { role: 'admin' });
      for (let round = 0; round < 10; round += 1) {
        await testApp
          .knex('staff_users')
          .update({ role: 'admin', status: 'active' })
          .whereIn('id', [admin.staffUserId, second.id]);
        const first = await signInStaff(testApp, admin.email, admin.password);
        const other = await signInStaff(testApp, second.email, second.password);

        const responses = await Promise.all([
          patch(first, second.id, { role: 'box_office' }),
          patch(other, admin.staffUserId, { role: 'box_office' }),
        ]);

        const statuses = responses.map((response) => response.status);
        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
        // The loser either lost the lock (LAST_ADMIN) or was already signed out by the winner.
        const loser = responses.find((response) => response.status !== 200)!;
        expect(['LAST_ADMIN', 'SESSION_REVOKED']).toContain(loser.body.error.code);
        expect(await activeAdminCount()).toBe(1);
      }
    });
  });

  describe('access', () => {
    it('every Admin route, enumerated from the Nest router, refuses a box-office token with FORBIDDEN', async () => {
      const boxOffice = await staffSession(testApp, 'box_office');
      const adminRoutes = listHttpRoutes(testApp).filter((route) => route.access === 'admin');

      expect(adminRoutes.map((route) => `${route.method} ${route.path}`)).toEqual(
        expect.arrayContaining([
          'GET /api/v1/admin/staff',
          'PATCH /api/v1/admin/staff/:id',
          'POST /api/v1/admin/staff',
          'POST /api/v1/admin/staff/:id/invitations',
          'GET /api/v1/admin/messages',
          'GET /api/v1/admin/messages/:id',
        ]),
      );
      for (const route of adminRoutes) {
        const response = await testApp
          .http()
          [route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](
            samplePath(route.path),
          )
          .set('Authorization', boxOffice.authorization)
          .send({});
        expect({
          route: route.handler,
          status: response.status,
          code: response.body?.error?.code,
        }).toEqual({
          route: route.handler,
          status: 403,
          code: 'FORBIDDEN',
        });
      }
    });

    it('every staff and admin route refuses a request without a token', async () => {
      const routes = listHttpRoutes(testApp).filter(
        (route) => route.access === 'admin' || route.access === 'staff',
      );
      expect(routes.length).toBeGreaterThanOrEqual(4);
      for (const route of routes) {
        const response = await testApp
          .http()
          [route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](
            samplePath(route.path),
          )
          .send({});
        expectError(response, 401, 'UNAUTHENTICATED');
      }
    });
  });
});
