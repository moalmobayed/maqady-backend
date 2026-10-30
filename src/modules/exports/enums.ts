/** The four CSV exports (PRD "CSV exports"; design §13.4), named as their files are. */
export const EXPORT_DATASETS = ['overview', 'bookings', 'customers', 'payments'] as const;

/** The Overview CSV's sections, one per card, table or chart of the screen (PRD A1). */
export const OVERVIEW_SECTIONS = [
  'period',
  'kpis',
  'by_theater',
  'by_hall',
  'payment_methods',
  'top_movies',
  'heatmap',
  'revenue_trend',
  'tonight',
] as const;

/** What an Overview CSV value measures: money in EGP, a count, a ratio, a date or other text. */
export const OVERVIEW_UNITS = ['EGP', 'count', 'ratio', 'date', 'text'] as const;
