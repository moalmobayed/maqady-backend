import { addDays } from '../../common/time/time';
import {
  SEED_HALL_NAME,
  SEED_IMAGE_SIZES,
  SEED_LIST_LIMIT,
  SEED_PRICES,
  SEED_SHOWTIME_DAYS,
} from './seed.constants';
import { downloadedImage, placeholderImage } from './seed-images';
import type {
  SeedAdminMovie,
  SeedAdminTheater,
  SeedApi,
  SeedContext,
  SeedCreatedRow,
  SeedGenreRow,
  SeedHallRow,
  SeedImageSize,
  SeedMovie,
  SeedNamedRow,
  SeedPage,
  SeedPersonRow,
  SeedShowtimeBatch,
  SeedShowtimeCheck,
  SeedStep,
  SeedStepResult,
  SeedTheater,
  SeedTimelineShowtime,
  SeedTitledRow,
} from './types';

/**
 * The steps of `npm run seed`, in order. Each finds what exists through the admin list routes
 * and creates only what is missing, so the seed can run again (or resume after a failure)
 * without duplicating anything. Every step reads `context.dataset`. `halls` gives each theater
 * to publish its active halls (the `active_hall` publish requirement, U5) before
 * `publish-theaters`; `showtimes` (U8b) schedules
 * the next 7 cinema days last, once the movies are Now showing.
 */
export const SEED_STEPS: readonly SeedStep[] = [
  { name: 'theaters', run: seedTheaters },
  { name: 'halls', run: seedHalls },
  { name: 'publish-theaters', run: publishTheaters },
  { name: 'people', run: seedPeople },
  { name: 'movies', run: seedMovies },
  { name: 'featured', run: seedFeatured },
  { name: 'showtimes', run: seedShowtimes },
];

/** Every row of an admin list, page by page; `path` may carry its own filters. */
async function listAll<T>(api: SeedApi, path: string): Promise<T[]> {
  const rows: T[] = [];
  const separator = path.includes('?') ? '&' : '?';
  let cursor: string | null = null;
  do {
    const query: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const page: SeedPage<T> = await api.get<SeedPage<T>>(
      `${path}${separator}limit=${SEED_LIST_LIMIT}${query}`,
    );
    rows.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return rows;
}

/** Drops the keys whose value is null, for create bodies whose optional fields can't be null. */
function withoutNulls(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null));
}

function filename(text: string): string {
  return `${text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`;
}

/**
 * The picture to upload: downloaded from `url` when the dataset names one, or generated from
 * `colour` and `seed` when it leaves the picture out.
 */
function image(
  url: string | undefined,
  { width, height }: SeedImageSize,
  colour: string,
  seed: string,
): Promise<Buffer> {
  return url === undefined
    ? placeholderImage(width, height, colour, seed)
    : downloadedImage(url, width, height);
}

/** `image()`, or none when the dataset says the picture is `null`. */
async function picture(
  url: string | null | undefined,
  size: SeedImageSize,
  colour: string,
  seed: string,
): Promise<Buffer | null> {
  return url === null ? null : image(url, size, colour, seed);
}

/** Where `context.hallIds` keeps a theater's hall. */
function hallKey(theater: string, hall: string): string {
  return `${theater}|${hall}`;
}

// --- Theaters -------------------------------------------------------------------------------

async function seedTheaters(context: SeedContext): Promise<SeedStepResult> {
  const { api } = context;
  const existing = new Map(
    (await listAll<SeedNamedRow>(api, '/admin/theaters')).map((row) => [
      row.name.toLowerCase(),
      row.id,
    ]),
  );
  const { theaters } = context.dataset;
  let created = 0;
  for (const theater of theaters) {
    let id = existing.get(theater.name.toLowerCase());
    if (id === undefined) {
      const body = withoutNulls({
        name: theater.name,
        address: theater.address,
        district: theater.district,
        city: theater.city,
        latitude: theater.latitude,
        longitude: theater.longitude,
        transitInfo: theater.transitInfo,
        parkingInfo: theater.parkingInfo,
        email: theater.email,
        showContactsPublic: theater.showContactsPublic,
      });
      id = (await api.write<SeedCreatedRow>('POST', '/admin/theaters', body)).id;
      created += 1;
    }
    context.theaterIds.set(theater.name, id);
    await completeTheater(context, id, theater);
  }
  return { created, kept: theaters.length - created };
}

