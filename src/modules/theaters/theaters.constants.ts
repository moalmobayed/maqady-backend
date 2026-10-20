import type { TheaterStatus } from './types';

/** At most this many phones per theater (Main line, Box office, WhatsApp, …). */
export const MAX_PHONES = 10;

/** At most this many gallery photos per theater, to bound free-tier storage (spec Q5). */
export const MAX_GALLERY_PHOTOS = 20;

/** E.164: `+`, a country code and the number, 8 to 16 characters in all. */
export const PHONE_NUMBER_PATTERN = /^\+[1-9][0-9]{6,14}$/;

/** `nextOpensAt` looks this many cinema dates past the current one (home-page contract). */
export const OPEN_STATE_LOOKAHEAD_DAYS = 7;

/** `TheaterHoursService.hoursFor()` answers at most this many cinema dates per call. */
export const MAX_HOURS_RANGE_DAYS = 31;

/** Opening may be 06:00 (the start of the cinema day) at the earliest. */
export const MIN_OPENS_MINUTE = 360;

/** Opening is before midnight: an opening after midnight belongs to the next cinema date. */
export const MAX_OPENS_MINUTE = 1439;

/** A `closes` time at or before 06:00 is on the next calendar day. */
export const NEXT_DAY_CLOSING_LIMIT_MINUTE = 360;

/** The status changes `PATCH /admin/theaters/{id}` allows (spec "Decisions"). */
export const STATUS_TRANSITIONS: Readonly<Record<TheaterStatus, readonly TheaterStatus[]>> = {
  draft: ['active'],
  active: ['sales_paused'],
  sales_paused: ['active'],
};

/** The audit action of each allowed status change. */
export const STATUS_CHANGE_ACTIONS: Readonly<Record<string, string>> = {
  'draft>active': 'theater.published',
  'active>sales_paused': 'theater.sales_paused',
  'sales_paused>active': 'theater.sales_resumed',
};

/** The built-in publish requirements, always checked first (spec "Decisions"). */
export const BUILT_IN_PUBLISH_REQUIREMENTS = ['prices', 'hours'] as const;

/** Why a theater cannot be deleted, besides the registered deletion blockers. */
export const NOT_DRAFT_REASON = 'not_draft';

/** Text field limits, shared by the request DTOs and the CHECKs of migration `0055_01`. */
export const TEXT_LIMITS = {
  name: { min: 2, max: 100 },
  address: { min: 1, max: 200 },
  district: { min: 1, max: 80 },
  city: { min: 1, max: 80 },
  transitInfo: { min: 1, max: 500 },
  parkingInfo: { min: 1, max: 500 },
  email: { min: 3, max: 320 },
  phoneLabel: { min: 1, max: 40 },
  specialDateLabel: { min: 1, max: 80 },
  photoCaption: { min: 1, max: 120 },
} as const;
