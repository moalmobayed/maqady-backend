import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { addActiveHall } from '../../../support/halls';
import { listHttpRoutes, samplePath } from '../../../support/routes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { TestClock } from '../../../support/clock';
import {
  TheaterLifecycleProbe,
  TheaterLifecycleProbeModule,
} from '../../../support/theaters-probe.module';
import {
  createTheater,
  DEFAULT_PRICES,
  everyDay,
  prepareTheater,
  setTheaterStatus,
  theaterBody,
  THEATERS,
} from '../../../support/theaters';
import type { StaffSession, TestApp } from '../../../support/types';

// Real staff sign-ins hash passwords with scrypt.
jest.setTimeout(60_000);

const NOW = new Date('2026-10-16T12:00:00+03:00'); // a Friday, cinema date 2026-10-16

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: number;
  actor_staff_user_id: number;
  changed_fields: string[];
  metadata: Record<string, unknown>;
}

describe('Admin theaters (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let probe: TheaterLifecycleProbe;
  const clock = new TestClock(NOW);

  const auditRows = (entityId?: number): Promise<AuditRow[]> => {
    const query = testApp
      .knex('audit_events')
      .select<AuditRow[]>(
        'action',
        'entity_type',
        'entity_id',
        'actor_staff_user_id',
        'changed_fields',
        'metadata',
      )
      .whereLike('action', 'theater%')
      .orderBy('id');
    if (entityId !== undefined) query.where({ entity_id: entityId });
    return query;
  };

  const patch = (id: number, body: object) =>
    testApp.http().patch(`${THEATERS}/${id}`).set('Authorization', admin.authorization).send(body);

  beforeAll(async () => {
    testApp = await createTestApp({ clock, imports: [TheaterLifecycleProbeModule] });
    probe = testApp.app.get(TheaterLifecycleProbe);
    admin = await staffSession(testApp, 'admin');
    boxOffice = await staffSession(testApp, 'box_office');
  });

  beforeEach(async () => {
    clock.set(NOW);
    probe.withShowtimes.clear();
    await testApp.knex.raw(
      'TRUNCATE theaters, audit_events, idempotency_keys RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('create, edit and publish', () => {
    it('creates a draft, edits it, and publishes once prices, hours and a hall are set', async () => {
      const created = await testApp
        .http()
        .post(THEATERS)
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', randomUUID())
        .send(theaterBody({ name: ' Maqady Zamalek ', email: 'zamalek@maqady.example' }));
      expect(created.status).toBe(201);
      expect(created.body).toEqual(
        expect.objectContaining({
          name: 'Maqady Zamalek',
          status: 'draft',
          email: 'zamalek@maqady.example',
          showContactsPublic: false,
          phones: [],
          facilities: [],
          hours: [],
          specialDates: [],
          defaultPrices: null,
          cover: null,
          photos: [],
          openState: { isOpen: false, closesAt: null, nextOpensAt: null },
          publishBlockers: ['prices', 'hours', 'active_hall'],
          createdAt: '2026-10-16T12:00:00+03:00',
        }),
      );
      const id = (created.body as { id: number }).id;

      const edited = await patch(id, { district: 'Zamalek, Cairo', parkingInfo: 'Valet' });
      expect(edited.status).toBe(200);
      expect(edited.body).toEqual(
        expect.objectContaining({ district: 'Zamalek, Cairo', parkingInfo: 'Valet' }),
      );

      const refused = await patch(id, { status: 'active' });
      expectError(refused, 409, 'THEATER_NOT_PUBLISHABLE');
      expect(refused.body.error.details).toEqual({ missing: ['prices', 'hours', 'active_hall'] });

      const prices = await testApp
        .http()
        .put(`${THEATERS}/${id}/prices`)
        .set('Authorization', admin.authorization)
        .send(DEFAULT_PRICES);
      expect(prices.status).toBe(200);
      expect(prices.body.defaultPrices).toEqual(DEFAULT_PRICES);
      expect((await patch(id, { status: 'active' })).body.error.details).toEqual({
        missing: ['hours', 'active_hall'],
      });

      const allClosed = await testApp
        .http()
        .put(`${THEATERS}/${id}/hours`)
        .set('Authorization', admin.authorization)
        .send({ days: everyDay(null, null) });
      expect(allClosed.status).toBe(200);
      expect((await patch(id, { status: 'active' })).body.error.details).toEqual({
        missing: ['hours', 'active_hall'],
      });

      const hours = await testApp
        .http()
        .put(`${THEATERS}/${id}/hours`)
        .set('Authorization', admin.authorization)
        .send({ days: everyDay('12:00', '01:00') });
      expect(hours.status).toBe(200);
      expect(hours.body.hours).toHaveLength(7);
      expect(hours.body.hours[0]).toEqual({
        weekday: 1,
        closed: false,
        opens: '12:00',
        closes: '01:00',
        closesNextDay: true,
      });
      expect(hours.body.openState).toEqual({
        isOpen: true,
        closesAt: '2026-10-17T01:00:00+03:00',
        nextOpensAt: null,
      });
      expect((await patch(id, { status: 'active' })).body.error.details).toEqual({
        missing: ['active_hall'],
      });

      await addActiveHall(testApp, admin.authorization, id);
      const published = await patch(id, { status: 'active' });
      expect(published.status).toBe(200);
      expect(published.body).toEqual(
        expect.objectContaining({ status: 'active', publishBlockers: [] }),
      );

      expect((await auditRows(id)).map((row) => [row.action, row.changed_fields])).toEqual([
        ['theater.created', []],
        ['theater.updated', ['district', 'parkingInfo']],
        ['theater.prices_replaced', []],
        ['theater.hours_replaced', []],
        ['theater.hours_replaced', []],
        ['theater.published', []],
      ]);
      const [createdRow] = await auditRows(id);
      expect(createdRow!.actor_staff_user_id).toBe(admin.staffUserId);
    });

    it('toggles selling, and refuses to unpublish or to pause a draft', async () => {
      const id = await createTheater(testApp, admin.authorization);
      const draftPause = await patch(id, { status: 'sales_paused' });
      expectError(draftPause, 409, 'CONFLICT');
      expect(draftPause.body.error.details).toEqual({ from: 'draft', to: 'sales_paused' });

      await prepareTheater(testApp, admin.authorization, id);
      await addActiveHall(testApp, admin.authorization, id);
      await setTheaterStatus(testApp, admin.authorization, id, 'active');
      expect((await patch(id, { status: 'sales_paused' })).body.status).toBe('sales_paused');
      const backToDraft = await patch(id, { status: 'draft' });
      expectError(backToDraft, 409, 'CONFLICT');
      expect(backToDraft.body.error.details).toEqual({ from: 'sales_paused', to: 'draft' });
      expect((await patch(id, { status: 'active' })).body.status).toBe('active');
      expectError(await patch(id, { status: 'draft' }), 409, 'CONFLICT');

      expect((await auditRows(id)).map((row) => [row.action, row.metadata])).toEqual(
        expect.arrayContaining([
          ['theater.published', { from: 'draft', to: 'active' }],
          ['theater.sales_paused', { from: 'active', to: 'sales_paused' }],
          ['theater.sales_resumed', { from: 'sales_paused', to: 'active' }],
        ]),
      );
    });

    it('applies field changes and the publish together, and a PATCH of nothing records nothing', async () => {
      const id = await createTheater(testApp, admin.authorization, { name: 'Maqady Maadi' });
      await prepareTheater(testApp, admin.authorization, id);
      await addActiveHall(testApp, admin.authorization, id);

      const both = await patch(id, { city: 'Giza', status: 'active' });
      expect(both.body).toEqual(expect.objectContaining({ city: 'Giza', status: 'active' }));
      const before = (await auditRows(id)).length;
      const unchanged = await patch(id, { city: 'Giza', status: 'active', name: 'Maqady Maadi' });
      expect(unchanged.status).toBe(200);
      expect(await auditRows(id)).toHaveLength(before);
    });

    it('keeps names unique, ignoring letter case', async () => {
      await createTheater(testApp, admin.authorization, { name: 'Maqady Zamalek' });
      const clash = await testApp
        .http()
        .post(THEATERS)
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', randomUUID())
        .send(theaterBody({ name: 'MAQADY zamalek' }));
      expectError(clash, 409, 'CONFLICT');
      expect(clash.body.error.details).toEqual({ constraint: 'uq_theaters_name' });
    });

    it('requires an Idempotency-Key to create, and replays a retried create', async () => {
      const missing = await testApp
        .http()
        .post(THEATERS)
        .set('Authorization', admin.authorization)
        .send(theaterBody());
      expectError(missing, 400, 'IDEMPOTENCY_KEY_REQUIRED');

      const key = randomUUID();
      const body = theaterBody();
      const first = await testApp
        .http()
        .post(THEATERS)
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', key)
        .send(body);
      const retry = await testApp
        .http()
        .post(THEATERS)
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', key)
        .send(body);
      expect(retry.status).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body).toEqual(first.body);
      expect(await testApp.knex('theaters').count({ count: 'id' }).first()).toEqual({ count: 1 });
    });

    it('refuses an email or coordinates the database would refuse with VALIDATION_FAILED, not INTERNAL', async () => {
      // IsEmail accepts a quoted local part; chk_theaters_email does not. A number below 1e-6 is
      // written with an exponent, which class-validator's maxDecimalPlaces cannot read.
      for (const overrides of [
        { email: '"front desk"@maqady.example' },
        { email: '"box@office"@maqady.example' },
        { latitude: 1e-7 },
        { longitude: -2.5e-8 },
      ]) {
        const response = await testApp
          .http()
          .post(THEATERS)
          .set('Authorization', admin.authorization)
          .set('Idempotency-Key', randomUUID())
          .send(theaterBody(overrides));
        expectError(response, 400, 'VALIDATION_FAILED');
        const { fields } = response.body.error.details as { fields: { field: string }[] };
        expect(fields.map(({ field }) => field)).toEqual(Object.keys(overrides));
      }
      const id = await createTheater(testApp, admin.authorization);
      expectError(
        await patch(id, { email: '"front desk"@maqady.example' }),
        400,
        'VALIDATION_FAILED',
      );
      expectError(await patch(id, { latitude: 3e-7 }), 400, 'VALIDATION_FAILED');
      expect(await testApp.knex('theaters').count({ count: 'id' }).first()).toEqual({ count: 1 });
    });

    it('counts text lengths as the database does, so a variation selector past the limit is VALIDATION_FAILED', async () => {
      // class-validator's Length() does not count U+FE0F (emoji presentation), but Postgres
      // length() and VARCHAR(n) do: 99 letters and "☺️" are 101 characters there.
      const tooLong = (max: number) => `${'a'.repeat(max - 1)}☺️`;
      for (const overrides of [
        { name: tooLong(100) },
        { address: tooLong(200) },
        { transitInfo: tooLong(500) },
      ]) {
        const response = await testApp
          .http()
          .post(THEATERS)
          .set('Authorization', admin.authorization)
          .set('Idempotency-Key', randomUUID())
          .send(theaterBody(overrides));
        expectError(response, 400, 'VALIDATION_FAILED');
        const { fields } = response.body.error.details as { fields: { field: string }[] };
        expect(fields.map(({ field }) => field)).toEqual(Object.keys(overrides));
      }
      const id = await createTheater(testApp, admin.authorization);
      expectError(await patch(id, { city: tooLong(80) }), 400, 'VALIDATION_FAILED');
      const phones = await testApp
        .http()
        .put(`${THEATERS}/${id}/phones`)
        .set('Authorization', admin.authorization)
        .send({ phones: [{ label: tooLong(40), number: '+20227351100' }] });
      expectError(phones, 400, 'VALIDATION_FAILED');

      // At the limit, counted as the database counts, the text is stored as sent.
      const atLimit = `${'a'.repeat(98)}☺️`;
      const renamed = await patch(id, { name: atLimit });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe(atLimit);
    });

    it('answers NOT_FOUND for a missing theater and VALIDATION_FAILED for a bad id', async () => {
      expectError(
        await testApp.http().get(`${THEATERS}/999`).set('Authorization', admin.authorization),
        404,
        'NOT_FOUND',
      );
      expectError(
        await testApp.http().get(`${THEATERS}/abc`).set('Authorization', admin.authorization),
        400,
        'VALIDATION_FAILED',
      );
      expectError(await patch(999, { city: 'Giza' }), 404, 'NOT_FOUND');
    });
  });

  describe('phones, facilities and prices', () => {
    it('replaces phones and facilities as a whole, keeping the phone order', async () => {
      const id = await createTheater(testApp, admin.authorization);
      const put = (path: string, body: object) =>
        testApp
          .http()
          .put(`${THEATERS}/${id}/${path}`)
          .set('Authorization', admin.authorization)
          .send(body);

      await put('phones', {
        phones: [
          { label: 'Main line', number: '+20227351100' },
          { label: 'Box office', number: '+20227351101' },
        ],
      });
      const phones = await put('phones', {
        phones: [
          { label: 'WhatsApp', number: '+201001234567' },
          { label: ' Cinema manager ', number: '+201009876543' },
        ],
      });
      expect(phones.status).toBe(200);
      expect(phones.body.phones).toEqual([
        { label: 'WhatsApp', number: '+201001234567' },
        { label: 'Cinema manager', number: '+201009876543' },
      ]);

      await put('facilities', { facilities: ['kids_room', 'cafe_bar'] });
      const facilities = await put('facilities', {
        facilities: ['valet_parking', 'wheelchair_access'],
      });
      expect(facilities.body.facilities).toEqual(['wheelchair_access', 'valet_parking']);

      const none = await put('phones', { phones: [] });
      expect(none.body.phones).toEqual([]);
      const invalid = await put('phones', { phones: [{ label: 'Main', number: '0227351100' }] });
      expectError(invalid, 400, 'VALIDATION_FAILED');
      expect(invalid.body.error.details.fields).toEqual([
        { field: 'phones.0.number', messages: [expect.stringContaining('E.164')] },
      ]);
    });

    it('records the counts of phones and facilities, never a number, email or address', async () => {
      const id = await createTheater(testApp, admin.authorization, {
        email: 'private@maqady.example',
      });
      await testApp
        .http()
        .put(`${THEATERS}/${id}/phones`)
        .set('Authorization', admin.authorization)
        .send({ phones: [{ label: 'Manager', number: '+201009876543' }] });
      await testApp
        .http()
        .put(`${THEATERS}/${id}/facilities`)
        .set('Authorization', admin.authorization)
        .send({ facilities: ['cafe_bar'] });
      await patch(id, { email: 'other@maqady.example', address: '1 Nile Corniche' });

      const rows = await auditRows(id);
      expect(rows.map((row) => [row.action, row.metadata, row.changed_fields])).toEqual([
        ['theater.created', {}, []],
        ['theater.phones_replaced', { count: 1 }, []],
        ['theater.facilities_replaced', { count: 1 }, []],
        ['theater.updated', {}, ['address', 'email']],
      ]);
      const stored = JSON.stringify(
        await testApp.knex('audit_events').select('metadata', 'changed_fields'),
      );
      for (const value of ['+201009876543', 'maqady.example', 'Nile Corniche']) {
        expect(stored).not.toContain(value);
      }
    });
  });

  describe('deleting', () => {
    it('deletes a draft with its children, and refuses a published theater', async () => {
      const draft = await createTheater(testApp, admin.authorization);
      await prepareTheater(testApp, admin.authorization, draft);
      const deleted = await testApp
        .http()
        .delete(`${THEATERS}/${draft}`)
        .set('Authorization', admin.authorization);
      expect(deleted.status).toBe(204);
      expect(await testApp.knex('theaters').where({ id: draft })).toEqual([]);
      expect(await testApp.knex('theater_hours').where({ theater_id: draft })).toEqual([]);

      const active = await createTheater(testApp, admin.authorization);
      await prepareTheater(testApp, admin.authorization, active);
      await addActiveHall(testApp, admin.authorization, active);
      await setTheaterStatus(testApp, admin.authorization, active, 'active');
      const refused = await testApp
        .http()
        .delete(`${THEATERS}/${active}`)
        .set('Authorization', admin.authorization);
      expectError(refused, 409, 'THEATER_NOT_DELETABLE');
      expect(refused.body.error.details).toEqual({ reasons: ['not_draft'] });
      expect((await auditRows()).map((row) => row.action)).toContain('theater.deleted');
    });

    it('refuses a draft that a registered blocker keeps (U7 "has showtimes")', async () => {
      const id = await createTheater(testApp, admin.authorization);
      probe.withShowtimes.add(id);
      const refused = await testApp
        .http()
        .delete(`${THEATERS}/${id}`)
        .set('Authorization', admin.authorization);
      expectError(refused, 409, 'THEATER_NOT_DELETABLE');
      expect(refused.body.error.details).toEqual({ reasons: ['has_showtimes'] });
    });
  });

  describe('the list', () => {
    it('pages 25 theaters by name with total and the status filter', async () => {
      for (let index = 0; index < 25; index += 1) {
        await createTheater(testApp, admin.authorization, {
          name: `Theater ${String(index).padStart(2, '0')}`,
        });
      }
      // Ids follow the names: "Theater 00" is 1 and "Theater 01" is 2.
      for (const id of [1, 2]) {
        await prepareTheater(testApp, admin.authorization, id);
        await addActiveHall(testApp, admin.authorization, id);
        await setTheaterStatus(testApp, admin.authorization, id, 'active');
      }
      await testApp
        .http()
        .put(`${THEATERS}/1/phones`)
        .set('Authorization', admin.authorization)
        .send({ phones: [{ label: 'Box office', number: '+20227351100' }] });

      const list = (query: string) =>
        testApp.http().get(`${THEATERS}${query}`).set('Authorization', admin.authorization);
      const page1 = await list('');
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(20);
      expect(page1.body.total).toBe(25);
      expect(page1.body.items[0]).toEqual({
        id: 1,
        name: 'Theater 00',
        status: 'active',
        address: '26 July Street',
        district: 'Zamalek',
        city: 'Cairo',
        cover: null,
        mainPhone: { label: 'Box office', number: '+20227351100' },
        openState: { isOpen: true, closesAt: '2026-10-17T01:00:00+03:00', nextOpensAt: null },
        today: {
          cinemaDate: '2026-10-16',
          closed: false,
          opens: '12:00',
          closes: '01:00',
          closesNextDay: true,
          specialDateLabel: null,
        },
        updatedAt: '2026-10-16T12:00:00+03:00',
      });
      expect(page1.body.items[2].today).toEqual(
        expect.objectContaining({ closed: true, opens: null }),
      );

      const page2 = await list(`?cursor=${page1.body.nextCursor as string}`);
      const page2Names = (page2.body.items as { name: string }[]).map((item) => item.name);
      expect(page2Names).toEqual([
        'Theater 20',
        'Theater 21',
        'Theater 22',
        'Theater 23',
        'Theater 24',
      ]);
      expect(page2.body.nextCursor).toBeNull();

      const active = await list('?status=active');
      expect(active.body).toEqual(expect.objectContaining({ total: 2, nextCursor: null }));
      expectError(await list('?status=closed'), 400, 'VALIDATION_FAILED');
      expectError(await list('?cursor=bm90LWEtY3Vyc29y'), 400, 'VALIDATION_FAILED');
    });
  });

  describe('access', () => {
    it('serves the 16 theater routes, every one Admin only', () => {
      const routes = listHttpRoutes(testApp)
        // The theater's halls are U5's routes, covered by its own suite.
        .filter(
          (route) =>
            route.path.startsWith('/api/v1/admin/theaters') && !route.path.endsWith('/halls'),
        )
        .map((route) => `${route.access} ${route.method} ${route.path}`)
        .sort();
      expect(routes).toEqual(
        [
          'GET /api/v1/admin/theaters',
          'POST /api/v1/admin/theaters',
          'GET /api/v1/admin/theaters/:id',
          'PATCH /api/v1/admin/theaters/:id',
          'DELETE /api/v1/admin/theaters/:id',
          'PUT /api/v1/admin/theaters/:id/hours',
          'PUT /api/v1/admin/theaters/:id/phones',
          'PUT /api/v1/admin/theaters/:id/facilities',
          'PUT /api/v1/admin/theaters/:id/prices',
          'POST /api/v1/admin/theaters/:id/special-dates',
          'PATCH /api/v1/admin/theaters/:id/special-dates/:specialDateId',
          'DELETE /api/v1/admin/theaters/:id/special-dates/:specialDateId',
          'POST /api/v1/admin/theaters/:id/photos',
          'PATCH /api/v1/admin/theaters/:id/photos/:photoId',
          'DELETE /api/v1/admin/theaters/:id/photos/:photoId',
          'DELETE /api/v1/admin/theaters/:id/cover',
        ]
          .map((route) => `admin ${route}`)
          .sort(),
      );
    });

    it('refuses a box-office token with FORBIDDEN and no token with UNAUTHENTICATED', async () => {
      const id = await createTheater(testApp, admin.authorization);
      const routes = listHttpRoutes(testApp).filter((route) =>
        route.path.startsWith('/api/v1/admin/theaters'),
      );
      for (const route of routes) {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        const path = samplePath(route.path);
        const asBoxOffice = await testApp
          .http()
          [method](path)
          .set('Authorization', boxOffice.authorization)
          .set('Idempotency-Key', randomUUID())
          .send({});
        expect({
          route: route.handler,
          status: asBoxOffice.status,
          code: asBoxOffice.body?.error?.code,
        }).toEqual({
          route: route.handler,
          status: 403,
          code: 'FORBIDDEN',
        });
        const anonymous = await testApp.http()[method](path).send({});
        expect({ route: route.handler, status: anonymous.status }).toEqual({
          route: route.handler,
          status: 401,
        });
      }
      // Nothing changed on the theater the refused requests named.
      expect(await auditRows(id)).toHaveLength(1);
    });
  });
});