/** Sets whatever of the theater is still missing: hours, phones, facilities, prices, photos. */
async function completeTheater(
  context: SeedContext,
  id: number,
  theater: SeedTheater,
): Promise<void> {
  const { api } = context;
  const path = `/admin/theaters/${id}`;
  const current = await api.get<SeedAdminTheater>(path);
  if (current.hours.length === 0) await api.write('PUT', `${path}/hours`, { days: theater.hours });
  if (current.phones.length === 0 && theater.phones.length > 0) {
    await api.write('PUT', `${path}/phones`, { phones: theater.phones });
  }
  if (current.facilities.length === 0 && theater.facilities.length > 0) {
    await api.write('PUT', `${path}/facilities`, { facilities: theater.facilities });
  }
  if (current.defaultPrices === null) {
    await api.write('PUT', `${path}/prices`, theater.prices ?? SEED_PRICES);
  }
  if (theater.specialDate && current.specialDates.length === 0) {
    const { daysFromToday, ...hours } = theater.specialDate;
    await api.write('POST', `${path}/special-dates`, {
      cinemaDate: addDays(context.today, daysFromToday),
      ...hours,
    });
  }
  const cover =
    current.cover === null
      ? await picture(
          theater.coverUrl,
          SEED_IMAGE_SIZES.backdrop,
          theater.colour,
          `${theater.name} cover`,
        )
      : null;
  if (cover !== null) {
    await api.upload('POST', `${path}/photos`, {
      fields: { usage: 'cover' },
      file: cover,
      filename: filename(`${theater.name} cover`),
    });
  }
  if (current.photos.length === 0) {
    const { width, height } = SEED_IMAGE_SIZES.gallery;
    for (const caption of theater.galleryCaptions) {
      await api.upload('POST', `${path}/photos`, {
        fields: { usage: 'gallery', caption },
        file: await placeholderImage(width, height, theater.colour, `${theater.name} ${caption}`),
        filename: filename(caption),
      });
    }
  }
}

/**
 * Each theater to publish gets its halls (left out, only `SEED_HALL_NAME`), each with the
 * standard layout and made active.
 */
async function seedHalls(context: SeedContext): Promise<SeedStepResult> {
  const { api } = context;
  let created = 0;
  let kept = 0;
  for (const theater of context.dataset.theaters) {
    const id = context.theaterIds.get(theater.name);
    if (id === undefined || !theater.publish) continue;
    const existing = await listAll<SeedHallRow>(api, `/admin/theaters/${id}/halls`);
    for (const name of theater.halls ?? [SEED_HALL_NAME]) {
      let hall = existing.find((row) => row.name === name);
      if (hall === undefined) {
        hall = await api.write<SeedHallRow>('POST', `/admin/theaters/${id}/halls`, { name });
        created += 1;
      } else {
        kept += 1;
      }
      if (hall.status !== 'active') {
        await api.write('PATCH', `/admin/halls/${hall.id}`, { status: 'active' });
      }
      context.hallIds.set(hallKey(theater.name, name), hall.id);
    }
  }
  return { created, kept };
}

async function publishTheaters(context: SeedContext): Promise<SeedStepResult> {
  let created = 0;
  let kept = 0;
  for (const theater of context.dataset.theaters) {
    const id = context.theaterIds.get(theater.name);
    if (id === undefined || !theater.publish) continue;
    const current = await context.api.get<SeedAdminTheater>(`/admin/theaters/${id}`);
    if (current.status === 'draft') {
      await context.api.write('PATCH', `/admin/theaters/${id}`, { status: 'active' });
      created += 1;
    } else {
      kept += 1;
    }
  }
  return { created, kept };
}

// --- People ---------------------------------------------------------------------------------

