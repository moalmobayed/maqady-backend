import type { Knex } from 'knex';
import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { TheaterReadService } from '../../../../src/modules/theaters/theater-read.service';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import {
  TheaterLifecycleProbe,
  TheaterLifecycleProbeModule,
} from '../../../support/theaters-probe.module';
import {
  createTheater,
  DEFAULT_PRICES,
  prepareTheater,
  setTheaterStatus,
  THEATERS,
} from '../../../support/theaters';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

describe('TheaterReadService (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let reads: TheaterReadService;
  let probe: TheaterLifecycleProbe;
  const clock = new TestClock(new Date('2026-10-16T12:00:00+03:00'));

  const publish = async (id: number) => {
    await prepareTheater(testApp, admin.authorization, id);
    probe.withActiveHall.add(id);
    await setTheaterStatus(testApp, admin.authorization, id, 'active');
  };

  /** How many statements `fn` sends to the database. */
  const queriesOf = async (fn: () => Promise<unknown>): Promise<number> => {
    let count = 0;
    const listener = () => {
      count += 1;
    };
    const knex: Knex = testApp.knex;
    knex.on('query', listener);
    try {
      await fn();
    } finally {
      knex.removeListener('query', listener);
    }
    return count;
  };

  beforeAll(async () => {
    testApp = await createTestApp({ clock, imports: [TheaterLifecycleProbeModule] });
    reads = testApp.app.get(TheaterReadService);
    probe = testApp.app.get(TheaterLifecycleProbe);
    admin = await staffSession(testApp, 'admin');
  });

  beforeEach(async () => {
    await testApp.knex.raw(
      'TRUNCATE theaters, audit_events, idempotency_keys RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('lists only active theaters, by name, with their phones and facilities', async () => {
    const zamalek = await createTheater(testApp, admin.authorization, { name: 'Maqady Zamalek' });
    const maadi = await createTheater(testApp, admin.authorization, { name: 'Maqady Maadi' });
    const draft = await createTheater(testApp, admin.authorization, { name: 'Maqady Draft' });
    const paused = await createTheater(testApp, admin.authorization, { name: 'Maqady Paused' });
    for (const id of [zamalek, maadi, paused]) await publish(id);
    await setTheaterStatus(testApp, admin.authorization, paused, 'sales_paused');
    await testApp
      .http()
      .put(`${THEATERS}/${zamalek}/phones`)
      .set('Authorization', admin.authorization)
      .send({ phones: [{ label: 'Box office', number: '+20227351100' }] });
    await testApp
      .http()
      .put(`${THEATERS}/${zamalek}/facilities`)
      .set('Authorization', admin.authorization)
      .send({ facilities: ['cafe_bar', 'free_parking'] });

    const active = await reads.listActive();
    expect(active.map((theater) => theater.name)).toEqual(['Maqady Maadi', 'Maqady Zamalek']);
    expect(active[1]).toEqual(
      expect.objectContaining({
        id: zamalek,
        status: 'active',
        phones: [{ label: 'Box office', number: '+20227351100' }],
        facilities: ['free_parking', 'cafe_bar'],
        cover: null,
        photos: [],
        defaultPrices: {
          front: DEFAULT_PRICES.front,
          middle: DEFAULT_PRICES.middle,
          back: DEFAULT_PRICES.back,
        },
      }),
    );
    expect(await reads.findActive(draft)).toBeNull();
    expect(await reads.findActive(paused)).toBeNull();
    expect((await reads.findActive(maadi))?.name).toBe('Maqady Maadi');
    expect([...(await reads.findActiveByIds([zamalek, draft, paused, 999])).keys()]).toEqual([
      zamalek,
    ]);
    expect((await reads.findById(draft))?.status).toBe('draft');
    expect(await reads.findById(999)).toBeNull();
  });

  it('reads 1 or 10 active theaters in the same number of queries', async () => {
    const first = await createTheater(testApp, admin.authorization, { name: 'Theater 0' });
    await publish(first);
    const one = await queriesOf(() => reads.listActive());
    for (let index = 1; index < 10; index += 1) {
      await publish(
        await createTheater(testApp, admin.authorization, { name: `Theater ${index}` }),
      );
    }
    expect((await reads.listActive()).length).toBe(10);
    expect(await queriesOf(() => reads.listActive())).toBe(one);
  });

  it('holds the theater FOR SHARE, so a theater write waits for the lock holder', async () => {
    const id = await createTheater(testApp, admin.authorization);
    await prepareTheater(testApp, admin.authorization, id);
    probe.withActiveHall.add(id);
    const transactions = testApp.app.get(TransactionRepository);
    await expect(reads.lockForShare(id)).rejects.toThrow(/open transaction/);

    let releaseLock!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockedSummary: unknown;
    const holder = transactions.run(async () => {
      lockedSummary = await reads.lockForShare(id);
      await held;
    });
    const events: string[] = [];
    await waitForLockWaiters(testApp.knex, 0);
    const publishing = setTheaterStatus(testApp, admin.authorization, id, 'active').then(() =>
      events.push('published'),
    );
    await waitForLockWaiters(testApp.knex, 1);
    events.push('released');
    releaseLock();
    await Promise.all([holder, publishing]);

    expect(lockedSummary).toEqual({
      id,
      name: expect.any(String),
      status: 'draft',
      defaultPrices: expect.objectContaining({ front: DEFAULT_PRICES.front }),
    });
    expect(events).toEqual(['released', 'published']);
  });
});
