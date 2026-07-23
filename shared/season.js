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
