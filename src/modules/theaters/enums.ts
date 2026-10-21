/**
 * A theater's status (design §9, PRD "Theaters and movies"). Mirrored by `chk_theaters_status`.
 *
 * - `draft`: being set up, hidden from customers; the only status that can be deleted.
 * - `active`: on the site and selling.
 * - `sales_paused`: hidden from customers; existing tickets stay valid.
 */
export const THEATER_STATUSES = ['draft', 'active', 'sales_paused'] as const;

/**
 * Facilities a theater can list (PRD A4), in display order. Mirrored by
 * `chk_theater_facilities_facility` and the home-page contract's `Facility`.
 */
export const FACILITIES = [
  'wheelchair_access',
  'free_parking',
  'valet_parking',
  'street_parking',
  'cafe_bar',
  'food_court',
  'kids_room',
] as const;

/** What an uploaded theater photo becomes: the cover, or one more gallery photo. */
export const PHOTO_USAGES = ['cover', 'gallery'] as const;

/** Where a cinema date's hours come from: a special date, the weekly hours, or nowhere. */
export const HOURS_SOURCES = ['special', 'weekly', 'none'] as const;
