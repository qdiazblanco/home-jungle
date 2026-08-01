// Season logic (northern hemisphere, decided with the gardeners):
// summer watering rhythm applies May–September, winter otherwise.
//
// The manual override from Settings affects WATERING INTERVAL SELECTION ONLY.
// Calendar-driven warnings (seasonal light, feeding transitions) always key
// off the real month — forcing "winter" in July must never fire the autumn
// feeding-stop warning. See shared/warnings.js.

import { monthOf } from './dates.js';

export const SUMMER_MONTHS = [5, 6, 7, 8, 9];

/** 'summer' | 'winter' for a month number (1–12). */
export function seasonForMonth(month) {
  return SUMMER_MONTHS.includes(month) ? 'summer' : 'winter';
}

/**
 * Season for a "YYYY-MM-DD" day, honoring a manual override
 * ('summer' | 'winter' | null/undefined/'auto' for automatic).
 */
export function seasonForDay(day, override = null) {
  if (override === 'summer' || override === 'winter') return override;
  return seasonForMonth(monthOf(day));
}

/**
 * Summer weight (0–1) of a month for the optional BLENDED schedule mode:
 * January anchors at 0 (pure winter interval), July at 1 (pure summer),
 * with symmetric linear ramps between — Madrid's shoulder seasons are long,
 * and this is the cheap middle path between binary seasons and weather
 * integration. Only interval interpolation uses this; season names,
 * warnings and the calendar stay on seasonForDay.
 */
export function summerWeight(month) {
  return (6 - Math.abs(month - 7)) / 6;
}
