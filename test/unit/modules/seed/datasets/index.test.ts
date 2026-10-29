import {
  MAX_CREDITS,
  MAX_GENRES_PER_MOVIE,
  MAX_MOVIE_PHOTOS,
  MAX_MOVIE_VIDEOS,
  MAX_RUNTIME_MINUTES,
  TEXT_LIMITS,
} from '../../../../../src/modules/catalog/catalog.constants';
import { PHONE_NUMBER_PATTERN } from '../../../../../src/modules/theaters/theaters.constants';
import { SEED_DATASETS } from '../../../../../src/modules/seed/datasets';
import { EGYPT_2026_DATASET } from '../../../../../src/modules/seed/datasets/egypt-2026';
import { SEED_HALL_NAME } from '../../../../../src/modules/seed/seed.constants';
import type { SeedDataset, SeedDayHours } from '../../../../../src/modules/seed/types';

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
      ...dataset.people.map((person) => person.photoUrl),
      ...dataset.movies.flatMap((movie) => [
        movie.posterUrl,
        ...movie.photos.map((photo) => photo.url),
      ]),
    ].filter((url): url is string => typeof url === 'string');
    expect(urls.filter((url) => !url.startsWith('https://'))).toEqual([]);
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
        hall: (theater?.halls ?? [SEED_HALL_NAME]).includes(hall),
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
