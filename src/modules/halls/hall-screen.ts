import type { HallScreen, HallScreenColumns } from './types';

/**
 * A hall's screen between the API, in metres with at most 2 decimals, and the database, in whole
 * centimetres (#29 P4). Two decimals are exactly the centimetres stored, so a size reads back as
 * it was typed: 22.1 m is 2210 cm and 2210 cm is 22.1 m.
 */

/** The centimetres of a side in metres; rounding absorbs float noise (22.1 × 100 = 2210.000…1). */
export function metersToCentimeters(meters: number): number {
  return Math.round(meters * 100);
}

/** The metres of a side in centimetres. */
export function centimetersToMeters(centimeters: number): number {
  return centimeters / 100;
}

/** The two screen columns of a screen, or both null. */
export function screenColumns(screen: HallScreen | null): HallScreenColumns {
  return {
    screen_width_cm: screen ? metersToCentimeters(screen.widthMeters) : null,
    screen_height_cm: screen ? metersToCentimeters(screen.heightMeters) : null,
  };
}

/** The screen of a hall row's two columns; null unless both are set (`chk_halls_screen_size`). */
export function screenOf(widthCm: number | null, heightCm: number | null): HallScreen | null {
  if (widthCm === null || heightCm === null) return null;
  return {
    widthMeters: centimetersToMeters(widthCm),
    heightMeters: centimetersToMeters(heightCm),
  };
}
