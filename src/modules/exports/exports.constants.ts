/** The audit action of every CSV download (design §13.4); the dataset is in its metadata. */
export const EXPORT_DOWNLOADED_ACTION = 'export.downloaded';

/** The audit entity of a download: an export, which has no row of its own (no id). */
export const EXPORT_ENTITY = 'export';

/** Rows read per batch: one page query of the list each (`ExportOptions`). */
export const DEFAULT_EXPORT_BATCH_SIZE = 500;

/** Downloads carry personal data: no cache keeps them. */
export const EXPORT_CACHE_CONTROL = 'private, no-store';

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

/**
 * A text cell starting with one of these runs as a formula in a spreadsheet (OWASP "CSV
 * injection"): `=`, `+`, `-`, `@`, a tab or a carriage return (design §13.4).
 */
export const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** What a dangerous cell is prefixed with, so the spreadsheet reads it as text. */
export const FORMULA_ESCAPE = "'";

/** How booleans read in a file: a spreadsheet filter on yes / no. */
export const CSV_YES = 'yes';
export const CSV_NO = 'no';

/** Seat labels in one cell: `A1 A2 A3`. */
export const LIST_SEPARATOR = ' ';

/** Piastres per Egyptian pound: files carry money in pounds. */
export const MINOR_UNITS_PER_MAJOR = 100;