async function seedPeople(context: SeedContext): Promise<SeedStepResult> {
  const { api } = context;
  const existing = new Map(
    (await listAll<SeedPersonRow>(api, '/admin/people')).map((row) => [row.fullName, row]),
  );
  const { people } = context.dataset;
  let created = 0;
  for (const person of people) {
    let row = existing.get(person.fullName);
    if (row === undefined) {
      const body = withoutNulls({
        fullName: person.fullName,
        birthDate: person.birthDate,
        birthPlace: person.birthPlace,
        nationality: person.nationality,
        bio: person.bio,
        roles: person.roles,
      });
      row = await api.write<SeedPersonRow>('POST', '/admin/people', body);
      created += 1;
    }
    context.personIds.set(person.fullName, row.id);
    const photo =
      row.photo === null
        ? await picture(person.photoUrl, SEED_IMAGE_SIZES.person, person.colour, person.fullName)
        : null;
    if (photo !== null) {
      await api.upload('PUT', `/admin/people/${row.id}/photo`, {
        fields: {},
        file: photo,
        filename: filename(person.fullName),
      });
    }
  }
  return { created, kept: people.length - created };
}

// --- Movies ---------------------------------------------------------------------------------

async function seedMovies(context: SeedContext): Promise<SeedStepResult> {
  const { api } = context;
  const genres = new Map(
    (await listAll<SeedGenreRow>(api, '/genres')).map((genre) => [genre.slug, genre.id]),
  );
  const existing = new Map(
    (await listAll<SeedTitledRow>(api, '/admin/movies')).map((row) => [row.title, row.id]),
  );
  const { movies } = context.dataset;
  let created = 0;
  for (const movie of movies) {
    let id = existing.get(movie.title);
    if (id === undefined) {
      const body = withoutNulls({
        title: movie.title,
        synopsis: movie.synopsis,
        runtimeMinutes: movie.runtimeMinutes,
        releaseDate: movie.releaseDate ?? addDays(context.today, movie.releaseInDays),
        ageRating: movie.ageRating,
        language: movie.language,
        country: movie.country,
        productionCompany: movie.productionCompany,
        budgetLabel: movie.budgetLabel,
        filmingLocations: movie.filmingLocations,
        genreIds: movie.genres.map((slug) => {
          const genreId = genres.get(slug);
          if (genreId === undefined) throw new Error(`Seed: no genre "${slug}"`);
          return genreId;
        }),
      });
      id = (await api.write<SeedCreatedRow>('POST', '/admin/movies', body)).id;
      created += 1;
    }
    context.movieIds.set(movie.title, id);
    await completeMovie(context, id, movie);
  }
  return { created, kept: movies.length - created };
}

/** Sets whatever of the movie is still missing: poster, photos, videos, credits, status. */
async function completeMovie(context: SeedContext, id: number, movie: SeedMovie): Promise<void> {
  const { api } = context;
  const path = `/admin/movies/${id}`;
  let current = await api.get<SeedAdminMovie>(path);
  const poster =
    current.poster === null
      ? await picture(
          movie.posterUrl,
          SEED_IMAGE_SIZES.poster,
          movie.colour,
          `${movie.title} poster`,
        )
      : null;
  if (poster !== null) {
    await api.upload('PUT', `${path}/poster`, {
      fields: {},
      file: poster,
      filename: filename(`${movie.title} poster`),
    });
  }
  if (current.photos.length === 0) {
    for (const photo of movie.photos) {
      const seed = `${movie.title} ${photo.caption}`;
      await api.upload('POST', `${path}/photos`, {
        fields: { kind: photo.kind, caption: photo.caption },
        file: await image(photo.url, SEED_IMAGE_SIZES.still, movie.colour, seed),
        filename: filename(photo.caption),
      });
    }
  }
  const youtubeIds = new Set(current.videos.map((video) => video.youtubeId));
  for (const video of movie.videos) {
    if (youtubeIds.has(video.youtubeId)) continue;
    await api.write('POST', `${path}/videos`, {
      url: `https://youtu.be/${video.youtubeId}`,
      title: video.title,
      kind: video.kind,
      durationSeconds: video.durationSeconds,
    });
  }
  if (current.credits.length === 0 && movie.credits.length > 0) {
    await api.write('PUT', `${path}/credits`, {
      credits: movie.credits.map((credit) => {
        const personId = context.personIds.get(credit.person);
        if (personId === undefined) throw new Error(`Seed: no person "${credit.person}"`);
        return {
          personId,
          role: credit.role,
          ...(credit.characterName === undefined ? {} : { characterName: credit.characterName }),
        };
      }),
    });
  }
  current = await api.get<SeedAdminMovie>(path);
  const changes: Record<string, unknown> = {};
  const backdrop = current.photos.find((photo) => photo.kind === 'still');
  if (current.backdropPhotoId === null && backdrop) changes.backdropPhotoId = backdrop.id;
  const hero = current.videos.find((video) => video.youtubeId === movie.videos[0]?.youtubeId);
  if (current.heroVideoId === null && hero) changes.heroVideoId = hero.id;
  if (movie.status !== 'draft' && current.status !== movie.status) changes.status = movie.status;
  if (Object.keys(changes).length > 0) await api.write('PATCH', path, changes);
}

