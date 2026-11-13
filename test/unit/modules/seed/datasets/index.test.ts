import {
  MAX_CREDITS,
  MAX_GENRES_PER_MOVIE,
  MAX_MOVIE_PHOTOS,
  MAX_MOVIE_VIDEOS,
  MAX_RUNTIME_MINUTES,
  TEXT_LIMITS,
} from '../../../../../src/modules/catalog/catalog.constants';
import { MAX_MOVIE_RATING } from '../../../../../src/modules/catalog/catalog.constants';
import { HALL_FORMATS } from '../../../../../src/modules/halls/enums';
import { SCREEN_METERS_LIMITS } from '../../../../../src/modules/halls/halls.constants';
import { FACILITIES } from '../../../../../src/modules/theaters/enums';
import {
  PHONE_NUMBER_PATTERN,
  POSTAL_CODE_PATTERN,
} from '../../../../../src/modules/theaters/theaters.constants';
import { DEMO_DATASET, SEED_DATASETS } from '../../../../../src/modules/seed/datasets';
import { EGYPT_2026_DATASET } from '../../../../../src/modules/seed/datasets/egypt-2026';
import { SEED_HALL_NAME } from '../../../../../src/modules/seed/seed.constants';
import { seedHallOf } from '../../../../../src/modules/seed/seed.steps';
import type { SeedDataset, SeedDayHours, SeedHall } from '../../../../../src/modules/seed/types';

/** `chk_theater_photos_caption` (migration `0055_04`): a gallery caption is at most 120 characters. */
const PHOTO_CAPTION_MAX = 120;

/** Whether a screen side is one the admin hall routes accept: 1 to 50 m, at most 2 decimals. */
function screenSide(meters: number): boolean {
  return (
    meters >= SCREEN_METERS_LIMITS.min &&
    meters <= SCREEN_METERS_LIMITS.max &&
    Math.round(meters * 100) / 100 === meters
  );
}

/** The genres migration U3 seeds; a dataset can name no other. */
const GENRE_SLUGS = [
  'action',
  'adventure',
  'animation',
  'comedy',
  'drama',
  'family',
  'mystery',
  'romance',
  'sci-fi',
  'thriller',
];

/** The 20-minute cleaning gap the database keeps between two showtimes in a hall. */
const CLEANING_MINUTES = 20;

/** Minutes into the cinema day: `00:00`–`05:59` is after midnight, so it counts from 24:00. */
function cinemaMinutes(time: string): number {
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(3, 5));
  return (hours < 6 ? hours + 24 : hours) * 60 + minutes;
}

/** Whether a showtime from `start` for `runtime` minutes fits inside one day's hours. */
function fits(day: SeedDayHours, start: number, runtime: number): boolean {
  if (day.closed || day.opens === undefined || day.closes === undefined) return false;
  return cinemaMinutes(day.opens) <= start && start + runtime <= cinemaMinutes(day.closes);
}

