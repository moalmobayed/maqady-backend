import { randomUUID } from 'node:crypto';
import { formatCairoIso } from '../../../../src/common/time/time';
import { TheaterHoursService } from '../../../../src/modules/theaters/theater-hours.service';
import type { OpenState } from '../../../../src/modules/theaters/types';
import { TestClock } from '../../../support/clock';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { createTheater, everyDay, prepareTheater, THEATERS } from '../../../support/theaters';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

function written(state: OpenState | undefined) {
  return {
    isOpen: state?.isOpen,
    closesAt: state?.closesAt ? formatCairoIso(state.closesAt) : null,
    nextOpensAt: state?.nextOpensAt ? formatCairoIso(state.nextOpensAt) : null,
  };
}

/**
 * Three real theaters (weekly hours and special dates written through the admin routes) and the
 * exported `TheaterHoursService` reading them back, at fixed instants around normal days and the
 * 2026 summer-time changes.
 */
describe('TheaterHoursService (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let hoursService: TheaterHoursService;
  let normal: number;
  let late: number;
  let holiday: number;
  const clock = new TestClock(new Date('2026-04-20T10:00:00+02:00'));

  const at = async (instant: string) => {
    const states = await hoursService.openStates([normal, late, holiday], new Date(instant));
    return {
      normal: written(states.get(normal)),
      late: written(states.get(late)),
      holiday: written(states.get(holiday)),
    };
  };

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    hoursService = testApp.app.get(TheaterHoursService);
    admin = await staffSession(testApp, 'admin');

    normal = await createTheater(testApp, admin.authorization, { name: 'Normal' });
    await prepareTheater(testApp, admin.authorization, normal, everyDay('12:00', '23:30'));
    late = await createTheater(testApp, admin.authorization, { name: 'Late' });
    await prepareTheater(testApp, admin.authorization, late, everyDay('12:00', '00:30'));
    holiday = await createTheater(testApp, admin.authorization, { name: 'Holiday' });
    await prepareTheater(testApp, admin.authorization, holiday, everyDay('12:00', '01:00'));

    const special = async (cinemaDate: string, body: object) => {
      const response = await testApp
        .http()
        .post(`${THEATERS}/${holiday}/special-dates`)
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ cinemaDate, label: 'Holiday', ...body });
      expect(response.status).toBe(201);
    };
    await special('2026-04-23', { closed: true });
    await special('2026-04-25', { closed: false, opens: '11:00', closes: '03:00' });
    // Special dates must be today's cinema date or later, so the October one waits for its clock.
    clock.set(new Date('2026-10-20T10:00:00+03:00'));
    admin = await signInStaff(testApp, admin.email, admin.password);
    await special('2026-10-29', { closed: false, opens: '14:00', closes: '23:30' });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('on the evening before summer time starts (23 April), with a closing moved to 01:00', async () => {
    expect(await at('2026-04-23T23:50:00+02:00')).toEqual({
      normal: { isOpen: false, closesAt: null, nextOpensAt: '2026-04-24T12:00:00+03:00' },
      // 00:30 does not exist that night, so the stored closing moves to 01:00 summer time.
      late: { isOpen: true, closesAt: '2026-04-24T01:00:00+03:00', nextOpensAt: null },
      // Closed on its special date: next opening is the next cinema date.
      holiday: { isOpen: false, closesAt: null, nextOpensAt: '2026-04-24T12:00:00+03:00' },
    });
  });

  it('on a special date with changed hours, after the weekly closing', async () => {
    expect((await at('2026-04-26T02:30:00+03:00')).holiday).toEqual({
      isOpen: true,
      closesAt: '2026-04-26T03:00:00+03:00',
      nextOpensAt: null,
    });
    expect((await at('2026-04-25T11:30:00+03:00')).holiday.isOpen).toBe(true);
    expect((await at('2026-04-25T11:30:00+03:00')).normal).toEqual({
      isOpen: false,
      closesAt: null,
      nextOpensAt: '2026-04-25T12:00:00+03:00',
    });
  });

  it('on the night summer time ends (29 October), at the second 23:45', async () => {
    expect(await at('2026-10-29T23:45:00+02:00')).toEqual({
      // Closes at the first 23:30, an hour and a quarter of real time ago.
      normal: { isOpen: false, closesAt: null, nextOpensAt: '2026-10-30T12:00:00+02:00' },
      late: { isOpen: true, closesAt: '2026-10-30T00:30:00+02:00', nextOpensAt: null },
      holiday: { isOpen: false, closesAt: null, nextOpensAt: '2026-10-30T12:00:00+02:00' },
    });
  });

  it('gives U7 the opening window of a cinema date, special dates included', async () => {
    const window = async (theaterId: number, date: string) => {
      const found = await hoursService.windowFor(theaterId, date);
      return found && [formatCairoIso(found.opensAt), formatCairoIso(found.closesAt)];
    };
    expect(await window(holiday, '2026-04-25')).toEqual([
      '2026-04-25T11:00:00+03:00',
      '2026-04-26T03:00:00+03:00',
    ]);
    expect(await window(holiday, '2026-04-23')).toBeNull();
    expect(await window(late, '2026-04-23')).toEqual([
      '2026-04-23T12:00:00+02:00',
      '2026-04-24T01:00:00+03:00',
    ]);
    expect(await window(holiday, '2026-10-29')).toEqual([
      '2026-10-29T14:00:00+03:00',
      '2026-10-29T23:30:00+03:00',
    ]);
  });

  it('resolves every date of a range, naming where the hours came from', async () => {
    const days = (await hoursService.hoursFor([holiday], '2026-04-22', '2026-04-25')).get(holiday)!;
    expect(
      days.map((day) => [day.cinemaDate, day.weekday, day.source, day.window !== null]),
    ).toEqual([
      ['2026-04-22', 3, 'weekly', true],
      ['2026-04-23', 4, 'special', false],
      ['2026-04-24', 5, 'weekly', true],
      ['2026-04-25', 6, 'special', true],
    ]);
    await expect(hoursService.hoursFor([holiday], '2026-04-01', '2026-05-02')).rejects.toThrow(
      /at most 31/,
    );
  });

  it('shows the same open state on GET /admin/theaters/{id}', async () => {
    clock.set(new Date('2026-10-29T23:45:00+02:00'));
    admin = await signInStaff(testApp, admin.email, admin.password);
    const response = await testApp
      .http()
      .get(`${THEATERS}/${late}`)
      .set('Authorization', admin.authorization);
    expect(response.body.openState).toEqual({
      isOpen: true,
      closesAt: '2026-10-30T00:30:00+02:00',
      nextOpensAt: null,
    });
  });
});
