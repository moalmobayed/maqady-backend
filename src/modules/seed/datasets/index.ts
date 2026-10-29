import { SEED_MOVIES, SEED_PEOPLE, SEED_SHOWTIMES, SEED_THEATERS } from '../seed-data';
import type { SeedDataset } from '../types';
import { EGYPT_2026_DATASET } from './egypt-2026';

/** The invented theaters, people and movies of `seed-data.ts`, with generated pictures. */
export const DEMO_DATASET: SeedDataset = {
  name: 'demo',
  theaters: SEED_THEATERS,
  people: SEED_PEOPLE,
  movies: SEED_MOVIES,
  showtimes: SEED_SHOWTIMES,
};

/** The datasets `SEED_DATASET` can pick, by name; left unset, `DEMO_DATASET`. */
export const SEED_DATASETS: Readonly<Record<string, SeedDataset>> = {
  [DEMO_DATASET.name]: DEMO_DATASET,
  [EGYPT_2026_DATASET.name]: EGYPT_2026_DATASET,
};