async function seedFeatured(context: SeedContext): Promise<SeedStepResult> {
  let created = 0;
  let kept = 0;
  for (const movie of context.dataset.movies) {
    const id = context.movieIds.get(movie.title);
    if (id === undefined || movie.featuredPosition === null) continue;
    const current = await context.api.get<SeedAdminMovie>(`/admin/movies/${id}`);
    if (current.featuredPosition === movie.featuredPosition) {
      kept += 1;
      continue;
    }
    await context.api.write('PATCH', `/admin/movies/${id}`, {
      featuredPosition: movie.featuredPosition,
    });
    created += 1;
  }
  return { created, kept };
}

// --- Showtimes ------------------------------------------------------------------------------

/**
 * Schedules the dataset's showtime slots on today's cinema date and the 6 after, through the admin API so
 * every U7 rule applies. A date that already has a scheduled showtime in the slot's hall at its
 * start time is kept; the others are dry-run first and only the `available` ones are created, so
 * a slot that has started, a closed night or a night whose hours don't fit is left out, and a
 * second run never meets a conflict.
 */
async function seedShowtimes(context: SeedContext): Promise<SeedStepResult> {
  const { api } = context;
  const dates = Array.from({ length: SEED_SHOWTIME_DAYS }, (_, index) =>
    addDays(context.today, index),
  );
  const scheduled = new Map<string, Set<string>>();
  let created = 0;
  let kept = 0;
  for (const slot of context.dataset.showtimes) {
    const theaterId = context.theaterIds.get(slot.theater);
    const hallId = context.hallIds.get(hallKey(slot.theater, slot.hall ?? SEED_HALL_NAME));
    const movieId = context.movieIds.get(slot.movie);
    if (theaterId === undefined || hallId === undefined || movieId === undefined) {
      throw new Error(
        `Seed: no theater, hall or movie for the ${slot.theater} ${slot.startTime} slot`,
      );
    }
    let existing = scheduled.get(slot.theater);
    if (existing === undefined) {
      existing = await scheduledSlots(api, theaterId, dates);
      scheduled.set(slot.theater, existing);
    }
    const missing = dates.filter((date) => !existing.has(slotKey(hallId, date, slot.startTime)));
    kept += dates.length - missing.length;
    if (missing.length === 0) continue;
    const request = { movieId, hallId, dates: missing, startTime: slot.startTime };
    const check = await api.write<SeedShowtimeCheck>('POST', '/admin/showtime-checks', request);
    const available = check.results
      .filter((result) => result.result === 'available')
      .map((result) => result.cinemaDate);
    if (available.length === 0) continue;
    const batch = await api.write<SeedShowtimeBatch>('POST', '/admin/showtimes', {
      ...request,
      dates: available,
      skipUnavailable: false,
    });
    created += batch.createdCount;
  }
  return { created, kept };
}

/** The (hall, cinema date, start time) of every scheduled showtime of a theater on the dates. */
async function scheduledSlots(
  api: SeedApi,
  theaterId: number,
  dates: readonly string[],
): Promise<Set<string>> {
  const slots = new Set<string>();
  for (const date of dates) {
    const rows = await listAll<SeedTimelineShowtime>(
      api,
      `/admin/showtimes?theaterId=${theaterId}&date=${date}&status=scheduled`,
    );
    for (const row of rows) slots.add(slotKey(row.hall.id, row.cinemaDate, row.startTime));
  }
  return slots;
}

function slotKey(hallId: number, cinemaDate: string, startTime: string): string {
  return `${hallId}|${cinemaDate}|${startTime}`;
}
