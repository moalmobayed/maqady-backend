import type {
  PublicTheaterPageResponse,
  PublicTheaterResponse,
} from '../../../../src/modules/discovery/dto/public-theater.response';
import { expectStatus, idsOf } from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
import { countQueries, draftValidator, uploadTheaterPhoto } from '../../../support/discovery';
import { mediaDirectory, removeMediaDirectory } from '../../../support/media';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import {
  createTheater,
  everyDay,
  prepareTheater,
  setTheaterStatus,
} from '../../../support/theaters';
import type { StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(180_000);

const API = '/api/v1';
/** Friday 16 October 2026, 15:00 Cairo time (summer time, +03:00). */
const AFTERNOON = new Date('2026-10-16T12:00:00Z');

describe('The public theater reads', () => {
  let directory: string;
  let testApp: TestApp;
  let admin: StaffSession;
  const clock = new TestClock(AFTERNOON);
  const theater = { zamalek: 0, heliopolis: 0, evening: 0, hidden: 0, draft: 0, paused: 0 };

  const get = (path: string) => testApp.http().get(`${API}${path}`);
  const ok = async <T>(path: string): Promise<T> => expectStatus(await get(path), 200).body as T;
  const put = (path: string, body: object) =>
    testApp
      .http()
      .put(`${API}/admin/theaters/${path}`)
      .set('Authorization', admin.authorization)
      .send(body);

  const activeTheater = async (
    name: string,
    days: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ): Promise<number> => {
    const id = await createTheater(testApp, admin.authorization, {
      name,
      showContactsPublic: true,
      ...extra,
    });
    await prepareTheater(testApp, admin.authorization, id, days);
    expectStatus(
      await put(`${id}/phones`, {
        phones: [
          { label: 'Main line', number: '+20227351100' },
          { label: 'Box office', number: '+20227351101' },
        ],
      }),
      200,
    );
    await setTheaterStatus(testApp, admin.authorization, id, 'active');
    return id;
  };

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
      clock,
    });
    admin = await staffSession(testApp, 'admin');
    theater.zamalek = await activeTheater('Maqady Zamalek', everyDay('12:00', '01:00'), {
      email: 'zamalek@maqady.example',
      transitInfo: 'Metro: Opera station',
    });
    theater.heliopolis = await activeTheater('Maqady Heliopolis', everyDay('11:00', '00:30'));
    theater.evening = await activeTheater('maqady Evening', everyDay('18:00', '23:00'));
    theater.hidden = await activeTheater('Maqady Hidden Contacts', everyDay('12:00', '01:00'), {
      email: 'hidden@maqady.example',
      showContactsPublic: false,
    });
    theater.draft = await createTheater(testApp, admin.authorization, { name: 'Maqady Draft' });
    theater.paused = await activeTheater('Maqady Paused', everyDay('12:00', '01:00'));
    await setTheaterStatus(testApp, admin.authorization, theater.paused, 'sales_paused');

    expectStatus(
      await put(`${theater.zamalek}/facilities`, { facilities: ['valet_parking', 'cafe_bar'] }),
      200,
    );
    expectStatus(
      await put(`${theater.heliopolis}/facilities`, { facilities: ['free_parking'] }),
      200,
    );
    expectStatus(
      await put(`${theater.evening}/facilities`, { facilities: ['street_parking'] }),
      200,
    );
    await uploadTheaterPhoto(testApp, admin, theater.zamalek, 'cover');
    await uploadTheaterPhoto(testApp, admin, theater.zamalek, 'gallery', 'The lobby');
    await uploadTheaterPhoto(testApp, admin, theater.zamalek, 'gallery');
    // Special dates today + 6 (shown) and today + 7 (one day too far).
    for (const [cinemaDate, label] of [
      ['2026-10-22', 'Holiday hours'],
      ['2026-10-23', 'Too far'],
    ]) {
      expectStatus(
        await testApp
          .http()
          .post(`${API}/admin/theaters/${theater.zamalek}/special-dates`)
          .set('Authorization', admin.authorization)
          .set('Idempotency-Key', `special-${cinemaDate}`)
          .send({ cinemaDate, label, closed: false, opens: '10:00', closes: '03:00' }),
        201,
      );
    }
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  afterEach(() => {
    clock.set(AFTERNOON);
  });

  describe('GET /theaters', () => {
    it('lists every active theater alphabetically, ignoring case, with its hours and location', async () => {
      const response = expectStatus(await get('/theaters'), 200);
      expect(response.headers['cache-control']).toBe('public, max-age=60');
      const { items, total, nextCursor } = response.body;
      expect(idsOf(items)).toEqual([
        theater.evening,
        theater.heliopolis,
        theater.hidden,
        theater.zamalek,
      ]);
      expect(total).toBe(4);
      expect(nextCursor).toBeNull();
      const zamalek = items[3];
      expect(zamalek).toMatchObject({
        name: 'Maqady Zamalek',
        latitude: 30.0609,
        longitude: 31.2197,
        facilities: ['valet_parking', 'cafe_bar'],
        mainPhone: { label: 'Main line', number: '+20227351100' },
        hallCount: 0,
        openState: { isOpen: true, closesAt: '2026-10-17T01:00:00+03:00', nextOpensAt: null },
        today: {
          cinemaDate: '2026-10-16',
          closed: false,
          opens: '12:00',
          closes: '01:00',
          closesNextDay: true,
        },
      });
      expect(zamalek.cover.alt).toBe('Maqady Zamalek');
      expect(zamalek.weeklyHours).toHaveLength(7);
      expect(zamalek.weeklyHours[0]).toEqual({
        weekday: 1,
        closed: false,
        opens: '12:00',
        closes: '01:00',
        closesNextDay: true,
      });
      expect(items[2].mainPhone).toBeNull();
      // The list item is a TheaterCard plus its location and hours.
      const card = draftValidator('TheaterCard');
      const {
        latitude: _lat,
        longitude: _lng,
        today: _today,
        weeklyHours: _weekly,
        ...rest
      } = zamalek;
      expect(card(rest)).toBe(true);
    });

    it('keeps the theaters open at the Clock with openNow, across midnight', async () => {
      // 15:00: the evening theater opens at 18:00.
      expect(idsOf((await ok<PublicTheaterPageResponse>('/theaters?openNow=true')).items)).toEqual([
        theater.heliopolis,
        theater.hidden,
        theater.zamalek,
      ]);
      // 00:45 on Saturday: Friday's hours; Heliopolis closed at 00:30, Zamalek closes at 01:00.
      clock.set(new Date('2026-10-16T21:45:00Z'));
      const late = await ok<PublicTheaterPageResponse>('/theaters?openNow=true');
      expect(idsOf(late.items)).toEqual([theater.hidden, theater.zamalek]);
      expect(late.total).toBe(2);
      clock.set(new Date('2026-10-16T22:15:00Z'));
      expect((await ok<PublicTheaterPageResponse>('/theaters?openNow=true')).items).toEqual([]);
    });

    it('keeps the theaters with free or valet parking', async () => {
      expect(idsOf((await ok<PublicTheaterPageResponse>('/theaters?parking=true')).items)).toEqual([
        theater.heliopolis,
        theater.zamalek,
      ]);
      expect((await ok<PublicTheaterPageResponse>('/theaters?parking=false')).total).toBe(4);
      expect((await get('/theaters?parking=yes')).status).toBe(400);
    });

    it('pages with the cursor without repeats', async () => {
      const first = await ok<PublicTheaterPageResponse>('/theaters?limit=3');
      expect(idsOf(first.items)).toEqual([theater.evening, theater.heliopolis, theater.hidden]);
      const second = await ok<PublicTheaterPageResponse>(
        `/theaters?limit=3&cursor=${first.nextCursor}`,
      );
      expect(idsOf(second.items)).toEqual([theater.zamalek]);
      expect(second.nextCursor).toBeNull();
      expect(second.total).toBe(4);
    });

    it('costs the same number of queries for one theater and for four', async () => {
      const four = await countQueries(testApp, () => get('/theaters'));
      const one = await countQueries(testApp, () =>
        get('/theaters?openNow=true&parking=true&limit=1'),
      );
      const home = await countQueries(testApp, () => get('/home'));
      expect(one).toBe(four);
      // The theaters, phones, facilities, photos, images; open-state, today's and weekly hours.
      expect(four).toBe(10);
      expect(home).toBeLessThanOrEqual(25);
    });
  });

  describe('GET /theaters/{id}', () => {
    it("returns an active theater's page with gallery, hours and the special dates of the next 7 days", async () => {
      const body = await ok<PublicTheaterResponse>(`/theaters/${theater.zamalek}`);
      expect(body).toMatchObject({
        id: theater.zamalek,
        name: 'Maqady Zamalek',
        transitInfo: 'Metro: Opera station',
        email: 'zamalek@maqady.example',
        phones: [
          { label: 'Main line', number: '+20227351100' },
          { label: 'Box office', number: '+20227351101' },
        ],
        hallCount: 0,
        openState: { isOpen: true },
      });
      expect(body.photos.map((photo: { caption: string | null }) => photo.caption)).toEqual([
        'The lobby',
        null,
      ]);
      expect(body.photos.map((photo) => photo.image.alt)).toEqual(['The lobby', 'Maqady Zamalek']);
      expect(body.specialDates).toEqual([
        expect.objectContaining({
          cinemaDate: '2026-10-22',
          label: 'Holiday hours',
          closes: '03:00',
        }),
      ]);
      expect(body.weeklyHours).toHaveLength(7);
    });

    it('hides phones and email when the theater hides its contacts', async () => {
      const body = await ok<PublicTheaterResponse>(`/theaters/${theater.hidden}`);
      expect(body.phones).toEqual([]);
      expect(body.email).toBeNull();
    });

    it('is NOT_FOUND for a draft, a paused or an unknown theater', async () => {
      for (const id of [theater.draft, theater.paused, 999999]) {
        const response = await get(`/theaters/${id}`);
        expect({ id, status: response.status, code: response.body.error.code }).toEqual({
          id,
          status: 404,
          code: 'NOT_FOUND',
        });
      }
      expect((await get('/theaters/0')).status).toBe(400);
    });

    it('never lets a shared cache keep an error: no public Cache-Control on a 404 or a 400', async () => {
      for (const path of [`/theaters/${theater.draft}`, '/theaters/0', '/theaters?openNow=yes']) {
        const response = await get(path);
        expect({
          path,
          status: response.status >= 400,
          cacheControl: response.headers['cache-control'],
        }).toEqual({
          path,
          status: true,
          cacheControl: 'no-store',
        });
      }
    });
  });
});
