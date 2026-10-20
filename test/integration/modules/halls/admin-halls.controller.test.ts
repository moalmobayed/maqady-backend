import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { TestClock } from '../../../support/clock';
import {
  addActiveHall,
  createHall,
  HALLS,
  setHallStatus,
  theaterHallsPath,
} from '../../../support/halls';
import { HallLifecycleProbe, HallsProbeModule } from '../../../support/halls-probe.module';
import { listHttpRoutes, samplePath } from '../../../support/routes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { createTheater, prepareTheater, THEATERS } from '../../../support/theaters';
import type { StaffSession, TestApp } from '../../../support/types';

// Real staff sign-ins hash passwords with scrypt.
jest.setTimeout(60_000);

const NOW = new Date('2026-10-16T12:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

interface AuditRow {
  action: string;
  entity_id: number;
  actor_staff_user_id: number;
  changed_fields: string[];
  metadata: Record<string, unknown>;
}

interface StoredLayout {
  hall: { row_count: number; seats_per_row: number };
  rows: { row_index: number; row_label: string; zone: string }[];
  marks: { row_label: string; seat_number: number; kind: string }[];
}

const SMALL_LAYOUT = {
  rowCount: 4,
  seatsPerRow: 8,
  rowZones: ['front', 'middle', 'middle', 'back'],
  seatMarks: [
    { rowLabel: 'D', seatNumber: 8, kind: 'no_seat' },
    { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
  ],
};

describe('Admin halls (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let probe: HallLifecycleProbe;
  const clock = new TestClock(NOW);

  const auditRows = (entityId?: number): Promise<AuditRow[]> => {
    const query = testApp
      .knex('audit_events')
      .select<AuditRow[]>(
        'action',
        'entity_id',
        'actor_staff_user_id',
        'changed_fields',
        'metadata',
      )
      .where({ entity_type: 'hall' })
      .orderBy('id');
    if (entityId !== undefined) query.where({ entity_id: entityId });
    return query;
  };

  const storedLayout = async (hallId: number): Promise<StoredLayout> => ({
    hall: await testApp
      .knex('halls')
      .select('row_count', 'seats_per_row')
      .where({ id: hallId })
      .first(),
    rows: await testApp
      .knex('hall_rows')
      .select('row_index', 'row_label', 'zone')
      .where({ hall_id: hallId })
      .orderBy('row_index'),
    marks: await testApp
      .knex('hall_seat_marks')
      .select('row_label', 'seat_number', 'kind')
      .where({ hall_id: hallId })
      .orderBy(['row_label', 'seat_number']),
  });

  const post = (theaterId: number, body: object, key: string = randomUUID()) =>
    testApp
      .http()
      .post(theaterHallsPath(theaterId))
      .set('Authorization', admin.authorization)
      .set('Idempotency-Key', key)
      .send(body);
  const patch = (hallId: number, body: object) =>
    testApp.http().patch(`${HALLS}/${hallId}`).set('Authorization', admin.authorization).send(body);
  const putLayout = (hallId: number, body: object) =>
    testApp
      .http()
      .put(`${HALLS}/${hallId}/layout`)
      .set('Authorization', admin.authorization)
      .send(body);
  const getLayout = (hallId: number) =>
    testApp.http().get(`${HALLS}/${hallId}/layout`).set('Authorization', admin.authorization);

  beforeAll(async () => {
    testApp = await createTestApp({ clock, imports: [HallsProbeModule] });
    probe = testApp.app.get(HallLifecycleProbe);
    admin = await staffSession(testApp, 'admin');
    boxOffice = await staffSession(testApp, 'box_office');
  });

  beforeEach(async () => {
    clock.set(NOW);
    probe.reset();
    await testApp.knex.raw(
      'TRUNCATE theaters, audit_events, idempotency_keys RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('create and edit', () => {
    it('adds a 12 × 16 draft hall with the standard zones, and records it', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const created = await post(theaterId, { name: '  Hall 1 ' });
      expect(created.status).toBe(201);
      expect(created.body).toEqual({
        id: expect.any(Number),
        theaterId,
        name: 'Hall 1',
        status: 'draft',
        rowCount: 12,
        seatsPerRow: 16,
        seatCount: 192,
        wheelchairCount: 0,
        zoneSeatCounts: { front: 48, middle: 80, back: 64 },
        deletable: true,
        createdAt: '2026-10-16T12:00:00+03:00',
        updatedAt: '2026-10-16T12:00:00+03:00',
      });
      const id = (created.body as { id: number }).id;

      const layout = await getLayout(id);
      expect(layout.status).toBe(200);
      expect(layout.body).toEqual({
        hallId: id,
        rowCount: 12,
        seatsPerRow: 16,
        aisleAfter: [4, 12],
        rows: 'ABCDEFGHJKLM'.split('').map((label, index) => ({
          label,
          zone: index < 3 ? 'front' : index < 8 ? 'middle' : 'back',
        })),
        seatMarks: [],
        seatCount: 192,
        wheelchairCount: 0,
        zoneSeatCounts: { front: 48, middle: 80, back: 64 },
        updatedAt: '2026-10-16T12:00:00+03:00',
      });
      expect(await auditRows(id)).toEqual([
        {
          action: 'hall.created',
          entity_id: id,
          actor_staff_user_id: admin.staffUserId,
          changed_fields: [],
          metadata: { theaterId },
        },
      ]);
    });

    it('keeps names unique per theater, ignoring case, and allows the name in another theater', async () => {
      const first = await createTheater(testApp, admin.authorization);
      const second = await createTheater(testApp, admin.authorization);
      expect((await post(first, { name: 'Hall 1' })).status).toBe(201);
      const clash = await post(first, { name: 'HALL 1' });
      expectError(clash, 409, 'CONFLICT');
      expect(clash.body.error.details).toEqual({ constraint: 'uq_halls_theater_id_name' });
      expect((await post(second, { name: 'hall 1' })).status).toBe(201);
    });

    it('refuses an unknown theater, a missing key and a bad name, and replays a repeated key', async () => {
      expectError(await post(999, { name: 'Hall 1' }), 404, 'NOT_FOUND');
      const theaterId = await createTheater(testApp, admin.authorization);
      const noKey = await testApp
        .http()
        .post(theaterHallsPath(theaterId))
        .set('Authorization', admin.authorization)
        .send({ name: 'Hall 1' });
      expectError(noKey, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      expectError(await post(theaterId, { name: ' ' }), 400, 'VALIDATION_FAILED');
      // Postgres text can't hold NUL: refused up front, never a 500 from the insert.
      expectError(await post(theaterId, { name: 'Hall\u00001' }), 400, 'VALIDATION_FAILED');

      const key = randomUUID();
      const first = await post(theaterId, { name: 'Hall 1' }, key);
      const replay = await post(theaterId, { name: 'Hall 1' }, key);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await testApp.knex('halls').count({ count: '*' }).first()).toEqual({ count: 1 });
    });

    it('renames, activates and retires a hall, and refuses the other status changes', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId, 'Hall 1');
      clock.set(new Date('2026-10-16T12:05:00+03:00'));

      const renamed = await patch(id, { name: 'Hall One' });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toEqual(
        expect.objectContaining({
          name: 'Hall One',
          status: 'draft',
          updatedAt: '2026-10-16T12:05:00+03:00',
        }),
      );
      expect((await patch(id, { status: 'active' })).body.status).toBe('active');
      const back = await patch(id, { status: 'draft' });
      expectError(back, 409, 'CONFLICT');
      expect(back.body.error.details).toEqual({ from: 'active', to: 'draft' });

      const retired = await patch(id, { name: 'Old hall', status: 'retired' });
      expect(retired.body).toEqual(
        expect.objectContaining({ name: 'Old hall', status: 'retired' }),
      );
      const revived = await patch(id, { status: 'active' });
      expectError(revived, 409, 'CONFLICT');
      expect(revived.body.error.details).toEqual({ from: 'retired', to: 'active' });
      expect((await patch(id, { name: 'Renamed while retired' })).status).toBe(200);

      const nothing = await patch(id, { name: 'Renamed while retired', status: 'retired' });
      expect(nothing.status).toBe(200);
      expectError(await patch(id, {}), 400, 'VALIDATION_FAILED');
      expectError(await patch(999, { name: 'x' }), 404, 'NOT_FOUND');

      expect(
        (await auditRows(id)).map(({ action, changed_fields, metadata }) => ({
          action,
          changed_fields,
          metadata,
        })),
      ).toEqual([
        { action: 'hall.created', changed_fields: [], metadata: { theaterId } },
        { action: 'hall.updated', changed_fields: ['name'], metadata: {} },
        { action: 'hall.activated', changed_fields: [], metadata: { from: 'draft', to: 'active' } },
        { action: 'hall.updated', changed_fields: ['name'], metadata: {} },
        { action: 'hall.retired', changed_fields: [], metadata: { from: 'active', to: 'retired' } },
        { action: 'hall.updated', changed_fields: ['name'], metadata: {} },
      ]);
    });

    it('lists halls by name in pages, with a total and a status filter', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const other = await createTheater(testApp, admin.authorization);
      await createHall(testApp, admin.authorization, other, 'Elsewhere');
      const ids: number[] = [];
      for (let index = 24; index >= 0; index -= 1) {
        ids.push(
          await createHall(
            testApp,
            admin.authorization,
            theaterId,
            `Hall ${String(index).padStart(2, '0')}`,
          ),
        );
      }
      for (const id of ids.slice(0, 3))
        await setHallStatus(testApp, admin.authorization, id, 'active');
      const list = (query = '') =>
        testApp
          .http()
          .get(`${theaterHallsPath(theaterId)}${query}`)
          .set('Authorization', admin.authorization);

      const page1 = await list();
      expect(page1.status).toBe(200);
      expect(page1.body.total).toBe(25);
      expect(page1.body.items).toHaveLength(20);
      expect(page1.body.items[0]).toEqual(
        expect.objectContaining({ name: 'Hall 00', deletable: true }),
      );
      const page2 = await list(`?cursor=${page1.body.nextCursor as string}`);
      expect((page2.body.items as { name: string }[]).map((item) => item.name)).toEqual([
        'Hall 20',
        'Hall 21',
        'Hall 22',
        'Hall 23',
        'Hall 24',
      ]);
      expect(page2.body.nextCursor).toBeNull();

      const active = await list('?status=active');
      expect(active.body).toEqual(expect.objectContaining({ total: 3, nextCursor: null }));
      expect((active.body.items as { name: string }[]).map((item) => item.name)).toEqual([
        'Hall 22',
        'Hall 23',
        'Hall 24',
      ]);
      expectError(await list('?status=closed'), 400, 'VALIDATION_FAILED');
      expectError(
        await testApp.http().get(theaterHallsPath(999)).set('Authorization', admin.authorization),
        404,
        'NOT_FOUND',
      );
      const one = await testApp
        .http()
        .get(`${HALLS}/${ids[0]}`)
        .set('Authorization', admin.authorization);
      expect(one.body).toEqual(expect.objectContaining({ id: ids[0], name: 'Hall 24' }));
    });
  });

  describe('layout', () => {
    it('replaces a layout and reads it back with aisles and seat counts', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      clock.set(new Date('2026-10-16T12:10:00+03:00'));

      const saved = await putLayout(id, SMALL_LAYOUT);
      expect(saved.status).toBe(200);
      const expected = {
        hallId: id,
        rowCount: 4,
        seatsPerRow: 8,
        aisleAfter: [4],
        rows: [
          { label: 'A', zone: 'front' },
          { label: 'B', zone: 'middle' },
          { label: 'C', zone: 'middle' },
          { label: 'D', zone: 'back' },
        ],
        seatMarks: [
          { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
          { rowLabel: 'D', seatNumber: 8, kind: 'no_seat' },
        ],
        seatCount: 31,
        wheelchairCount: 1,
        zoneSeatCounts: { front: 8, middle: 16, back: 7 },
        updatedAt: '2026-10-16T12:10:00+03:00',
      };
      expect(saved.body).toEqual(expected);
      expect((await getLayout(id)).body).toEqual(expected);
      const hall = await testApp
        .http()
        .get(`${HALLS}/${id}`)
        .set('Authorization', admin.authorization);
      expect(hall.body).toEqual(
        expect.objectContaining({ rowCount: 4, seatsPerRow: 8, seatCount: 31, wheelchairCount: 1 }),
      );
      expect((await auditRows(id)).at(-1)).toEqual(
        expect.objectContaining({
          action: 'hall.layout_replaced',
          changed_fields: [],
          metadata: { rowCount: 4, seatsPerRow: 8, seatCount: 31, wheelchairCount: 1 },
        }),
      );
      expect(probe.events).toEqual([
        `beforeLock ${id}`,
        `blockingShowtimes ${id}`,
        `afterSave ${id}`,
      ]);
      expect(probe.saved).toEqual([expect.objectContaining({ hallId: id, seatCount: 31 })]);
    });

    it('takes the largest grid, lettered A to P without I, and shrinks back to the smallest', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      const large = await putLayout(id, {
        rowCount: 15,
        seatsPerRow: 20,
        rowZones: [...Array(5).fill('front'), ...Array(5).fill('middle'), ...Array(5).fill('back')],
        seatMarks: [{ rowLabel: 'P', seatNumber: 20, kind: 'wheelchair' }],
      });
      expect(large.status).toBe(200);
      expect((large.body.rows as { label: string }[]).map((row) => row.label).join('')).toBe(
        'ABCDEFGHJKLMNOP',
      );
      expect(large.body).toEqual(
        expect.objectContaining({
          aisleAfter: [4, 16],
          seatCount: 300,
          wheelchairCount: 1,
          zoneSeatCounts: { front: 100, middle: 100, back: 100 },
        }),
      );

      expect((await putLayout(id, SMALL_LAYOUT)).status).toBe(200);
      const stored = await storedLayout(id);
      expect(stored.hall).toEqual({ row_count: 4, seats_per_row: 8 });
      expect(stored.rows.map((row) => row.row_label)).toEqual(['A', 'B', 'C', 'D']);
      expect(stored.marks).toEqual([
        { row_label: 'A', seat_number: 1, kind: 'wheelchair' },
        { row_label: 'D', seat_number: 8, kind: 'no_seat' },
      ]);
    });

    it.each<[string, Record<string, unknown>, string[]]>([
      [
        'a mark in row N of a 12-row hall',
        { seatMarks: [{ rowLabel: 'N', seatNumber: 5, kind: 'no_seat' }] },
        ['seatMarks.0.rowLabel'],
      ],
      [
        'seat 17 in a 16-seat row',
        { seatMarks: [{ rowLabel: 'A', seatNumber: 17, kind: 'wheelchair' }] },
        ['seatMarks.0.seatNumber'],
      ],
      ['11 zones for 12 rows', { rowZones: Array(11).fill('back') }, ['rowZones']],
      [
        'a front row behind a middle row',
        { rowZones: ['middle', 'front', ...Array(10).fill('back')] },
        ['rowZones.1'],
      ],
      [
        'a seat marked twice',
        {
          seatMarks: [
            { rowLabel: 'B', seatNumber: 2, kind: 'no_seat' },
            { rowLabel: 'B', seatNumber: 2, kind: 'no_seat' },
          ],
        },
        ['seatMarks.1'],
      ],
      [
        'row label I',
        { seatMarks: [{ rowLabel: 'I', seatNumber: 1, kind: 'no_seat' }] },
        ['seatMarks.0.rowLabel'],
      ],
      ['3 rows', { rowCount: 3, rowZones: ['front', 'middle', 'back'] }, ['rowCount', 'rowZones']],
    ])('refuses %s and keeps the stored layout', async (_, overrides, fields) => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      const before = await storedLayout(id);
      const refused = await putLayout(id, {
        rowCount: 12,
        seatsPerRow: 16,
        rowZones: [...Array(3).fill('front'), ...Array(5).fill('middle'), ...Array(4).fill('back')],
        seatMarks: [],
        ...overrides,
      });
      expectError(refused, 400, 'VALIDATION_FAILED');
      expect(
        (refused.body.error.details.fields as { field: string }[]).map((entry) => entry.field),
      ).toEqual(fields);
      expect(await storedLayout(id)).toEqual(before);
      expect((await auditRows(id)).map((row) => row.action)).toEqual(['hall.created']);
    });

    it('refuses a layout with every cell a gap', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      const gaps = ['A', 'B', 'C', 'D'].flatMap((rowLabel) =>
        [1, 2, 3, 4, 5, 6, 7, 8].map((seatNumber) => ({ rowLabel, seatNumber, kind: 'no_seat' })),
      );
      const refused = await putLayout(id, { ...SMALL_LAYOUT, seatMarks: gaps });
      expectError(refused, 400, 'VALIDATION_FAILED');
      expect(refused.body.error.details.fields).toEqual([
        { field: 'seatMarks', messages: [expect.stringContaining('at least one seat')] },
      ]);
    });

    it("refuses a retired hall's layout and an unknown hall", async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      await setHallStatus(testApp, admin.authorization, id, 'retired');
      const refused = await putLayout(id, SMALL_LAYOUT);
      expectError(refused, 409, 'CONFLICT');
      expect(refused.body.error.details).toEqual({ status: 'retired' });
      expect((await getLayout(id)).body.rowCount).toBe(12);
      expectError(await putLayout(999, SMALL_LAYOUT), 404, 'NOT_FOUND');
      expectError(await getLayout(999), 404, 'NOT_FOUND');
    });

    it('rolls the whole replace back when a participant fails after the save', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      const before = await storedLayout(id);
      probe.failAfterSave.add(id);
      expectError(await putLayout(id, SMALL_LAYOUT), 500, 'INTERNAL');
      expect(probe.events).toContain(`afterSave ${id}`);
      expect(await storedLayout(id)).toEqual(before);
      expect(before.rows).toHaveLength(12);
      expect((await auditRows(id)).map((row) => row.action)).toEqual(['hall.created']);
    });

    it('refuses a hall in use with HALL_IN_USE naming the showtimes, and keeps the layout', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      const before = await storedLayout(id);
      probe.blocking.set(id, [
        {
          showtimeId: 41,
          startsAt: new Date('2026-12-01T19:30:00+02:00'),
          movieTitle: 'The Nile Light',
        },
        { showtimeId: 40, startsAt: new Date('2026-10-16T21:00:00+03:00'), movieTitle: 'Tonight' },
      ]);
      const refused = await putLayout(id, SMALL_LAYOUT);
      expectError(refused, 409, 'HALL_IN_USE');
      expect(refused.body.error.details).toEqual({
        showtimes: [
          { id: 40, startsAt: '2026-10-16T21:00:00+03:00', movieTitle: 'Tonight' },
          { id: 41, startsAt: '2026-12-01T19:30:00+02:00', movieTitle: 'The Nile Light' },
        ],
      });
      expect(probe.events).not.toContain(`afterSave ${id}`);
      expect(await storedLayout(id)).toEqual(before);
    });
  });

  describe('delete and retire', () => {
    it('deletes a hall with its rows and marks, and records it', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      expect((await putLayout(id, SMALL_LAYOUT)).status).toBe(200);
      const deleted = await testApp
        .http()
        .delete(`${HALLS}/${id}`)
        .set('Authorization', admin.authorization);
      expect(deleted.status).toBe(204);
      expect(await storedLayout(id)).toEqual({ hall: undefined, rows: [], marks: [] });
      expect((await auditRows(id)).at(-1)).toEqual(
        expect.objectContaining({ action: 'hall.deleted', metadata: { theaterId } }),
      );
      expectError(
        await testApp.http().delete(`${HALLS}/${id}`).set('Authorization', admin.authorization),
        404,
        'NOT_FOUND',
      );
    });

    it('refuses deleting a hall a deletion blocker keeps, and shows it as not deletable', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const kept = await createHall(testApp, admin.authorization, theaterId, 'Hall A');
      await createHall(testApp, admin.authorization, theaterId, 'Hall B');
      probe.withShowtimes.add(kept);
      const refused = await testApp
        .http()
        .delete(`${HALLS}/${kept}`)
        .set('Authorization', admin.authorization);
      expectError(refused, 409, 'HALL_NOT_DELETABLE');
      expect(refused.body.error.details).toEqual({ reasons: ['has_showtimes'] });
      const list = await testApp
        .http()
        .get(theaterHallsPath(theaterId))
        .set('Authorization', admin.authorization);
      expect((list.body.items as { deletable: boolean }[]).map((item) => item.deletable)).toEqual([
        false,
        true,
      ]);
      expect(await testApp.knex('halls').where({ id: kept }).first()).toBeDefined();
    });

    it('refuses retiring a hall a retirement blocker keeps', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await addActiveHall(testApp, admin.authorization, theaterId);
      probe.withFutureShowtimes.add(id);
      const refused = await patch(id, { name: 'Renamed', status: 'retired' });
      expectError(refused, 409, 'HALL_NOT_RETIRABLE');
      expect(refused.body.error.details).toEqual({ reasons: ['has_future_showtimes'] });
      const hall = await testApp.knex('halls').select('name', 'status').where({ id }).first();
      expect(hall).toEqual({ name: expect.not.stringMatching('Renamed'), status: 'active' });
    });

    it("removes a draft theater's halls with the theater", async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      const deleted = await testApp
        .http()
        .delete(`${THEATERS}/${theaterId}`)
        .set('Authorization', admin.authorization);
      expect(deleted.status).toBe(204);
      expect(await storedLayout(id)).toEqual({ hall: undefined, rows: [], marks: [] });
    });
  });

  describe('publishing a theater', () => {
    it('needs an active hall: none, a draft or a retired one is not enough', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      await prepareTheater(testApp, admin.authorization, theaterId);
      const publish = () =>
        testApp
          .http()
          .patch(`${THEATERS}/${theaterId}`)
          .set('Authorization', admin.authorization)
          .send({ status: 'active' });
      const blockers = async (): Promise<string[]> => {
        const response = await testApp
          .http()
          .get(`${THEATERS}/${theaterId}`)
          .set('Authorization', admin.authorization);
        return (response.body as { publishBlockers: string[] }).publishBlockers;
      };

      const none = await publish();
      expectError(none, 409, 'THEATER_NOT_PUBLISHABLE');
      expect(none.body.error.details).toEqual({ missing: ['active_hall'] });
      expect(await blockers()).toEqual(['active_hall']);

      const draft = await createHall(testApp, admin.authorization, theaterId, 'Draft hall');
      expect((await publish()).body.error.details).toEqual({ missing: ['active_hall'] });
      const retired = await createHall(testApp, admin.authorization, theaterId, 'Retired hall');
      await setHallStatus(testApp, admin.authorization, retired, 'retired');
      expect((await publish()).body.error.details).toEqual({ missing: ['active_hall'] });

      await setHallStatus(testApp, admin.authorization, draft, 'active');
      expect(await blockers()).toEqual([]);
      const published = await publish();
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('active');

      // Publishing is a one-time gate: the last active hall may retire afterwards.
      await setHallStatus(testApp, admin.authorization, draft, 'retired');
      const theater = await testApp
        .http()
        .get(`${THEATERS}/${theaterId}`)
        .set('Authorization', admin.authorization);
      expect(theater.body.status).toBe('active');
    });
  });

  describe('access', () => {
    const hallRoutes = () =>
      listHttpRoutes(testApp).filter(
        (route) =>
          route.path.startsWith('/api/v1/admin/halls') ||
          (route.path.startsWith('/api/v1/admin/theaters') && route.path.endsWith('/halls')),
      );

    it('serves the 7 hall routes, every one Admin only', () => {
      expect(
        hallRoutes()
          .map((route) => `${route.access} ${route.method} ${route.path}`)
          .sort(),
      ).toEqual(
        [
          'GET /api/v1/admin/theaters/:id/halls',
          'POST /api/v1/admin/theaters/:id/halls',
          'GET /api/v1/admin/halls/:id',
          'PATCH /api/v1/admin/halls/:id',
          'DELETE /api/v1/admin/halls/:id',
          'GET /api/v1/admin/halls/:id/layout',
          'PUT /api/v1/admin/halls/:id/layout',
        ]
          .map((route) => `admin ${route}`)
          .sort(),
      );
    });

    it('refuses a box-office token with FORBIDDEN and no token with UNAUTHENTICATED', async () => {
      const theaterId = await createTheater(testApp, admin.authorization);
      const id = await createHall(testApp, admin.authorization, theaterId);
      expect([theaterId, id]).toEqual([1, 1]);
      for (const route of hallRoutes()) {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        const path = samplePath(route.path);
        const asBoxOffice = await testApp
          .http()
          [method](path)
          .set('Authorization', boxOffice.authorization)
          .set('Idempotency-Key', randomUUID())
          .send(method === 'put' ? SMALL_LAYOUT : { name: 'Box office hall', status: 'retired' });
        expect({
          route: route.handler,
          status: asBoxOffice.status,
          code: asBoxOffice.body?.error?.code,
        }).toEqual({ route: route.handler, status: 403, code: 'FORBIDDEN' });
        const anonymous = await testApp.http()[method](path).send({});
        expect({ route: route.handler, status: anonymous.status }).toEqual({
          route: route.handler,
          status: 401,
        });
      }
      // Nothing changed on the hall the refused requests named.
      expect((await auditRows(id)).map((row) => row.action)).toEqual(['hall.created']);
      expect(await testApp.knex('halls').count({ count: '*' }).first()).toEqual({ count: 1 });
    });
  });
});
