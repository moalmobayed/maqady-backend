import type { AuditMetadataValue } from '../../common/audit/types';
import type { StaffPrincipal } from '../../common/auth/types';
import type { Currency, Money } from '../../common/money/types';
import type { CalendarDate, IsoWeekday } from '../../common/time/types';
import type { ImageUploadPayload, StoredImage } from '../media/types';
import type { FACILITIES, HOURS_SOURCES, PHOTO_USAGES, THEATER_STATUSES } from './enums';

export type TheaterStatus = (typeof THEATER_STATUSES)[number];

export type Facility = (typeof FACILITIES)[number];

export type PhotoUsage = (typeof PHOTO_USAGES)[number];

export type HoursSource = (typeof HOURS_SOURCES)[number];

// --- Rows -----------------------------------------------------------------------------------

/** A `theaters` row as the repository reads it. Coordinates arrive as numbers (U1's parser). */
export interface TheaterRow {
  readonly id: number;
  readonly name: string;
  readonly status: TheaterStatus;
  readonly address: string;
  readonly district: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly transit_info: string | null;
  readonly parking_info: string | null;
  readonly email: string | null;
  readonly show_contacts_public: boolean;
  readonly cover_image_id: number | null;
  readonly default_price_front: number | null;
  readonly default_price_middle: number | null;
  readonly default_price_back: number | null;
  readonly currency: Currency | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns of a new theater: a draft without prices or cover. */
export interface NewTheaterRow {
  readonly name: string;
  readonly status: 'draft';
  readonly address: string;
  readonly district: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly transit_info: string | null;
  readonly parking_info: string | null;
  readonly email: string | null;
  readonly show_contacts_public: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns a theater write may change; `updated_at` always. */
export interface TheaterRowUpdate {
  readonly name?: string;
  readonly status?: TheaterStatus;
  readonly address?: string;
  readonly district?: string;
  readonly city?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly transit_info?: string | null;
  readonly parking_info?: string | null;
  readonly email?: string | null;
  readonly show_contacts_public?: boolean;
  readonly cover_image_id?: number | null;
  readonly default_price_front?: number;
  readonly default_price_middle?: number;
  readonly default_price_back?: number;
  readonly currency?: Currency;
  readonly updated_at: Date;
}

/** A `theater_phones` row as the repository reads it. */
export interface TheaterPhoneRow {
  readonly theater_id: number;
  readonly label: string;
  readonly number: string;
  readonly sort_order: number;
}

export interface NewTheaterPhoneRow extends TheaterPhoneRow {
  readonly created_at: Date;
}

/** A `theater_facilities` row. */
export interface TheaterFacilityRow {
  readonly theater_id: number;
  readonly facility: Facility;
}

/** A `theater_photos` row as the repository reads it. */
export interface TheaterPhotoRow {
  readonly id: number;
  readonly theater_id: number;
  readonly image_id: number;
  readonly caption: string | null;
  readonly sort_order: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface NewTheaterPhotoRow {
  readonly theater_id: number;
  readonly image_id: number;
  readonly caption: string | null;
  readonly sort_order: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** A `theater_hours` row as the repository reads and upserts it. */
export interface TheaterHoursRow {
  readonly theater_id: number;
  readonly weekday: IsoWeekday;
  readonly is_closed: boolean;
  readonly opens_minute: number | null;
  readonly closes_minute: number | null;
}

/** A `theater_special_dates` row as the repository reads it. `cinema_date` stays `YYYY-MM-DD`. */
export interface SpecialDateRow {
  readonly id: number;
  readonly theater_id: number;
  readonly cinema_date: CalendarDate;
  readonly label: string;
  readonly is_closed: boolean;
  readonly opens_minute: number | null;
  readonly closes_minute: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface NewSpecialDateRow {
  readonly theater_id: number;
  readonly cinema_date: CalendarDate;
  readonly label: string;
  readonly is_closed: boolean;
  readonly opens_minute: number | null;
  readonly closes_minute: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface SpecialDateRowUpdate {
  readonly cinema_date: CalendarDate;
  readonly label: string;
  readonly is_closed: boolean;
  readonly opens_minute: number | null;
  readonly closes_minute: number | null;
  readonly updated_at: Date;
}

// --- Opening hours --------------------------------------------------------------------------

/**
 * The hours of one cinema date, as stored: closed, or open from `opensMinute` to `closesMinute`,
 * counted from midnight at the start of the cinema date (360 = 06:00, 1500 = 01:00 the next
 * calendar day, at most 1800 = 06:00 the next day). Both minutes are null when closed.
 */
export interface HoursSpec {
  readonly closed: boolean;
  readonly opensMinute: number | null;
  readonly closesMinute: number | null;
}

/** The weekly hours of one ISO weekday of the cinema date. */
export interface DayHours extends HoursSpec {
  readonly weekday: IsoWeekday;
}

/** Holiday hours: the hours of one cinema date of a theater, replacing its weekly hours. */
export interface SpecialDate extends HoursSpec {
  readonly id: number;
  readonly theaterId: number;
  readonly cinemaDate: CalendarDate;
  readonly label: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A stored minute as an admin reads it: `01:00` and whether that is on the next calendar day. */
export interface WallClockTime {
  readonly time: string;
  readonly nextDay: boolean;
}

/** Hours of a day as a response writes them: `HH:mm` times, null when closed. */
export interface WallClockHours {
  readonly closed: boolean;
  readonly opens: string | null;
  readonly closes: string | null;
  readonly closesNextDay: boolean;
}

/** When a theater opens and closes on one cinema date, as instants; `closesAt` is exclusive. */
export interface OpeningWindow {
  readonly opensAt: Date;
  readonly closesAt: Date;
}

/** The hours of one cinema date of a theater, resolved from its special dates and weekly hours. */
export interface CinemaDateHours {
  readonly cinemaDate: CalendarDate;
  readonly weekday: IsoWeekday;
  /** `special` when a special date sets them, `weekly` from the weekday, `none` when neither. */
  readonly source: HoursSource;
  /** The special date's label, such as "Armed Forces Day"; null unless `source` is `special`. */
  readonly specialDateLabel: string | null;
  /** The stored hours; null when `source` is `none`. */
  readonly hours: HoursSpec | null;
  /** Null when the theater is closed that cinema date or has no hours for it. */
  readonly window: OpeningWindow | null;
}

/** Whether a theater is open at an instant (home-page contract `OpenState`). */
export interface OpenState {
  readonly isOpen: boolean;
  /** When it closes, if open. */
  readonly closesAt: Date | null;
  /** When it next opens, if closed; null when it doesn't within the next 7 cinema dates. */
  readonly nextOpensAt: Date | null;
}

// --- Theaters as other modules see them -----------------------------------------------------

export interface TheaterPhone {
  readonly label: string;
  /** E.164, for example `+20227351100`. */
  readonly number: string;
}

/** A theater's default price per seat zone; a new showtime copies them (design §7.10). */
export interface ZonePrices {
  readonly front: Money;
  readonly middle: Money;
  readonly back: Money;
}

/** One gallery photo. `position` is its place in the gallery, from 0. */
export interface TheaterPhoto {
  readonly id: number;
  readonly caption: string | null;
  readonly position: number;
  readonly image: StoredImage;
}

/** What U5 and U7 need while they hold the theater row: identity, status and prices. */
export interface TheaterSummary {
  readonly id: number;
  readonly name: string;
  readonly status: TheaterStatus;
  readonly defaultPrices: ZonePrices | null;
}

/**
 * Everything about a theater but its hours. Phones and email are always present: U8 hides them
 * itself when `showContactsPublic` is false (PRD C5).
 */
export interface TheaterDetails extends TheaterSummary {
  readonly address: string;
  readonly district: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly transitInfo: string | null;
  readonly parkingInfo: string | null;
  readonly email: string | null;
  readonly showContactsPublic: boolean;
  /** In order; the first is the main phone. */
  readonly phones: readonly TheaterPhone[];
  /** In `FACILITIES` order. */
  readonly facilities: readonly Facility[];
  readonly cover: StoredImage | null;
  /** In gallery order. */
  readonly photos: readonly TheaterPhoto[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** `GET /admin/theaters/{id}` and every theater write: the theater with its hours and checks. */
export interface TheaterAdminView {
  readonly theater: TheaterDetails;
  /** 7 rows by weekday, or none before the hours were first set. */
  readonly hours: readonly DayHours[];
  /** From today's cinema date on, by date. */
  readonly specialDates: readonly SpecialDate[];
  readonly openState: OpenState;
  /** The publish requirements not met yet; empty unless the theater is a draft. */
  readonly publishBlockers: readonly string[];
}

/** One row of the admin theater list (PRD A4). */
export interface TheaterListEntry {
  readonly id: number;
  readonly name: string;
  readonly status: TheaterStatus;
  readonly address: string;
  readonly district: string;
  readonly city: string;
  readonly cover: StoredImage | null;
  readonly mainPhone: TheaterPhone | null;
  readonly openState: OpenState;
  readonly today: CinemaDateHours;
  readonly updatedAt: Date;
}

export interface TheaterListFilter {
  readonly status?: TheaterStatus;
}

// --- Lifecycle seams for other units --------------------------------------------------------

/**
 * A condition for publishing a draft that another unit owns, such as U5's `active_hall`.
 * `isMet` runs in the publish transaction while the theater row is locked, and when the admin
 * page shows what is missing.
 */
export interface TheaterPublishRequirement {
  readonly key: string;
  isMet(theaterId: number): Promise<boolean>;
}

/** A reason another unit has for keeping a draft, such as U7's `has_showtimes`. */
export interface TheaterDeletionBlocker {
  readonly key: string;
  blocks(theaterId: number): Promise<boolean>;
}

// --- Inputs of the admin services -----------------------------------------------------------

/** `POST /admin/theaters`, as validated. */
export interface CreateTheaterInput {
  readonly name: string;
  readonly address: string;
  readonly district: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly transitInfo?: string | null;
  readonly parkingInfo?: string | null;
  readonly email?: string | null;
  readonly showContactsPublic?: boolean;
}

/** `PATCH /admin/theaters/{id}`, as validated: any field, and the status. */
export interface TheaterChanges {
  readonly name?: string;
  readonly address?: string;
  readonly district?: string;
  readonly city?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly transitInfo?: string | null;
  readonly parkingInfo?: string | null;
  readonly email?: string | null;
  readonly showContactsPublic?: boolean;
  readonly status?: TheaterStatus;
}

/** The hours of a day as an admin types them: `HH:mm`, a closing at or before 06:00 is next day. */
export interface WallClockHoursInput {
  readonly closed: boolean;
  readonly opens?: string;
  readonly closes?: string;
}

export interface DayHoursInput extends WallClockHoursInput {
  readonly weekday: IsoWeekday;
}

export interface SpecialDateInput extends WallClockHoursInput {
  readonly cinemaDate: CalendarDate;
  readonly label: string;
}

/** `PATCH` of a special date: any field; the result is checked as a whole. */
export interface SpecialDateChanges {
  readonly cinemaDate?: CalendarDate;
  readonly label?: string;
  readonly closed?: boolean;
  readonly opens?: string;
  readonly closes?: string;
}

/** `POST /admin/theaters/{id}/photos`, as validated. */
export interface TheaterPhotoUploadInput {
  readonly theaterId: number;
  readonly usage: PhotoUsage;
  readonly caption: string | null;
  readonly upload: ImageUploadPayload;
  readonly actor: StaffPrincipal;
}

/** `PATCH /admin/theaters/{id}/photos/{photoId}`, as validated. */
export interface TheaterPhotoChanges {
  readonly caption?: string | null;
  readonly position?: number;
}

// --- Inside the admin services --------------------------------------------------------------

/** What a theater write records besides its action: changed field names and plain facts. */
export interface TheaterAuditDetails {
  readonly changedFields?: readonly string[];
  readonly metadata?: Readonly<Record<string, AuditMetadataValue>>;
}

/** The columns a `PATCH` changes, and the API names of the fields that changed. */
export interface TheaterFieldChanges {
  readonly update: Omit<TheaterRowUpdate, 'updated_at'>;
  readonly changedFields: readonly string[];
}
