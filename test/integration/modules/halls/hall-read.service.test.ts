import type { Knex } from 'knex';
import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import { layoutSeats } from '../../../../src/modules/halls/hall-layout';
import { TestClock } from '../../../support/clock';
import { waitForLockWaiters } from '../../../support/database';
import { addActiveHall, createHall, HALLS, setHallStatus } from '../../../support/halls';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { createTheater } from '../../../support/theaters';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const LAYOUT = {
  rowCount: 4,
  seatsPerRow: 8,
  rowZones: ['front', 'middle', 'middle', 'back'],
  seatMarks: [
    { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
    { rowLabel: 'B', seatNumber: 4, kind: 'no_seat' },
  ],
};

describe('HallReadService (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let reads: HallReadService;
  const clock = new TestClock(new Date('2026-10-16T12:00:00+03:00'));

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

  const putLayout = (hallId: number, body: object) =>
    testApp
      .http()
      .put(`${HALLS}/${hallId}/layout`)
      .set('Authorization', admin.authorization)
      .send(body);

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    reads = testApp.app.get(HallReadService);
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

  it('reads a hall and its layout in any status; null for an unknown one', async () => {
    const theaterId = await createTheater(testApp, admin.authorization);
    const id = await createHall(testApp, admin.authorization, theaterId, 'Hall 1');
    expect((await putLayout(id, LAYOUT)).status).toBe(200);
    await setHallStatus(testApp, admin.authorization, id, 'retired');

    expect(await reads.findById(id)).toEqual({
      id,
      theaterId,
      name: 'Hall 1',
      status: 'retired',
      rowCount: 4,
      seatsPerRow: 8,
      seatCount: 31,
      wheelchairCount: 1,
      zoneSeatCounts: { front: 8, middle: 15, back: 8 },
      createdAt: new Date('2026-10-16T12:00:00+03:00'),
      updatedAt: new Date('2026-10-16T12:00:00+03:00'),
    });
    const layout = await reads.findLayout(id);
    expect(layout).toEqual(
      expect.objectContaining({
        hallId: id,
        theaterId,
        aisleAfter: [4],
        rows: [
          { index: 0, label: 'A', zone: 'front' },
          { index: 1, label: 'B', zone: 'middle' },
          { index: 2, label: 'C', zone: 'middle' },
          { index: 3, label: 'D', zone: 'back' },
        ],
        seatMarks: [
          { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
          { rowLabel: 'B', seatNumber: 4, kind: 'no_seat' },
        ],
      }),
    );
    const seats = layoutSeats(layout!);
    expect(seats).toHaveLength(31);
    expect(seats.map((seat) => seat.label)).not.toContain('B4');
    expect(await reads.findById(999)).toBeNull();
    expect(await reads.findLayout(999)).toBeNull();
  });

  it('lists the halls of many theaters by name, filtered by status, in a fixed number of queries', async () => {
    const first = await createTheater(testApp, admin.authorization);
    const second = await createTheater(testApp, admin.authorization);
    const empty = await createTheater(testApp, admin.authorization);
    await createHall(testApp, admin.authorization, first, 'hall c');
    const active = await createHall(testApp, admin.authorization, first, 'Hall B');
    await setHallStatus(testApp, admin.authorization, active, 'active');
    await createHall(testApp, admin.authorization, first, 'Hall A');
    await addActiveHall(testApp, admin.authorization, second);

    const all = await reads.listByTheaters([first, second, empty]);
    // By name, ignoring letter case (CITEXT).
    expect(all.get(first)!.map((hall) => hall.name)).toEqual(['Hall A', 'Hall B', 'hall c']);
    expect(all.get(second)).toHaveLength(1);
    expect(all.get(empty)).toEqual([]);
    const onlyActive = await reads.listByTheaters([first, second], ['active']);
    expect(onlyActive.get(first)?.map((hall) => hall.name)).toEqual(['Hall B']);
    expect(onlyActive.get(second)?.map((hall) => hall.status)).toEqual(['active']);

    const one = await queriesOf(() => reads.listByTheaters([second]));
    const layoutsOfOne = await queriesOf(() => reads.findLayouts([1]));
    for (let index = 0; index < 9; index += 1)
      await createHall(testApp, admin.authorization, second);
    const ids = (await reads.listByTheaters([second])).get(second)!.map((hall) => hall.id);
    expect(ids).toHaveLength(10);
    expect(await queriesOf(() => reads.listByTheaters([first, second]))).toBe(one);
    expect((await reads.findLayouts(ids)).size).toBe(10);
    expect(await queriesOf(() => reads.findLayouts(ids))).toBe(layoutsOfOne);
    expect(one).toBe(3);
  });

  it('holds the hall FOR SHARE, so a layout save waits for the lock holder and then succeeds', async () => {
    const theaterId = await createTheater(testApp, admin.authorization);
    const id = await createHall(testApp, admin.authorization, theaterId);
    const transactions = testApp.app.get(TransactionRepository);
    await expect(reads.lockForShare(id)).rejects.toThrow(/open transaction/);

    let releaseLock!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let locked: unknown;
    const holder = transactions.run(async () => {
      locked = await reads.lockForShare(id);
      await held;
    });
    const events: string[] = [];
    await waitForLockWaiters(testApp.knex, 0);
    const saving = putLayout(id, LAYOUT).then((response) => {
      events.push(`saved ${response.status}`);
      return response;
    });
    await waitForLockWaiters(testApp.knex, 1);
    events.push('released');
    releaseLock();
    const [, saved] = await Promise.all([holder, saving]);

    expect(locked).toEqual(expect.objectContaining({ id, seatCount: 192, status: 'draft' }));
    expect(events).toEqual(['released', 'saved 200']);
    expect(saved.body.seatCount).toBe(31);
    await expect(transactions.run(() => reads.lockForShare(999))).resolves.toBeNull();
  });
});
