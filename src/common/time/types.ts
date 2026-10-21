/** A calendar date as `YYYY-MM-DD`, for example a cinema date. */
export type CalendarDate = string;

/** ISO weekday: 1 = Monday … 7 = Sunday (Luxon's and Postgres's `ISODOW`). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The two instants a cinema day spans: 06:00 on its date to 06:00 the next day. */
export interface CinemaDayBounds {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** An absolute amount of time, added to or subtracted from an instant. */
export interface InstantDuration {
  readonly hours?: number;
  readonly minutes?: number;
  readonly seconds?: number;
  readonly milliseconds?: number;
}
