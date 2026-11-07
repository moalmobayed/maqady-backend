import type { SETTLE_FIRST_KINDS, SETTLE_FIRST_SOURCES } from './enums';

export type SettleFirstKind = (typeof SETTLE_FIRST_KINDS)[number];

export type SettleFirstSource = (typeof SETTLE_FIRST_SOURCES)[number];

/** `@SettleFirst()`'s metadata: what to settle, and where the route names it. */
export interface SettleFirstOptions {
  readonly kind: SettleFirstKind;
  readonly source: SettleFirstSource;
}
