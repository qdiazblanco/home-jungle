// Watering schedule: last watering, urgency state, sorting.
// Pure — inputs in, data out. `today` is always a "YYYY-MM-DD" string.
//
// Urgency contract (integer days; dueIn = interval − daysSinceLastWatering):
//   dueIn >= 2  → 'fine'
//   dueIn == 1  → 'soon'
//   dueIn == 0  → 'due'
//   dueIn <  0  → 'overdue'
// A 'check' event ("still moist") more recent than the last watering snoozes
// the state for CHECK_SNOOZE_DAYS without touching the watering history:
// dueIn is lifted to at least (CHECK_SNOOZE_DAYS − daysSinceCheck), while
// daysSince keeps reporting the honest days-since-watering number.
// Plants with no watering history or no usable interval get an explicit
// 'unknown' state — never a fake overdue count derived from `acquired`;
// a check alone never rescues an unknown plant.
// Only status:"active" plants are scheduled (wishlist/gifted/deceased are
// encyclopedia records, not chores).

import { dayOf, daysBetween, monthOf } from './dates.js';
import { effectiveCare } from './effective-care.js';
import { summerWeight } from './season.js';

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

const usableDays = (raw) => {
  const days = Number(raw);
  return Number.isFinite(days) && days > 0 ? days : null;
};

/**
 * Effective watering interval in days, or null if unusable.
 * Default ('binary') mode picks the season's value. The optional 'blended'
 * mode (opts { mode: 'blended', today }) interpolates linearly between the
 * winter and summer values by calendar month (January = winter, July =
 * summer, symmetric ramps), rounded, minimum 1 day; a plant with only one
 * usable value keeps that value year-round.
 */
export function wateringIntervalFor(plant, season, opts = {}) {
  const { values } = effectiveCare(plant);
  const summer = usableDays(values.watering_days_summer);
  const winter = usableDays(values.watering_days_winter);

  if (opts.mode === 'blended' && opts.today) {
    if (summer === null && winter === null) return null;
    if (summer === null || winter === null) return summer ?? winter;
    const blended = Math.round(winter + (summer - winter) * summerWeight(monthOf(opts.today)));
    return Math.max(1, blended);
  }

  return season === 'summer' ? summer : winter;
}

/** Days a "still moist" soil check keeps the schedule quiet. */
export const CHECK_SNOOZE_DAYS = 2;

/**
 * @returns null for non-active plants, otherwise
 *   { state, interval, daysSince, dueIn, lastWatering, lastCheck, reason? }
 *   where state 'unknown' carries reason 'never-watered' | 'no-interval'.
 *   lastCheck is the day of the snoozing check when one is the active
 *   anchor (more recent than the last watering), else null. dueIn reflects
 *   the snooze; daysSince always counts from the last actual watering.
 */
export function wateringStatus(plant, events, today, season, opts = {}) {
  if (plant.status !== 'active') return null;

  const interval = wateringIntervalFor(plant, season, { ...opts, today });
  const last = lastEventOfType(events, plant.id, 'watering', today);

  if (!last || interval === null) {
    return {
      state: 'unknown',
      reason: last ? 'no-interval' : 'never-watered',
      interval,
      daysSince: null,
      dueIn: null,
      lastWatering: last ? dayOf(last.date) : null,
      lastCheck: null,
    };
  }

  const lastWatering = dayOf(last.date);
  const daysSince = daysBetween(lastWatering, today);
  let dueIn = interval - daysSince;

  let lastCheck = null;
  const check = lastEventOfType(events, plant.id, 'check', today);
  if (check) {
    const checkDay = dayOf(check.date);
    if (checkDay > lastWatering) {
      lastCheck = checkDay;
      dueIn = Math.max(dueIn, CHECK_SNOOZE_DAYS - daysBetween(checkDay, today));
    }
  }

  let state;
  if (dueIn >= 2) state = 'fine';
  else if (dueIn === 1) state = 'soon';
  else if (dueIn === 0) state = 'due';
  else state = 'overdue';

  return { state, interval, daysSince, dueIn, lastWatering, lastCheck };
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
