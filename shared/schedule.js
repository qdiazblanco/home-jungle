// Watering schedule: last watering, urgency state, sorting.
// Pure — inputs in, data out. `today` is always a "YYYY-MM-DD" string.
//
// Urgency contract (integer days; dueIn = interval − daysSinceLastWatering):
//   dueIn >= 2  → 'fine'
//   dueIn == 1  → 'soon'
//   dueIn == 0  → 'due'
//   dueIn <  0  → 'overdue'
// Plants with no watering history or no usable interval get an explicit
// 'unknown' state — never a fake overdue count derived from `acquired`.
// Only status:"active" plants are scheduled (wishlist/gifted/deceased are
// encyclopedia records, not chores).

import { dayOf, daysBetween } from './dates.js';
import { effectiveCare } from './effective-care.js';

/**
 * Most recent event of `type` for `plantId`, dated on or before `today`.
 * Uses max(date), never array position: backdated events are appended at the
 * end of the log but must still resolve correctly, and future-dated events
 * (typos) must not silence the schedule.
 */
export function lastEventOfType(events, plantId, type, today) {
  let best = null;
  for (const ev of events) {
    if (ev.plantId !== plantId || ev.type !== type) continue;
    const day = dayOf(ev.date);
    if (!day || day > today) continue;
    if (!best || ev.date > best.date) best = ev;
  }
  return best;
}

/** Effective watering interval in days for the season, or null if unusable. */
export function wateringIntervalFor(plant, season) {
  const { values } = effectiveCare(plant);
  const raw = season === 'summer' ? values.watering_days_summer : values.watering_days_winter;
  const days = Number(raw);
  return Number.isFinite(days) && days > 0 ? days : null;
}

/**
 * @returns null for non-active plants, otherwise
 *   { state, interval, daysSince, dueIn, lastWatering, reason? } where
 *   state 'unknown' carries reason 'never-watered' | 'no-interval'.
 */
export function wateringStatus(plant, events, today, season) {
  if (plant.status !== 'active') return null;

  const interval = wateringIntervalFor(plant, season);
  const last = lastEventOfType(events, plant.id, 'watering', today);

  if (!last || interval === null) {
    return {
      state: 'unknown',
      reason: last ? 'no-interval' : 'never-watered',
      interval,
      daysSince: null,
      dueIn: null,
      lastWatering: last ? dayOf(last.date) : null,
    };
  }

  const lastWatering = dayOf(last.date);
  const daysSince = daysBetween(lastWatering, today);
  const dueIn = interval - daysSince;

  let state;
  if (dueIn >= 2) state = 'fine';
  else if (dueIn === 1) state = 'soon';
  else if (dueIn === 0) state = 'due';
  else state = 'overdue';

  return { state, interval, daysSince, dueIn, lastWatering };
}

/** Sort order for the Today view: most urgent first. */
export const STATE_ORDER = ['overdue', 'due', 'soon', 'unknown', 'fine'];

/**
 * Comparator for [plant, status] urgency: overdue (most days over first),
 * then due, soon, unknown, fine. Callers break remaining ties (e.g. by name).
 */
export function compareUrgency(a, b) {
  const rank = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
  if (rank !== 0) return rank;
  return (a.dueIn ?? 0) - (b.dueIn ?? 0);
}
