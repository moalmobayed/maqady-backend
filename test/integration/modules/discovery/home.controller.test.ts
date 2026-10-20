import type { HomeResponse } from '../../../../src/modules/discovery/dto/home.response';
import { HomeTickerSource } from '../../../../src/modules/discovery/home-ticker.source';
import {
  adminWrite,
  createDraftMovie,
  createPublishedMovie,
  expectStatus,
  genreId,
} from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
import {
  draftValidator,
  FixedTickerSource,
  uploadBackdrop,
  uploadPoster,
  uploadTheaterPhoto,
} from '../../../support/discovery';
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

const HOME = '/api/v1/home';

interface Card {
  id: number;
  title: string;
  releaseDate: string;
  status: string;
}

/** 13 Now showing and 13 Coming soon movies, so each home row shows 12 of 13. */
const NOW_SHOWING_DATES = Array.from(
  { length: 13 },
  (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
);
const COMING_SOON_DATES = Array.from(
  { length: 13 },
  (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`,
);

describe('GET /home', () => {
  let directory: string;
  let testApp: TestApp;
  let admin: StaffSession;
  const clock = new TestClock(new Date('2026-10-16T12:00:00Z'));
  const ids = { nowShowing: [] as number[], comingSoon: [] as number[], hidden: [] as number[] };
  const theaters = { zamalek: 0, hidden: 0, draft: 0, paused: 0 };
  const expectedGenreCounts = new Map<string, number>();

  const home = async (): Promise<HomeResponse> =>
    expectStatus(await testApp.http().get(HOME), 200).body as HomeResponse;

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
      clock,
    });
    admin = await staffSession(testApp, 'admin');
    const count = (slugs: string[]) => {
      for (const slug of slugs)
        expectedGenreCounts.set(slug, (expectedGenreCounts.get(slug) ?? 0) + 1);
    };

    // Created out of order, so the order comes from the release date, not the id.
    for (const releaseDate of [...NOW_SHOWING_DATES].reverse()) {
      const genres = releaseDate.endsWith('1') ? ['action', 'drama'] : ['drama'];
      const movie = await createPublishedMovie(testApp, admin, {
        status: 'now_showing',
        releaseDate,
        genres,
      });
      ids.nowShowing.push(movie.id);
      count(genres);
    }
    for (const releaseDate of COMING_SOON_DATES) {
      const movie = await createPublishedMovie(testApp, admin, {
        status: 'coming_soon',
        releaseDate,
        genres: ['sci-fi'],
      });
      ids.comingSoon.push(movie.id);
      count(['sci-fi']);
    }
    // A draft and an archived movie, both in a genre no public movie has.
    const draft = await createDraftMovie(testApp, admin, {
      title: 'Hidden draft',
      genreIds: [await genreId(testApp, 'comedy')],
    });
    const archived = await createPublishedMovie(testApp, admin, {
      title: 'Hidden archived',
      genres: ['comedy'],
    });
    expectStatus(
      await adminWrite(testApp, admin, 'patch', `/api/v1/admin/movies/${archived.id}`).send({
        status: 'archived',
      }),
      200,
    );
    ids.hidden.push(draft.id, archived.id);

    // The carousel: positions given out of order, on movies of both tabs.
    for (const [position, movieId] of [
      [3, ids.nowShowing[0]!],
      [1, ids.comingSoon[2]!],
      [5, ids.nowShowing[4]!],
      [2, ids.nowShowing[7]!],
      [4, ids.comingSoon[9]!],
    ] as const) {
      const video = await adminWrite(
        testApp,
        admin,
        'post',
        `/api/v1/admin/movies/${movieId}/videos`,
      ).send({ url: 'https://youtu.be/aBcDeFgHiJk', title: 'Official trailer', kind: 'trailer' });
      const heroVideoId = (expectStatus(video, 201).body.videos as { id: number }[])[0]!.id;
      expectStatus(
        await adminWrite(testApp, admin, 'patch', `/api/v1/admin/movies/${movieId}`).send({
          heroVideoId,
          featuredPosition: position,
        }),
        200,
      );
    }
    await uploadPoster(testApp, admin, ids.nowShowing[0]!);
    await uploadBackdrop(testApp, admin, ids.nowShowing[0]!);

    // Theaters: two active (one hiding its contacts), a draft and a paused one.
    theaters.zamalek = await createTheater(testApp, admin.authorization, {
      name: 'Maqady Zamalek',
      showContactsPublic: true,
    });
    theaters.hidden = await createTheater(testApp, admin.authorization, {
      name: 'maqady Abbassia',
      showContactsPublic: false,
    });
    theaters.draft = await createTheater(testApp, admin.authorization, { name: 'Maqady Draft' });
    theaters.paused = await createTheater(testApp, admin.authorization, { name: 'Maqady Paused' });
    for (const id of [theaters.zamalek, theaters.hidden, theaters.draft, theaters.paused]) {
      await prepareTheater(testApp, admin.authorization, id, everyDay('12:00', '01:00'));
      expectStatus(
        await testApp
          .http()
          .put(`/api/v1/admin/theaters/${id}/phones`)
          .set('Authorization', admin.authorization)
          .send({ phones: [{ label: 'Main line', number: '+20227351100' }] }),
        200,
      );
    }
    expectStatus(
      await testApp
        .http()
        .put(`/api/v1/admin/theaters/${theaters.zamalek}/facilities`)
        .set('Authorization', admin.authorization)
        .send({ facilities: ['cafe_bar', 'wheelchair_access'] }),
      200,
    );
    await uploadTheaterPhoto(testApp, admin, theaters.zamalek, 'cover');
    for (const id of [theaters.zamalek, theaters.hidden, theaters.paused]) {
      await setTheaterStatus(testApp, admin.authorization, id, 'active');
    }
    await setTheaterStatus(testApp, admin.authorization, theaters.paused, 'sales_paused');
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  it('answers without a token, and ignores one', async () => {
    const response = await testApp.http().get(HOME).set('Authorization', 'Bearer not-a-token');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('validates against HomeResponse of the home-page contract agreed with the frontend', async () => {
    const body = await home();
    const validate = draftValidator('HomeResponse');
    expect({ valid: validate(body), errors: validate.errors ?? [] }).toEqual({
      valid: true,
      errors: [],
    });
    // The images and the nullable parts the schema allows are really there.
    const lighthouse = body.nowShowing.items.find((card) => card.id === ids.nowShowing[0])!;
    expect(lighthouse.poster!.variants.map((variant: { name: string }) => variant.name)).toEqual([
      'small',
      'medium',
      'large',
    ]);
    const slide = body.featured.find((item) => item.movie.id === ids.nowShowing[0])!;
    expect(slide.backdrop!.alt).toBe(slide.movie.title);
    expect(slide.heroVideo.embedUrl).toBe('https://www.youtube-nocookie.com/embed/aBcDeFgHiJk');
    const zamalek = body.cinemas.find((card) => card.id === theaters.zamalek)!;
    expect(zamalek.cover!.alt).toBe('Maqady Zamalek');
    expect(zamalek.facilities).toEqual(['wheelchair_access', 'cafe_bar']);
    expect(zamalek.hallCount).toBe(0);
    expect(body.ticker).toEqual([]);
  });

  it('refuses a response that breaks the contract (the validator really checks)', async () => {
    const body = await home();
    const validate = draftValidator('HomeResponse');
    expect(validate({ ...body, cinemaDate: '16/10/2026' })).toBe(false);
    expect(validate({ ...body, featured: [...body.featured, body.featured[0]] })).toBe(false);
    expect(validate({ ...body, ticker: undefined })).toBe(false);
  });

  it('gives the carousel in position order, at most 5', async () => {
    const body = await home();
    expect(
      body.featured.map((slide: { position: number; movie: { id: number } }) => [
        slide.position,
        slide.movie.id,
      ]),
    ).toEqual([
      [1, ids.comingSoon[2]],
      [2, ids.nowShowing[7]],
      [3, ids.nowShowing[0]],
      [4, ids.comingSoon[9]],
      [5, ids.nowShowing[4]],
    ]);
  });

  it('shows 12 of 13 Now showing movies newest release first, and the total', async () => {
    const body = await home();
    expect(body.nowShowing.total).toBe(13);
    expect(body.nowShowing.items.map((card: Card) => card.releaseDate)).toEqual(
      [...NOW_SHOWING_DATES].reverse().slice(0, 12),
    );
    expect(body.nowShowing.items.every((card: Card) => card.status === 'now_showing')).toBe(true);
  });

  it('shows 12 of 13 Coming soon movies soonest release first, and the total', async () => {
    const body = await home();
    expect(body.comingSoon.total).toBe(13);
    expect(body.comingSoon.items.map((card: Card) => card.releaseDate)).toEqual(
      COMING_SOON_DATES.slice(0, 12),
    );
  });

  it('never shows a draft or an archived movie, nor a draft or paused theater', async () => {
    const body = await home();
    const movieIds = [
      ...body.featured.map((slide: { movie: { id: number } }) => slide.movie.id),
      ...body.nowShowing.items.map((card: Card) => card.id),
      ...body.comingSoon.items.map((card: Card) => card.id),
    ];
    for (const hidden of ids.hidden) expect(movieIds).not.toContain(hidden);
    expect(body.cinemas.map((card: { id: number }) => card.id)).toEqual([
      theaters.hidden,
      theaters.zamalek,
    ]);
  });

  it('counts only public movies in each genre, for every genre, alphabetical', async () => {
    const body = await home();
    const genres = body.genres as { slug: string; name: string; movieCount: number }[];
    expect(genres.map((genre) => genre.name)).toEqual(
      [...genres.map((genre) => genre.name)].sort((a, b) => a.localeCompare(b)),
    );
    expect(genres).toHaveLength(10);
    for (const genre of genres) {
      expect({ slug: genre.slug, count: genre.movieCount }).toEqual({
        slug: genre.slug,
        count: expectedGenreCounts.get(genre.slug) ?? 0,
      });
    }
    expect(genres.find((genre) => genre.slug === 'comedy')!.movieCount).toBe(0);
  });

  it('hides the main phone of a theater that hides its contacts', async () => {
    const body = await home();
    const byId = new Map(body.cinemas.map((card) => [card.id, card]));
    expect(byId.get(theaters.zamalek)!.mainPhone).toEqual({
      label: 'Main line',
      number: '+20227351100',
    });
    expect(byId.get(theaters.hidden)!.mainPhone).toBeNull();
  });

  it('judges the open state at the Clock, across a closing at 01:00 after midnight', async () => {
    const stateAt = async (instant: string) => {
      clock.set(new Date(instant));
      const body = await home();
      const card = body.cinemas.find((item) => item.id === theaters.zamalek)!;
      return { serverTime: body.serverTime, cinemaDate: body.cinemaDate, ...card.openState };
    };
    // Friday 16 October 2026 at 23:00, then Saturday 00:30 (still Friday's cinema day), 01:30.
    expect(await stateAt('2026-10-16T20:00:00Z')).toEqual({
      serverTime: '2026-10-16T23:00:00+03:00',
      cinemaDate: '2026-10-16',
      isOpen: true,
      closesAt: '2026-10-17T01:00:00+03:00',
      nextOpensAt: null,
    });
    expect(await stateAt('2026-10-16T21:30:00Z')).toEqual({
      serverTime: '2026-10-17T00:30:00+03:00',
      cinemaDate: '2026-10-16',
      isOpen: true,
      closesAt: '2026-10-17T01:00:00+03:00',
      nextOpensAt: null,
    });
    expect(await stateAt('2026-10-16T22:30:00Z')).toEqual({
      serverTime: '2026-10-17T01:30:00+03:00',
      cinemaDate: '2026-10-16',
      isOpen: false,
      closesAt: null,
      nextOpensAt: '2026-10-17T12:00:00+03:00',
    });
    clock.set(new Date('2026-10-16T12:00:00Z'));
  });
});

describe('GET /home with a ticker source (the seam U8b fills)', () => {
  let testApp: TestApp;
  const startsAt = new Date('2026-10-16T13:15:00Z');

  beforeAll(async () => {
    testApp = await createTestApp({
      overrides: [
        {
          provide: HomeTickerSource,
          useValue: new FixedTickerSource([
            {
              movie: { id: 1, title: 'The Last Lighthouse' },
              nextShowtime: {
                id: 501,
                startsAt,
                cinemaDate: '2026-10-16',
                theater: { id: 1, name: 'Maqady Zamalek' },
              },
            },
          ]),
        },
      ],
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('publishes each entry as a TickerItem with Cairo times', async () => {
    const body = expectStatus(await testApp.http().get(HOME), 200).body as HomeResponse;
    expect(body.ticker).toEqual([
      {
        movie: { id: 1, title: 'The Last Lighthouse' },
        nextShowtime: {
          id: 501,
          startsAt: '2026-10-16T16:15:00+03:00',
          cinemaDate: '2026-10-16',
          theater: { id: 1, name: 'Maqady Zamalek' },
        },
      },
    ]);
    const validate = draftValidator('HomeResponse');
    expect({ valid: validate(body), errors: validate.errors ?? [] }).toEqual({
      valid: true,
      errors: [],
    });
    expect(body.featured).toEqual([]);
    expect(body.cinemas).toEqual([]);
    expect(body.nowShowing).toEqual({ items: [], total: 0 });
  });
});