describe.each(Object.values(SEED_DATASETS))('the $name seed dataset', (dataset: SeedDataset) => {
  const theaters = new Map(dataset.theaters.map((theater) => [theater.name, theater]));
  const people = new Map(dataset.people.map((person) => [person.fullName, person]));
  const movies = new Map(dataset.movies.map((movie) => [movie.title, movie]));

  it('names every theater, person and movie once', () => {
    expect(theaters.size).toBe(dataset.theaters.length);
    expect(people.size).toBe(dataset.people.length);
    expect(movies.size).toBe(dataset.movies.length);
  });

  it('keeps every movie inside the catalog limits', () => {
    for (const movie of dataset.movies) {
      expect({
        title: movie.title,
        synopsis: movie.synopsis.length <= TEXT_LIMITS.synopsis,
        runtime: movie.runtimeMinutes >= 1 && movie.runtimeMinutes <= MAX_RUNTIME_MINUTES,
        genres:
          movie.genres.length >= 1 &&
          movie.genres.length <= MAX_GENRES_PER_MOVIE &&
          movie.genres.every((slug) => GENRE_SLUGS.includes(slug)),
        photos: movie.photos.length <= MAX_MOVIE_PHOTOS,
        videos: movie.videos.length <= MAX_MOVIE_VIDEOS,
        videoTitles: movie.videos.every((video) => video.title.length <= TEXT_LIMITS.videoTitle),
        captions: movie.photos.every((photo) => photo.caption.length <= TEXT_LIMITS.photoCaption),
        credits: movie.credits.length <= MAX_CREDITS,
      }).toEqual({
        title: movie.title,
        synopsis: true,
        runtime: true,
        genres: true,
        photos: true,
        videos: true,
        videoTitles: true,
        captions: true,
        credits: true,
      });
    }
  });

  it('keeps every person inside the catalog limits', () => {
    for (const person of dataset.people) {
      expect({
        name: person.fullName,
        bio: (person.bio?.length ?? 0) <= TEXT_LIMITS.bio,
        birthPlace: (person.birthPlace?.length ?? 0) <= TEXT_LIMITS.birthPlace,
        nationality: (person.nationality?.length ?? 0) <= TEXT_LIMITS.nationality,
        roles: person.roles.length >= 1,
      }).toEqual({
        name: person.fullName,
        bio: true,
        birthPlace: true,
        nationality: true,
        roles: true,
      });
    }
  });

  it('credits only people of the dataset', () => {
    const unknown = dataset.movies.flatMap((movie) =>
      movie.credits.filter((credit) => !people.has(credit.person)).map((credit) => credit.person),
    );
    expect(unknown).toEqual([]);
  });

  it('features only public movies with a hero video, each at its own position', () => {
    const featured = dataset.movies.filter((movie) => movie.featuredPosition !== null);
    for (const movie of featured) {
      expect({ title: movie.title, status: movie.status, videos: movie.videos.length > 0 }).toEqual(
        { title: movie.title, status: expect.not.stringMatching('draft'), videos: true },
      );
    }
    const positions = featured.map((movie) => movie.featuredPosition);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('gives theaters valid phones and pictures that are real URLs', () => {
    for (const theater of dataset.theaters) {
      expect(theater.phones.every((phone) => PHONE_NUMBER_PATTERN.test(phone.number))).toBe(true);
    }
    const urls = [
      ...dataset.theaters.map((theater) => theater.coverUrl),
      ...dataset.theaters.flatMap((theater) => theater.gallery.map((photo) => photo.url)),
      ...dataset.people.map((person) => person.photoUrl),
      ...dataset.movies.flatMap((movie) => [
        movie.posterUrl,
        ...movie.photos.map((photo) => photo.url),
      ]),
    ].filter((url): url is string => typeof url === 'string');
    expect(urls.filter((url) => !url.startsWith('https://'))).toEqual([]);
  });

  it('gives the #29 fields only values the admin API accepts', () => {
    for (const movie of dataset.movies) {
      expect({
        title: movie.title,
        rating:
          movie.rating === undefined ||
          (movie.rating >= 0 &&
            movie.rating <= MAX_MOVIE_RATING &&
            Math.round(movie.rating * 10) / 10 === movie.rating),
        sourceOnlyWithRating: movie.ratingSource === undefined || movie.rating !== undefined,
      }).toEqual({ title: movie.title, rating: true, sourceOnlyWithRating: true });
    }
    for (const theater of dataset.theaters) {
      const halls: SeedHall[] = (theater.halls ?? []).map(seedHallOf);
      expect({
        name: theater.name,
        postalCode:
          theater.postalCode === null ||
          theater.postalCode === undefined ||
          POSTAL_CODE_PATTERN.test(theater.postalCode),
        whatsapp:
          theater.whatsapp === null ||
          theater.whatsapp === undefined ||
          PHONE_NUMBER_PATTERN.test(theater.whatsapp),
        facilities: theater.facilities.every((facility) => FACILITIES.includes(facility)),
        captions: theater.gallery.every(
          (photo) =>
            photo.caption.length >= 1 &&
            photo.caption.length <= PHOTO_CAPTION_MAX &&
            photo.caption.trim() === photo.caption,
        ),
        formats: halls.every(
          (hall) => hall.format === undefined || HALL_FORMATS.includes(hall.format),
        ),
        screens: halls.every((hall) =>
          hall.screenWidthMeters === undefined
            ? hall.screenHeightMeters === undefined
            : hall.screenHeightMeters !== undefined &&
              screenSide(hall.screenWidthMeters) &&
              screenSide(hall.screenHeightMeters),
        ),
      }).toEqual({
        name: theater.name,
        postalCode: true,
        whatsapp: true,
        facilities: true,
        captions: true,
        formats: true,
        screens: true,
      });
    }
  });

  it('has an example of every #29 field: a score, a postal code and a non-standard hall', () => {
    expect(dataset.movies.some((movie) => movie.rating !== undefined)).toBe(true);
    expect(dataset.theaters.some((theater) => typeof theater.postalCode === 'string')).toBe(true);
    expect(
      dataset.theaters.some((theater) =>
        (theater.halls ?? [])
          .map(seedHallOf)
          .some((hall) => (hall.format ?? 'standard') !== 'standard'),
      ),
    ).toBe(true);
    expect(dataset.theaters.some((theater) => theater.facilities.includes('prayer_room'))).toBe(
      true,
    );
  });

  it('schedules only Now showing movies, in published halls that exist, inside opening hours', () => {
    for (const slot of dataset.showtimes) {
      const theater = theaters.get(slot.theater);
      const movie = movies.get(slot.movie);
      const hall = slot.hall ?? SEED_HALL_NAME;
      const start = cinemaMinutes(slot.startTime);
      expect({
        slot,
        theater: theater?.publish,
        hall: (theater?.halls ?? [SEED_HALL_NAME])
          .map((entry) => seedHallOf(entry).name)
          .includes(hall),
        movie: movie?.status,
        fits:
          theater !== undefined &&
          movie !== undefined &&
          theater.hours.some((day) => fits(day, start, movie.runtimeMinutes)),
      }).toEqual({ slot, theater: true, hall: true, movie: 'now_showing', fits: true });
    }
  });

  it('leaves the 20-minute cleaning gap between two showtimes in a hall', () => {
    const byHall = new Map<string, { start: number; end: number; slot: string }[]>();
    for (const slot of dataset.showtimes) {
      const runtime = movies.get(slot.movie)?.runtimeMinutes ?? 0;
      const start = cinemaMinutes(slot.startTime);
      const key = `${slot.theater} ${slot.hall ?? SEED_HALL_NAME}`;
      const shows = byHall.get(key) ?? [];
      shows.push({
        start,
        end: start + runtime + CLEANING_MINUTES,
        slot: `${key} ${slot.startTime}`,
      });
      byHall.set(key, shows);
    }
    const clashes: string[] = [];
    for (const shows of byHall.values()) {
      shows.sort((a, b) => a.start - b.start);
      shows.reduce((previous, show) => {
        if (show.start < previous.end) clashes.push(`${previous.slot} / ${show.slot}`);
        return show;
      });
    }
    expect(clashes).toEqual([]);
  });
});

describe('the egypt-2026 seed dataset', () => {
  const dataset = EGYPT_2026_DATASET;

  it('is real 2026 Egyptian cinema: Egyptian films released in 2026, in Cairo and Giza', () => {
    expect(dataset.movies.length).toBeGreaterThan(0);
    for (const movie of dataset.movies) {
      expect({
        title: movie.title,
        country: movie.country,
        year: movie.releaseDate?.slice(0, 4),
      }).toEqual({ title: movie.title, country: 'Egypt', year: '2026' });
    }
    expect(new Set(dataset.theaters.map((theater) => theater.city))).toEqual(
      new Set(['Cairo', 'Giza']),
    );
  });

  it('credits production companies as the production company, never as people', () => {
    const companies = dataset.people
      .map((person) => person.fullName)
      .filter((name) => /\b(productions?|films|pictures|studios?|theaters|media)$/i.test(name));
    expect(companies).toEqual([]);
  });

  it('scores the Now showing films with their elCinema user rating, and no Coming soon film', () => {
    const scores = Object.fromEntries(
      dataset.movies.map((movie) => [
        movie.title,
        [movie.rating ?? null, movie.ratingSource ?? null],
      ]),
    );
    expect(scores).toMatchObject({
      Naseeb: [4.3, 'elCinema users'],
      'Red Flag': [4.8, 'elCinema users'],
      'Saqr w Kanarya': [7.3, 'elCinema users'],
      'El Gawahergy': [5.9, 'elCinema users'],
    });
    for (const movie of dataset.movies) {
      expect({ title: movie.title, rated: movie.rating !== undefined }).toEqual({
        title: movie.title,
        rated: movie.status === 'now_showing',
      });
    }
  });

  it('claims only what a source confirms: one prayer room, no WhatsApp, no screen size', () => {
    expect(
      dataset.theaters
        .filter((theater) => theater.facilities.includes('prayer_room'))
        .map((theater) => theater.name),
    ).toEqual(['VOX Mall of Egypt']);
    expect(dataset.theaters.filter((theater) => theater.whatsapp)).toEqual([]);
    const halls = dataset.theaters.flatMap((theater) => (theater.halls ?? []).map(seedHallOf));
    expect(halls.filter((hall) => hall.screenWidthMeters !== undefined)).toEqual([]);
    const almaza = dataset.theaters.find((theater) => theater.name === 'VOX City Centre Almaza');
    const formats = (almaza?.halls ?? []).map((hall) => seedHallOf(hall).format ?? 'standard');
    expect(formats.filter((format) => format === 'max')).toHaveLength(1);
    expect(formats.filter((format) => format === 'vip')).toHaveLength(3);
  });

  // CC BY-SA asks to indicate a change; the seed crops every downloaded picture to the gallery size.
  it('uses only freely licensed Wikimedia Commons thumbnails for the gallery, credited and marked cropped', () => {
    const photos = dataset.theaters.flatMap((theater) => theater.gallery);
    expect(photos.length).toBeGreaterThan(0);
    for (const photo of photos) {
      expect({
        url: /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/.+\/1920px-[^/]+$/.test(
          photo.url ?? '',
        ),
        credit: / Photo: .+, CC BY(-SA)? \d\.\d, via Wikimedia Commons, cropped$/.test(
          photo.caption,
        ),
      }).toEqual({ url: true, credit: true });
    }
  });

  it('places every theater inside Greater Cairo', () => {
    for (const theater of dataset.theaters) {
      expect({
        name: theater.name,
        latitude: theater.latitude > 29.8 && theater.latitude < 30.3,
        longitude: theater.longitude > 30.8 && theater.longitude < 31.6,
      }).toEqual({ name: theater.name, latitude: true, longitude: true });
    }
  });
});

describe('the demo seed dataset', () => {
  const dataset = DEMO_DATASET;
  const published = dataset.theaters.filter((theater) => theater.publish);

  it('gives every new #29 field an example: WhatsApp, screen sizes, at least 3 gallery photos', () => {
    expect(dataset.theaters.filter((theater) => theater.whatsapp).length).toBeGreaterThan(0);
    for (const theater of published) {
      expect({ name: theater.name, gallery: theater.gallery.length >= 3 }).toEqual({
        name: theater.name,
        gallery: true,
      });
    }
    const halls = published.flatMap((theater) => (theater.halls ?? []).map(seedHallOf));
    expect(new Set(halls.map((hall) => hall.format ?? 'standard')).size).toBeGreaterThanOrEqual(4);
    expect(halls.some((hall) => hall.screenWidthMeters !== undefined)).toBe(true);
    expect(
      dataset.movies.filter((movie) => movie.status === 'now_showing').every((m) => m.rating),
    ).toBe(true);
  });
});
