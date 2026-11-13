import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildOpenApiDocument } from '../../../../src/common/swagger/openapi-document';
import type {
  PublicTheaterPageResponse,
  PublicTheaterResponse,
} from '../../../../src/modules/discovery/dto/public-theater.response';
import { expectStatus, idsOf } from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
import {
  countQueries,
  draftValidator,
  toJsonSchema,
  uploadTheaterPhoto,
} from '../../../support/discovery';
import {
  HALLS,
  addActiveHall,
  createHall,
  setHallSpec,
  setHallStatus,
} from '../../../support/halls';
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
  const hall = { small: 0 };

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
    await addActiveHall(testApp, admin.authorization, id);
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
    // Zamalek's halls besides its first: an active one with wheelchair spaces, a draft and a
    // retired one (neither open to customers).
    hall.small = await createHall(testApp, admin.authorization, theater.zamalek, 'A small hall');
    expectStatus(
      await testApp
        .http()
        .put(`${HALLS}/${hall.small}/layout`)
        .set('Authorization', admin.authorization)
        .send({
          rowCount: 4,
          seatsPerRow: 8,
          rowZones: ['front', 'middle', 'middle', 'back'],
          seatMarks: [
            { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
            { rowLabel: 'A', seatNumber: 2, kind: 'wheelchair' },
            { rowLabel: 'D', seatNumber: 8, kind: 'no_seat' },
          ],
        }),
      200,
    );
    await setHallStatus(testApp, admin.authorization, hall.small, 'active');
    await setHallSpec(testApp, admin.authorization, hall.small, {
      format: 'dolby_atmos',
      screenWidthMeters: 22.1,
      screenHeightMeters: 12.3,
    });
    await createHall(testApp, admin.authorization, theater.zamalek, 'B draft hall');
    const retired = await createHall(testApp, admin.authorization, theater.zamalek, 'C old hall');
    await setHallStatus(testApp, admin.authorization, retired, 'active');
    await setHallStatus(testApp, admin.authorization, retired, 'retired');
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
        // Its two active halls; the draft and the retired one are not open to customers.
        hallCount: 2,
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
      // The theaters, phones, facilities, photos, images; open-state, today's and weekly hours;
      // the active halls, their rows and seat marks (the hall counts).
      expect(four).toBe(13);
      // Those, the carousel, genres, both movie rows and the ticker (no showtime scheduled here:
      // the active theaters and the next showtimes).
      expect(home).toBeLessThanOrEqual(34);
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
        hallCount: 2,
        openState: { isOpen: true },
      });
      // Active halls only, by name: seats count wheelchair spaces, not gaps. Each with its
      // format and its screen in metres (#29 P4); a hall never given a size has none.
      expect(body.halls).toEqual([
        {
          id: hall.small,
          name: 'A small hall',
          seatCount: 31,
          wheelchairCount: 2,
          format: 'dolby_atmos',
          screen: { widthMeters: 22.1, heightMeters: 12.3 },
        },
        {
          id: expect.any(Number),
          name: expect.stringMatching(/^Hall /),
          seatCount: 192,
          wheelchairCount: 0,
          format: 'standard',
          screen: null,
        },
      ]);
      // The halls' new fields match the generated contract (`PublicHall`, `HallScreen`).
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile({
        definitions: toJsonSchema(buildOpenApiDocument(testApp.app).components?.schemas) as Record<
          string,
          object
        >,
        $ref: '#/definitions/PublicTheater',
      });
      expect({ valid: validate(body), errors: validate.errors ?? [] }).toEqual({
        valid: true,
        errors: [],
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
  describe('#29 theater fields', () => {
    const patch = (id: number, body: object) =>
      testApp
        .http()
        .patch(`${API}/admin/theaters/${id}`)
        .set('Authorization', admin.authorization)
        .send(body);

    beforeAll(async () => {
      expectStatus(
        await patch(theater.zamalek, { postalCode: '11211', whatsapp: '+201001234567' }),
        200,
      );
      expectStatus(
        await patch(theater.hidden, { postalCode: '11757', whatsapp: '+201005550000' }),
        200,
      );
      expectStatus(
        await put(`${theater.hidden}/facilities`, { facilities: ['prayer_room', 'kids_room'] }),
        200,
      );
    });

    /** Every page of `GET /theaters` with this query, one theater per page. */
    const everyPage = async (query: string): Promise<PublicTheaterPageResponse[]> => {
      const pages: PublicTheaterPageResponse[] = [];
      let cursor: string | null = null;
      do {
        const suffix: string = cursor === null ? '' : `&cursor=${cursor}`;
        const page: PublicTheaterPageResponse = await ok<PublicTheaterPageResponse>(
          `/theaters?limit=1${query}${suffix}`,
        );
        pages.push(page);
        cursor = page.nextCursor;
      } while (cursor !== null);
      return pages;
    };

    it('puts the postal code on every card and the prayer room in the facilities', async () => {
      const { items } = await ok<PublicTheaterPageResponse>('/theaters');
      expect(items.map((item) => [item.id, item.postalCode])).toEqual([
        [theater.evening, null],
        [theater.heliopolis, null],
        [theater.hidden, '11757'],
        [theater.zamalek, '11211'],
      ]);
      const hidden = items[2]!;
      // The facility order of the list, prayer room last; the postal code even with contacts hidden.
      expect(hidden.facilities).toEqual(['kids_room', 'prayer_room']);
      expect(hidden.mainPhone).toBeNull();
      const {
        latitude: _lat,
        longitude: _lng,
        today: _today,
        weeklyHours: _weekly,
        ...card
      } = hidden;
      const validate = draftValidator('TheaterCard');
      expect(validate(card)).toBe(true);
      // The card never carries the WhatsApp number: it is on the theater page only.
      expect(Object.keys(hidden)).not.toContain('whatsapp');
    });

    it('returns totalHalls, the active halls of every matching theater, the same on every page', async () => {
      const pages = await everyPage('');
      expect(pages).toHaveLength(4);
      const cards = pages.flatMap((page) => page.items);
      // Zamalek 2 (its draft and retired halls left out), the three others 1 each; the paused
      // theater's hall is not counted.
      expect(cards.map((card) => card.hallCount)).toEqual([1, 1, 1, 2]);
      const sum = cards.reduce((total, card) => total + card.hallCount, 0);
      expect(sum).toBe(5);
      expect(pages.map((page) => page.totalHalls)).toEqual([5, 5, 5, 5]);
      expect(pages.map((page) => page.total)).toEqual([4, 4, 4, 4]);
      expect((await ok<PublicTheaterPageResponse>('/theaters')).totalHalls).toBe(5);
    });

    it('follows the filters: parking, and openNow at the Clock', async () => {
      const parking = await everyPage('&parking=true');
      expect(parking.flatMap((page) => idsOf(page.items))).toEqual([
        theater.heliopolis,
        theater.zamalek,
      ]);
      expect(parking.map((page) => page.totalHalls)).toEqual([3, 3]);
      // 00:45 on Saturday: only the hidden-contacts theater (1) and Zamalek (2) are open.
      clock.set(new Date('2026-10-16T21:45:00Z'));
      const late = await everyPage('&openNow=true');
      expect(late.map((page) => page.totalHalls)).toEqual([3, 3]);
      clock.set(new Date('2026-10-16T22:15:00Z'));
      expect(await ok<PublicTheaterPageResponse>('/theaters?openNow=true')).toMatchObject({
        items: [],
        total: 0,
        totalHalls: 0,
      });
    });

    it('returns the postal code, the WhatsApp number and its wa.me link on the theater page', async () => {
      const body = await ok<PublicTheaterResponse>(`/theaters/${theater.zamalek}`);
      expect(body).toMatchObject({
        city: 'Cairo',
        postalCode: '11211',
        whatsapp: '+201001234567',
        whatsappUrl: 'https://wa.me/201001234567',
      });
      const none = await ok<PublicTheaterResponse>(`/theaters/${theater.heliopolis}`);
      expect(none).toMatchObject({ postalCode: null, whatsapp: null, whatsappUrl: null });
    });

    it('hides the WhatsApp number and its link, not the postal code, when contacts are hidden', async () => {
      const body = await ok<PublicTheaterResponse>(`/theaters/${theater.hidden}`);
      expect(body).toMatchObject({
        postalCode: '11757',
        whatsapp: null,
        whatsappUrl: null,
        email: null,
        phones: [],
        facilities: ['kids_room', 'prayer_room'],
      });
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('201005550000');
    });

    it('puts the postal code and the prayer room on the home page cards, as the draft allows', async () => {
      const home = await ok<{ cinemas: { id: number; postalCode: string | null }[] }>('/home');
      const hidden = home.cinemas.find((card) => card.id === theater.hidden);
      expect(hidden).toMatchObject({
        postalCode: '11757',
        facilities: ['kids_room', 'prayer_room'],
      });
      expect(draftValidator('HomeResponse')(home)).toBe(true);
    });
  });
});
