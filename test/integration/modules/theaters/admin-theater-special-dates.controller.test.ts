import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { TheaterHoursService } from '../../../../src/modules/theaters/theater-hours.service';
import { formatCairoIso } from '../../../../src/common/time/time';
import { TestClock } from '../../../support/clock';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { createTheater, everyDay, prepareTheater, THEATERS } from '../../../support/theaters';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

// 03:00 on Saturday 17 October is still the cinema date Friday 16 October.
const NOW = new Date('2026-10-17T03:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

describe('Admin theater special dates (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let theaterId: number;
  let otherTheaterId: number;
  const clock = new TestClock(NOW);

  const create = (body: object, id = theaterId) =>
    testApp
      .http()
      .post(`${THEATERS}/${id}/special-dates`)
      .set('Authorization', admin.authorization)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const update = (specialDateId: number, body: object, id = theaterId) =>
    testApp
      .http()
      .patch(`${THEATERS}/${id}/special-dates/${specialDateId}`)
      .set('Authorization', admin.authorization)
      .send(body);
  const remove = (specialDateId: number, id = theaterId) =>
    testApp
      .http()
      .delete(`${THEATERS}/${id}/special-dates/${specialDateId}`)
      .set('Authorization', admin.authorization);
  const theater = () =>
    testApp.http().get(`${THEATERS}/${theaterId}`).set('Authorization', admin.authorization);

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    admin = await staffSession(testApp, 'admin');
  });

  beforeEach(async () => {
    clock.set(NOW);
    admin = await signInStaff(testApp, admin.email, admin.password);
    await testApp.knex.raw(
      'TRUNCATE theaters, audit_events, idempotency_keys RESTART IDENTITY CASCADE',
    );
    theaterId = await createTheater(testApp, admin.authorization);
    otherTheaterId = await createTheater(testApp, admin.authorization);
    await prepareTheater(testApp, admin.authorization, theaterId, everyDay('12:00', '01:00'));
  });

  afterAll(async () => {
    await testApp.close();
  });

  it("creates special dates from today's cinema date on, and refuses a past one", async () => {
    const today = await create({
      cinemaDate: '2026-10-16',
      label: 'Late show night',
      closed: false,
      opens: '12:00',
      closes: '04:00',
    });
    expect(today.status).toBe(201);
    expect(today.body).toEqual({
      id: expect.any(Number),
      cinemaDate: '2026-10-16',
      label: 'Late show night',
      closed: false,
      opens: '12:00',
      closes: '04:00',
      closesNextDay: true,
    });
    // At 03:00 the theater is open on the special date's hours, not the weekly 01:00 closing.
    expect((await theater()).body.openState).toEqual({
      isOpen: true,
      closesAt: '2026-10-17T04:00:00+03:00',
      nextOpensAt: null,
    });

    const past = await create({ cinemaDate: '2026-10-15', label: 'Yesterday', closed: true });
    expectError(past, 400, 'VALIDATION_FAILED');
    expect(past.body.error.details.fields).toEqual([
      { field: 'cinemaDate', messages: ["cinemaDate must be today's cinema date or later"] },
    ]);
    expectError(
      await create({ cinemaDate: '2026-10-20', label: 'x', closed: false }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('refuses a second special date on the same cinema date', async () => {
    expect((await create({ cinemaDate: '2026-10-20', label: 'One', closed: true })).status).toBe(
      201,
    );
    const second = await create({ cinemaDate: '2026-10-20', label: 'Two', closed: true });
    expectError(second, 409, 'CONFLICT');
    expect(second.body.error.details).toEqual({
      constraint: 'uq_theater_special_dates_theater_id_cinema_date',
    });
    // Another theater may use the date.
    expect(
      (await create({ cinemaDate: '2026-10-20', label: 'Two', closed: true }, otherTheaterId))
        .status,
    ).toBe(201);
  });

  it('changes the hours of a special date, checking the result as a whole', async () => {
    const { body } = await create({
      cinemaDate: '2026-10-21',
      label: 'Holiday',
      closed: false,
      opens: '10:00',
      closes: '03:00',
    });
    const id = (body as { id: number }).id;

    const later = await update(id, { closes: '05:00' });
    expect(later.status).toBe(200);
    expect(later.body).toEqual(expect.objectContaining({ opens: '10:00', closes: '05:00' }));

    const closed = await update(id, { closed: true });
    expect(closed.body).toEqual(
      expect.objectContaining({ closed: true, opens: null, closes: null }),
    );
    const halfOpen = await update(id, { closed: false, opens: '11:00' });
    expectError(halfOpen, 400, 'VALIDATION_FAILED');
    expect(halfOpen.body.error.details.fields).toEqual([
      { field: 'closes', messages: ['opens and closes are required on an open day'] },
    ]);
    const reopened = await update(id, { closed: false, opens: '11:00', closes: '02:00' });
    expect(reopened.body).toEqual(expect.objectContaining({ closed: false, opens: '11:00' }));

    const window = await testApp.app.get(TheaterHoursService).windowFor(theaterId, '2026-10-21');
    expect({
      opensAt: formatCairoIso(window!.opensAt),
      closesAt: formatCairoIso(window!.closesAt),
    }).toEqual({ opensAt: '2026-10-21T11:00:00+03:00', closesAt: '2026-10-22T02:00:00+03:00' });

    const actions = await testApp
      .knex('audit_events')
      .where({ entity_type: 'theater_special_date', entity_id: id })
      .orderBy('id')
      .select('action', 'changed_fields', 'metadata');
    expect(actions).toEqual([
      {
        action: 'theater_special_date.created',
        changed_fields: [],
        metadata: { theaterId, cinemaDate: '2026-10-21' },
      },
      {
        action: 'theater_special_date.updated',
        changed_fields: ['closes'],
        metadata: { theaterId, cinemaDate: '2026-10-21' },
      },
      {
        action: 'theater_special_date.updated',
        changed_fields: ['closed', 'closes', 'opens'],
        metadata: { theaterId, cinemaDate: '2026-10-21' },
      },
      {
        action: 'theater_special_date.updated',
        changed_fields: ['closed', 'closes', 'opens'],
        metadata: { theaterId, cinemaDate: '2026-10-21' },
      },
    ]);
  });

  it("shows only special dates from today's cinema date on, and lets a past one be deleted", async () => {
    const { body: past } = await create({ cinemaDate: '2026-10-16', label: 'Today', closed: true });
    await create({ cinemaDate: '2026-11-02', label: 'Later', closed: true });
    clock.set(new Date('2026-10-17T12:00:00+03:00'));
    // Access tokens last 15 minutes by the clock, so sign in again at the new time.
    admin = await signInStaff(testApp, admin.email, admin.password);

    const shownResponse = await theater();
    expect(shownResponse.status).toBe(200);
    const shown = shownResponse.body.specialDates as { cinemaDate: string }[];
    expect(shown.map((special) => special.cinemaDate)).toEqual(['2026-11-02']);
    expectError(
      await update((past as { id: number }).id, { label: 'Renamed' }),
      400,
      'VALIDATION_FAILED',
    );
    expect((await remove((past as { id: number }).id)).status).toBe(204);
    expect(await testApp.knex('theater_special_dates').count({ count: 'id' }).first()).toEqual({
      count: 1,
    });
  });

  it("answers NOT_FOUND for another theater's special date", async () => {
    const { body } = await create({ cinemaDate: '2026-10-25', label: 'Mine', closed: true });
    const id = (body as { id: number }).id;
    expectError(await update(id, { label: 'Theirs' }, otherTheaterId), 404, 'NOT_FOUND');
    expectError(await remove(id, otherTheaterId), 404, 'NOT_FOUND');
    expectError(
      await create({ cinemaDate: '2026-10-25', label: 'x', closed: true }, 999),
      404,
      'NOT_FOUND',
    );
    expect((await remove(id)).status).toBe(204);
    expectError(await remove(id), 404, 'NOT_FOUND');
  });
});
