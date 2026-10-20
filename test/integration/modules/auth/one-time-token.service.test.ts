import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { OneTimeTokenService } from '../../../../src/modules/auth/one-time-token.service';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { createStaffMember } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

describe('OneTimeTokenService (integration)', () => {
  let testApp: TestApp;
  let service: OneTimeTokenService;
  let staffUserId: number;
  const clock = new TestClock();

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    service = testApp.app.get(OneTimeTokenService);
    staffUserId = (await createStaffMember(testApp, { role: 'box_office' })).id;
  });

  afterAll(async () => {
    await testApp.close();
  });

  const owner = () => ({ kind: 'staff', id: staffUserId }) as const;

  it('consumes a token once; the second use is INVALID_TOKEN', async () => {
    const issued = await service.issue({
      purpose: 'staff_invite',
      owner: owner(),
      lifetimeSeconds: 3600,
    });
    await expect(
      service.consume({ purpose: 'staff_invite', token: issued.token }),
    ).resolves.toEqual({
      id: issued.id,
      owner: owner(),
    });
    await expect(
      service.consume({ purpose: 'staff_invite', token: issued.token }),
    ).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('refuses a token of another purpose and an expired one', async () => {
    const issued = await service.issue({
      purpose: 'staff_password_reset',
      owner: owner(),
      lifetimeSeconds: 3600,
    });
    await expect(
      service.consume({ purpose: 'staff_invite', token: issued.token }),
    ).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    clock.advance({ hours: 1 });
    await expect(
      service.consume({ purpose: 'staff_password_reset', token: issued.token }),
    ).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('a new token invalidates the earlier unused one of the same purpose, not other purposes', async () => {
    const reset = await service.issue({
      purpose: 'staff_password_reset',
      owner: owner(),
      lifetimeSeconds: 3600,
    });
    const first = await service.issue({
      purpose: 'staff_invite',
      owner: owner(),
      lifetimeSeconds: 3600,
    });
    const second = await service.issue({
      purpose: 'staff_invite',
      owner: owner(),
      lifetimeSeconds: 3600,
    });

    await expect(
      service.consume({ purpose: 'staff_invite', token: first.token }),
    ).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    await expect(
      service.consume({ purpose: 'staff_invite', token: second.token }),
    ).resolves.toMatchObject({
      id: second.id,
    });
    await expect(
      service.consume({ purpose: 'staff_password_reset', token: reset.token }),
    ).resolves.toMatchObject({
      id: reset.id,
    });
  });

  it('two links issued at the same moment leave only the later one live', async () => {
    const transactions = testApp.app.get(TransactionRepository);
    const input = {
      purpose: 'staff_password_reset',
      owner: owner(),
      lifetimeSeconds: 3600,
    } as const;
    const unusedIds = () =>
      testApp
        .knex('one_time_tokens')
        .pluck('id')
        .where({ staff_user_id: staffUserId, purpose: 'staff_password_reset' })
        .whereNull('used_at');

    // The first issue's transaction stays open (its caller is still sending the email).
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let firstIssued = false;
    const first = transactions.run(async () => {
      const issued = await service.issue(input);
      firstIssued = true;
      await held;
      return issued;
    });
    while (!firstIssued) await new Promise((resolve) => setTimeout(resolve, 10));

    let secondSettled = false;
    const second = service.issue(input).finally(() => (secondSettled = true));
    // Either the second issue queues behind the first, or (the bug) it finishes beside it.
    for (let attempt = 0; attempt < 250 && !secondSettled; attempt += 1) {
      const { rows } = await testApp.knex.raw<{ rows: { waiting: number }[] }>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if ((rows[0]?.waiting ?? 0) >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    release();
    await first;
    const later = await second;

    expect(await unusedIds()).toEqual([later.id]);
  });

  it('lets two concurrent uses of one token succeed exactly once', async () => {
    const issued = await service.issue({
      purpose: 'staff_invite',
      owner: owner(),
      lifetimeSeconds: 3600,
    });
    const results = await Promise.allSettled([
      service.consume({ purpose: 'staff_invite', token: issued.token }),
      service.consume({ purpose: 'staff_invite', token: issued.token }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('stores customer tokens under the customer and refuses a mismatched owner', async () => {
    // `one_time_tokens.customer_id` references customers (U9), so the owner is a real customer.
    const { customerId } = await registerCustomer(testApp);
    const issued = await service.issue({
      purpose: 'verify_email',
      owner: { kind: 'customer', id: customerId },
      lifetimeSeconds: 86_400,
    });
    const [row] = await testApp
      .knex('one_time_tokens')
      .select('staff_user_id', 'customer_id', 'token_hash')
      .where({ id: issued.id });
    expect(row).toMatchObject({ staff_user_id: null, customer_id: customerId });
    expect(row.token_hash).not.toBe(issued.token);
    await expect(
      service.consume({ purpose: 'verify_email', token: issued.token }),
    ).resolves.toEqual({
      id: issued.id,
      owner: { kind: 'customer', id: customerId },
    });
  });
});
