// Warnings module — the core piece. Pure and UI-free:
// input (plants + events + today + season), output (typed warning list).
// Reused by the warnings panel in the client and by the Phase 2 GitHub
// Action for push notifications.
//
// Warning shape: { id, type, plantId, severity, data }
// - id is DETERMINISTIC and stable while the underlying condition persists
//   ("watering-overdue:living-room-monstera"), which gives the Phase 2 daily
//   cron its dedup primitive: diff today's ids against yesterday's and only
//   notify what is new or escalated.
// - severity: 'info' | 'warn' | 'urgent'.
// - data carries the numbers; English prose lives only in formatWarning().
//
// The season parameter affects watering-interval selection only. Calendar
// warnings (seasonal light, feeding transitions) key off the real month in
// `today`, so a manual season override never fires feeding-stop in July.

import { monthOf, yearOf } from './dates.js';
import { effectiveCare } from './effective-care.js';
import { wateringStatus } from './schedule.js';
import { seasonForDay } from './season.js';

export const SEVERITY_RANK = { urgent: 2, warn: 1, info: 0 };

const SEPTEMBER = 9;
const MARCH = 3;
const OCTOBER = 10;

/** Overdue escalates to 'urgent' past 1.5× the effective interval. */
const URGENT_FACTOR = 1.5;

export function getWarnings({ plants, events, today, season = null }) {
  const effectiveSeason = season ?? seasonForDay(today);
  const month = monthOf(today);
  const year = yearOf(today);
  const warnings = [];

  for (const plant of plants) {
    if (plant.status !== 'active') continue;

    const status = wateringStatus(plant, events, today, effectiveSeason);
    if (status?.state === 'overdue') {
      warnings.push({
        id: `watering-overdue:${plant.id}`,
        type: 'watering-overdue',
        plantId: plant.id,
        severity: status.daysSince > status.interval * URGENT_FACTOR ? 'urgent' : 'warn',
        data: {
          daysSince: status.daysSince,
          interval: status.interval,
          overdueDays: -status.dueIn,
          season: effectiveSeason,
        },
      });
    }

    if (month === SEPTEMBER) {
      const { values } = effectiveCare(plant);
      if (values.sun_need === 'high') {
        warnings.push({
          id: `seasonal-light:${plant.id}:${year}`,
          type: 'seasonal-light',
          plantId: plant.id,
          severity: 'info',
          data: { month, year },
        });
      }
    }
  }

  if (month === MARCH) {
    warnings.push({
      id: `feeding-resume:${year}`,
      type: 'feeding-resume',
      plantId: null,
      severity: 'info',
      data: { month, year },
    });
  }
  if (month === OCTOBER) {
    warnings.push({
      id: `feeding-stop:${year}-autumn`,
      type: 'feeding-stop',
      plantId: null,
      severity: 'info',
      data: { month, year },
    });
  }

  // Deterministic order: severity desc, then type, then plant id.
  warnings.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.type.localeCompare(b.type) ||
      String(a.plantId).localeCompare(String(b.plantId)),
  );

  return warnings;
}

/**
 * English message for a warning. `plant` is the matching plant object for
 * per-plant warnings (null for global ones). Kept separate from getWarnings
 * so notification text and panel text come from one swappable place.
 */
export function formatWarning(warning, plant = null) {
  const name = plant?.name ?? warning.plantId ?? 'your plants';
  switch (warning.type) {
    case 'watering-overdue': {
      const { daysSince, interval, season } = warning.data;
      return (
        `It's been ${daysSince} days since you watered ${name} — ` +
        `check the substrate moisture (${season} rhythm is every ${interval} days).`
      );
    }
    case 'seasonal-light':
      return `October is coming: ${name} has high sun needs — check whether it still gets enough light.`;
    case 'feeding-resume':
      return 'Spring is starting: time to resume feeding schedules.';
    case 'feeding-stop':
      return 'Autumn is here: time to wind down feeding until spring.';
    default:
      return `${warning.type}: ${name}`;
  }
}
