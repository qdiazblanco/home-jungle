// Data validation, two tiers:
// - errors: structural problems that make the data unsafe to work with —
//   the app shows a helpful error screen instead of rendering (never a
//   blank page), and refuses to write.
// - issues: suspicious-but-survivable problems (mostly from hand-editing
//   the JSON) — the app renders and shows a dismissible banner.
//
// Also run by the Phase 2 Action so the daily cron fails loudly instead of
// notifying from garbage.

import { dayOf } from './dates.js';

export const PLANT_STATUSES = ['active', 'gifted', 'deceased', 'wishlist'];
export const EVENT_TYPES = [
  'watering',
  'feeding',
  'repotting',
  'pruning',
  'misting',
  'treatment',
  'cutting',
  'note',
  'photo',
];
export const SUN_NEEDS = ['low', 'medium', 'high'];

/**
 * @param {unknown} plants parsed plants.json
 * @param {unknown} events parsed events.json
 * @param {{ today?: string }} [opts] pass today ("YYYY-MM-DD") to flag
 *   future-dated events as issues.
 * @returns {{ errors: {path, message}[], issues: {path, message}[] }}
 */
export function validateData(plants, events, opts = {}) {
  const errors = [];
  const issues = [];

  if (!Array.isArray(plants)) {
    errors.push({ path: 'plants.json', message: 'Root must be an array of plants.' });
  }
  if (!Array.isArray(events)) {
    errors.push({ path: 'events.json', message: 'Root must be an array of events.' });
  }
  if (errors.length) return { errors, issues };

  const plantIds = new Set();

  plants.forEach((plant, i) => {
    const where = `plants[${i}]`;
    if (!plant || typeof plant !== 'object' || Array.isArray(plant)) {
      errors.push({ path: where, message: 'Each plant must be an object.' });
      return;
    }

    const label = typeof plant.name === 'string' && plant.name ? ` ("${plant.name}")` : '';

    if (typeof plant.id !== 'string' || !plant.id) {
      errors.push({ path: `${where}.id`, message: `Every plant needs a non-empty string id${label}.` });
    } else if (plantIds.has(plant.id)) {
      errors.push({ path: `${where}.id`, message: `Duplicate plant id "${plant.id}" — ids must be unique.` });
    } else {
      plantIds.add(plant.id);
    }

    if (typeof plant.name !== 'string' || !plant.name) {
      errors.push({ path: `${where}.name`, message: 'Every plant needs a name.' });
    }

    if (!PLANT_STATUSES.includes(plant.status)) {
      errors.push({
        path: `${where}.status`,
        message: `Status "${plant.status}" is not one of: ${PLANT_STATUSES.join(', ')}.`,
      });
    }

    if (plant.acquired != null && !dayOf(plant.acquired)) {
      issues.push({
        path: `${where}.acquired`,
        message: `Acquired date "${plant.acquired}" is not a valid YYYY-MM-DD date.`,
      });
    }

    const reference = plant.care?.reference ?? {};
    const observed = plant.care?.observed ?? {};

    for (const layer of ['reference', 'observed']) {
      const care = layer === 'reference' ? reference : observed;
      if (Object.hasOwn(care, 'sun_need') && care.sun_need !== null && !SUN_NEEDS.includes(care.sun_need)) {
        errors.push({
          path: `${where}.care.${layer}.sun_need`,
          message: `sun_need "${care.sun_need}" is not one of: ${SUN_NEEDS.join(', ')}.`,
        });
      }
    }

    for (const key of Object.keys(observed)) {
      if (key.endsWith('_note')) {
        const base = key.slice(0, -'_note'.length);
        if (!Object.hasOwn(observed, base)) {
          issues.push({
            path: `${where}.care.observed.${key}`,
            message: `Note "${key}" has no matching observed override "${base}".`,
          });
        }
        continue;
      }
      if (observed[key] === null) {
        issues.push({
          path: `${where}.care.observed.${key}`,
          message: `Observed "${key}" is null — to remove an override, delete the key (and its _note) instead.`,
        });
        continue;
      }
      if (!Object.hasOwn(reference, key)) {
        issues.push({
          path: `${where}.care.observed.${key}`,
          message:
            `Observed "${key}" matches no reference parameter — if this is a typo, ` +
            'the override you meant is NOT being applied.',
        });
      }
    }
  });

  // Parent references (checked after all ids are known).
  plants.forEach((plant, i) => {
    if (plant?.parent != null && !plantIds.has(plant.parent)) {
      issues.push({
        path: `plants[${i}].parent`,
        message: `Parent "${plant.parent}" matches no plant id.`,
      });
    }
  });

  const eventIds = new Set();

  events.forEach((ev, i) => {
    const where = `events[${i}]`;
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
      errors.push({ path: where, message: 'Each event must be an object.' });
      return;
    }

    if (typeof ev.id !== 'string' || !ev.id) {
      errors.push({ path: `${where}.id`, message: 'Every event needs a non-empty string id.' });
    } else if (eventIds.has(ev.id)) {
      errors.push({ path: `${where}.id`, message: `Duplicate event id "${ev.id}".` });
    } else {
      eventIds.add(ev.id);
    }

    if (!EVENT_TYPES.includes(ev.type)) {
      errors.push({
        path: `${where}.type`,
        message: `Event type "${ev.type}" is not one of: ${EVENT_TYPES.join(', ')}.`,
      });
    }

    if (!dayOf(ev.date)) {
      errors.push({
        path: `${where}.date`,
        message: 'Every event needs a date like "2026-07-22T09:30:00".',
      });
    } else if (opts.today && dayOf(ev.date) > opts.today) {
      issues.push({
        path: `${where}.date`,
        message: `Event is dated in the future (${ev.date}) — probably a typo; it is ignored by schedules until then.`,
      });
    }

    if (typeof ev.plantId !== 'string' || !plantIds.has(ev.plantId)) {
      issues.push({
        path: `${where}.plantId`,
        message: `Event references unknown plant "${ev.plantId}" — it will not appear in any schedule.`,
      });
    }

    if (typeof ev.author !== 'string' || !ev.author) {
      issues.push({ path: `${where}.author`, message: 'Event has no author.' });
    }
  });

  return { errors, issues };
}
