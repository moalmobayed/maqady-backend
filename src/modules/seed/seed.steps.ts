import { addDays } from '../../common/time/time';
import { SEED_HALL_NAME, SEED_IMAGE_SIZES, SEED_LIST_LIMIT, SEED_PRICES } from './seed.constants';
import { SEED_MOVIES, SEED_PEOPLE, SEED_THEATERS } from './seed-data';
import { placeholderImage } from './seed-images';
import type {
  SeedAdminMovie,
  SeedAdminTheater,
  SeedApi,
  SeedContext,
  SeedCreatedRow,
  SeedGenreRow,
  SeedHallRow,
  SeedMovie,
  SeedNamedRow,
  SeedPage,
  SeedPersonRow,
  SeedStep,
  SeedStepResult,
  SeedTheater,
  SeedTitledRow,
} from './types';

/**
 * The steps of `npm run seed`, in order. Each finds what exists through the admin list routes
 * and creates only what is missing, so the seed can run again (or resume after a failure)
 * without duplicating anything. `halls` gives each theater to publish an active hall (its
 * `active_hall` publish requirement, U5) before `publish-theaters`; U8b appends showtimes at the
 * end.
 */
export const SEED_STEPS: readonly SeedStep[] = [
  { name: 'theaters', run: seedTheaters },
  { name: 'halls', run: seedHalls },
  { name: 'publish-theaters', run: publishTheaters },
  { name: 'people', run: seedPeople },
  { name: 'movies', run: seedMovies },
  { name: 'featured', run: seedFeatured },
];

/** Every row of an admin list, page by page. */
async function listAll<T>(api: SeedApi, path: string): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const page: SeedPage<T> = await api.get<SeedPage<T>>(
      `${path}?limit=${SEED_LIST_LIMIT}${query}`,
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

// --- Theaters -------------------------------------------------------------------------------

async function seedTheaters(context: SeedContext): Promise<SeedStepResult> {
  const { api } = context;
  const existing = new Map(
    (await listAll<SeedNamedRow>(api, '/admin/theaters')).map((row) => [
      row.name.toLowerCase(),
      row.id,
    ]),
  );
  let created = 0;
  for (const theater of SEED_THEATERS) {
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
  return { created, kept: SEED_THEATERS.length - created };
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
  if (current.defaultPrices === null) await api.write('PUT', `${path}/prices`, SEED_PRICES);
  if (theater.specialDate && current.specialDates.length === 0) {
    const { daysFromToday, ...hours } = theater.specialDate;
    await api.write('POST', `${path}/special-dates`, {
      cinemaDate: addDays(context.today, daysFromToday),
      ...hours,
    });
  }
  if (current.cover === null) {
    const { width, height } = SEED_IMAGE_SIZES.backdrop;
    await api.upload('POST', `${path}/photos`, {
      fields: { usage: 'cover' },
      file: await placeholderImage(width, height, theater.colour, `${theater.name} cover`),
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

/** Each theater to publish gets the standard-layout hall `SEED_HALL_NAME`, made active. */
async function seedHalls(context: SeedContext): Promise<SeedStepResult> {
  const { api } = context;
  let created = 0;
  let kept = 0;
  for (const theater of SEED_THEATERS) {
    const id = context.theaterIds.get(theater.name);
    if (id === undefined || !theater.publish) continue;
    const halls = await listAll<SeedHallRow>(api, `/admin/theaters/${id}/halls`);
    let hall = halls.find((row) => row.name === SEED_HALL_NAME);
    if (hall === undefined) {
      hall = await api.write<SeedHallRow>('POST', `/admin/theaters/${id}/halls`, {
        name: SEED_HALL_NAME,
      });
      created += 1;
    } else {
      kept += 1;
    }
    if (hall.status !== 'active') {
      await api.write('PATCH', `/admin/halls/${hall.id}`, { status: 'active' });
    }
  }
  return { created, kept };
}

async function publishTheaters(context: SeedContext): Promise<SeedStepResult> {
  let created = 0;
  let kept = 0;
  for (const theater of SEED_THEATERS) {
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
  let created = 0;
  for (const person of SEED_PEOPLE) {
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
    if (row.photo === null) {
      const { width, height } = SEED_IMAGE_SIZES.person;
      await api.upload('PUT', `/admin/people/${row.id}/photo`, {
        fields: {},
        file: await placeholderImage(width, height, person.colour, person.fullName),
        filename: filename(person.fullName),
      });
    }
  }
  return { created, kept: SEED_PEOPLE.length - created };
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
  let created = 0;
  for (const movie of SEED_MOVIES) {
    let id = existing.get(movie.title);
    if (id === undefined) {
      const body = withoutNulls({
        title: movie.title,
        synopsis: movie.synopsis,
        runtimeMinutes: movie.runtimeMinutes,
        releaseDate: addDays(context.today, movie.releaseInDays),
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
  return { created, kept: SEED_MOVIES.length - created };
}

/** Sets whatever of the movie is still missing: poster, photos, videos, credits, status. */
async function completeMovie(context: SeedContext, id: number, movie: SeedMovie): Promise<void> {
  const { api } = context;
  const path = `/admin/movies/${id}`;
  let current = await api.get<SeedAdminMovie>(path);
  if (current.poster === null) {
    const { width, height } = SEED_IMAGE_SIZES.poster;
    await api.upload('PUT', `${path}/poster`, {
      fields: {},
      file: await placeholderImage(width, height, movie.colour, `${movie.title} poster`),
      filename: filename(`${movie.title} poster`),
    });
  }
  if (current.photos.length === 0) {
    const { width, height } = SEED_IMAGE_SIZES.still;
    for (const photo of movie.photos) {
      await api.upload('POST', `${path}/photos`, {
        fields: { kind: photo.kind, caption: photo.caption },
        file: await placeholderImage(
          width,
          height,
          movie.colour,
          `${movie.title} ${photo.caption}`,
        ),
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
  for (const movie of SEED_MOVIES) {
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
