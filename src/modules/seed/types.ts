import type { AgeRating, CreditRole, MoviePhotoKind, VideoKind } from '../catalog/types';
import type { Facility } from '../theaters/types';
import type { CalendarDate } from '../../common/time/types';

/** The hours of one weekday as the admin hours editor takes them: `HH:mm`, or closed. */
export interface SeedDayHours {
  readonly weekday: number;
  readonly closed: boolean;
  readonly opens?: string;
  readonly closes?: string;
}

/** A labelled E.164 phone number. */
export interface SeedPhone {
  readonly label: string;
  readonly number: string;
}

/** A theater of the development seed. */
export interface SeedTheater {
  readonly name: string;
  readonly address: string;
  readonly district: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly transitInfo: string | null;
  readonly parkingInfo: string | null;
  readonly email: string | null;
  readonly showContactsPublic: boolean;
  readonly phones: readonly SeedPhone[];
  readonly facilities: readonly Facility[];
  readonly hours: readonly SeedDayHours[];
  /** Holiday hours this many days after today's cinema date, or none. */
  readonly specialDate: SeedSpecialDate | null;
  readonly galleryCaptions: readonly string[];
  /** Published (`active`) by the `publish-theaters` step, or left a draft. */
  readonly publish: boolean;
  /** Base colour of the generated pictures. */
  readonly colour: string;
}

export interface SeedSpecialDate {
  readonly daysFromToday: number;
  readonly label: string;
  readonly closed: boolean;
  readonly opens?: string;
  readonly closes?: string;
}

/** A person of the development seed. */
export interface SeedPerson {
  readonly fullName: string;
  readonly birthDate: CalendarDate | null;
  readonly birthPlace: string | null;
  readonly nationality: string | null;
  readonly bio: string | null;
  readonly roles: readonly CreditRole[];
  readonly colour: string;
}

/** A credit of a seed movie, by person name. */
export interface SeedCredit {
  readonly person: string;
  readonly role: CreditRole;
  readonly characterName?: string;
}

/** A YouTube video of a seed movie. */
export interface SeedVideo {
  readonly youtubeId: string;
  readonly title: string;
  readonly kind: VideoKind;
  readonly durationSeconds: number | null;
}

/** A photo of a seed movie; the first still becomes the backdrop. */
export interface SeedMoviePhoto {
  readonly kind: MoviePhotoKind;
  readonly caption: string;
}

/** The status a seed movie ends in. */
export type SeedMovieStatus = 'draft' | 'coming_soon' | 'now_showing';

/** A movie of the development seed. */
export interface SeedMovie {
  readonly title: string;
  readonly status: SeedMovieStatus;
  readonly synopsis: string;
  readonly runtimeMinutes: number;
  /** The release date, this many days from today (negative: in the past). */
  readonly releaseInDays: number;
  readonly ageRating: AgeRating;
  readonly language: string;
  readonly country: string;
  readonly productionCompany: string;
  readonly budgetLabel: string | null;
  readonly filmingLocations: string | null;
  /** Genre slugs, in display order. */
  readonly genres: readonly string[];
  readonly videos: readonly SeedVideo[];
  readonly photos: readonly SeedMoviePhoto[];
  readonly credits: readonly SeedCredit[];
  /** The home carousel position (with the first video as the hero), or none. */
  readonly featuredPosition: number | null;
  readonly colour: string;
}

/**
 * A showtime slot of the development seed: a theater's `Hall 1` shows `movie` at `startTime`
 * (`HH:mm`; `00:00`–`05:59` is after midnight) on each of the next cinema dates it fits.
 */
export interface SeedShowtimeSlot {
  readonly theater: string;
  readonly startTime: string;
  /** The title of a Now showing seed movie. */
  readonly movie: string;
}

/** What one step did: how many things it created and how many it found already there. */
export interface SeedStepResult {
  readonly created: number;
  readonly kept: number;
}

/** One step of `npm run seed`. Steps run in order and each one is idempotent. */
export interface SeedStep {
  readonly name: string;
  run(context: SeedContext): Promise<SeedStepResult>;
}

/** What the steps share: the signed-in admin API, today's date and the ids found so far. */
export interface SeedContext {
  readonly api: SeedApi;
  readonly today: CalendarDate;
  readonly theaterIds: Map<string, number>;
  /** The seed hall (`SEED_HALL_NAME`) of each published theater, by theater name. */
  readonly hallIds: Map<string, number>;
  readonly personIds: Map<string, number>;
  readonly movieIds: Map<string, number>;
}

/** A multipart upload: the text fields and one image file. */
export interface SeedUpload {
  readonly fields: Readonly<Record<string, string>>;
  readonly file: Buffer;
  readonly filename: string;
}

/** The admin HTTP API as the seed calls it. */
export interface SeedApi {
  get<T>(path: string): Promise<T>;
  write<T>(method: SeedWriteMethod, path: string, body: unknown): Promise<T>;
  upload<T>(method: 'POST' | 'PUT', path: string, upload: SeedUpload): Promise<T>;
}

export type SeedWriteMethod = 'POST' | 'PUT' | 'PATCH';

/** A failed API call: the status and the error code of the response, never its values. */
export interface SeedApiFailure {
  readonly status: number;
  readonly code: string | null;
}

/** The parts of admin responses the seed reads. */
export interface SeedPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** A created row, as the admin create routes answer it (only the id is read). */
export interface SeedCreatedRow {
  readonly id: number;
}

/** A genre of `GET /genres`. */
export interface SeedGenreRow {
  readonly id: number;
  readonly slug: string;
}

/** The part of a staff sign-in the seed reads. */
export interface SeedSignIn {
  readonly accessToken: string;
}

export interface SeedNamedRow {
  readonly id: number;
  readonly name: string;
}

export interface SeedTitledRow {
  readonly id: number;
  readonly title: string;
}

export interface SeedPersonRow {
  readonly id: number;
  readonly fullName: string;
  readonly photo: unknown;
}

/** A hall of `GET /admin/theaters/{id}/halls` (and the create answer), as the seed reads it. */
export interface SeedHallRow {
  readonly id: number;
  readonly name: string;
  readonly status: string;
}

export interface SeedAdminTheater {
  readonly id: number;
  readonly status: string;
  readonly phones: readonly unknown[];
  readonly facilities: readonly unknown[];
  readonly hours: readonly unknown[];
  readonly specialDates: readonly unknown[];
  readonly defaultPrices: unknown;
  readonly cover: unknown;
  readonly photos: readonly unknown[];
}

export interface SeedAdminMovie {
  readonly id: number;
  readonly status: string;
  readonly poster: unknown;
  readonly backdropPhotoId: number | null;
  readonly heroVideoId: number | null;
  readonly featuredPosition: number | null;
  readonly photos: readonly { readonly id: number; readonly kind: string }[];
  readonly videos: readonly { readonly id: number; readonly youtubeId: string }[];
  readonly credits: readonly unknown[];
}

/** A showtime of the admin timeline, as the seed reads it. */
export interface SeedTimelineShowtime {
  readonly hall: { readonly id: number };
  readonly cinemaDate: CalendarDate;
  readonly startTime: string;
}

/** One date of the dry run's answer, as the seed reads it. */
export interface SeedDateCheck {
  readonly cinemaDate: CalendarDate;
  readonly result: string;
}

export interface SeedShowtimeCheck {
  readonly results: readonly SeedDateCheck[];
}

export interface SeedShowtimeBatch {
  readonly createdCount: number;
}

/** Why the seed refuses to run here; empty when it may. */
export type SeedRefusals = readonly string[];
