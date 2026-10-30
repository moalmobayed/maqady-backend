import type { Readable } from 'node:stream';
import type { AuditMetadataValue } from '../../common/audit/types';
import type { CalendarDate } from '../../common/time/types';
import type { EXPORT_DATASETS, OVERVIEW_SECTIONS, OVERVIEW_UNITS } from './enums';

export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number];

export type OverviewUnit = (typeof OVERVIEW_UNITS)[number];

/**
 * A CSV cell before it is written: text (formula-escaped when written), a number (written as is,
 * never escaped), a yes / no, or nothing (an empty cell).
 */
export type CsvValue = string | number | boolean | null;

/** One column of a CSV file: its header and how a row gives its cell. */
export interface CsvColumn<Row> {
  readonly header: string;
  readonly value: (row: Row) => CsvValue;
}

/** A CSV download: its file name and the stream of its bytes, header row and BOM included. */
export interface ExportFile {
  readonly filename: string;
  readonly stream: Readable;
}

/** The export's audit metadata: its dataset and the filters given, never personal data. */
export type ExportAuditMetadata = Readonly<Record<string, AuditMetadataValue>>;

/** One figure of the Overview, as one row of its CSV. */
export interface OverviewFigureRow {
  readonly section: OverviewSection;
  readonly cinemaDate: CalendarDate | null;
  readonly subjectId: number | null;
  readonly subject: string | null;
  readonly metric: string;
  readonly unit: OverviewUnit;
  readonly value: string | number | null;
  readonly previous: string | number | null;
  readonly change: number | null;
}

/** A figure as `overviewRows()` builds it: what it is about, and the rest left empty. */
export interface OverviewFigureInput {
  readonly section: OverviewSection;
  readonly metric: string;
  readonly unit: OverviewUnit;
  readonly value: string | number | null;
  readonly cinemaDate?: CalendarDate | null;
  readonly subjectId?: number | null;
  readonly subject?: string | null;
  readonly previous?: string | number | null;
  readonly change?: number | null;
}
