// Seasonal calendar (Phase 2): "what's due this month", fed by the same
// data as the seasonal warnings. Pure — month + plants in, task list out —
// so the calendar view and any future notification digest share one source.
//
// Task shape: { id, month, title, detail, plantIds } with deterministic ids
// ("calendar:feeding-stop:10"). plantIds lists the affected active plants
// when a task is plant-driven; [] means a general note for the whole jungle.

import { effectiveCare } from './effective-care.js';

/** Heuristic for "protect the tropicals": high-humidity lovers. */
export function isHumidityLover(plant) {
  const humidity = effectiveCare(plant).values.humidity;
  return typeof humidity === 'string' && /high/i.test(humidity);
}

function activeOnly(plants) {
  return plants.filter((p) => p.status === 'active');
}

function highSunPlants(plants) {
  return activeOnly(plants).filter((p) => effectiveCare(p).values.sun_need === 'high');
}

/**
 * Tasks for one month (1–12). Every month returns at least one entry so the
 * calendar always has something seasonal to say.
 */
export function monthTasks(month, plants) {
  const active = activeOnly(plants);
  const tasks = [];
  const task = (key, title, detail, plantIds = []) =>
    tasks.push({ id: `calendar:${key}:${month}`, month, title, detail, plantIds });

  switch (month) {
    case 1:
      task('deep-winter', 'Deep winter', 'Water sparingly — cold substrate dries slowly, and soggy roots are the classic winter killer.');
      break;
    case 2:
      task('late-winter', 'Days are lengthening', 'Early growth may appear. Hold feeding until March, but start checking light-hungry plants.');
      break;
    case 3:
      task('feeding-resume', 'Resume feeding', 'The growing season starts — restart each plant’s feeding schedule.');
      task('repotting', 'Repotting season opens', 'March to May is the moment: check which plants have roots circling the pot.', active.map((p) => p.id));
      break;
    case 4:
      task('repotting', 'Repotting season', 'Prime repotting weeks — fresh substrate now fuels the whole season.');
      break;
    case 5:
      task('summer-rhythm', 'Summer watering rhythm begins', 'From May to September the summer intervals apply. Expect everyone to drink faster.');
      task('repotting', 'Last call for repotting', 'Late repots still recover well before the heat peaks.');
      break;
    case 6:
      task('peak-growth', 'Peak growth', 'Feeding schedules at full pace; rotate pots so growth stays even.');
      break;
    case 7:
      task('peak-heat', 'Peak heat', 'Check substrate more often than the rhythm says — heatwaves outrun any schedule. Shade scorch-prone leaves.');
      break;
    case 8:
      task('holiday-check', 'Holiday planning', 'Going away? Group plants away from direct sun and water deeply before leaving.');
      break;
    case 9:
      task('seasonal-light', 'The sun is dropping', 'High-sun plants may need a brighter spot as autumn approaches.', highSunPlants(plants).map((p) => p.id));
      break;
    case 10: {
      task('feeding-stop', 'Stop feeding', 'Growth is winding down — feeding now stresses roots instead of helping.');
      task('winter-rhythm', 'Winter watering rhythm begins', 'From October to April the winter intervals apply.');
      const tropicals = active.filter(isHumidityLover);
      if (tropicals.length) {
        task('protect-tropicals', 'Protect the tropicals', 'Cold drafts and radiators are coming — keep humidity lovers away from both.', tropicals.map((p) => p.id));
      }
      break;
    }
    case 11: {
      const tropicals = active.filter(isHumidityLover);
      task('heating-season', 'Heating season', 'Radiators crash the humidity — pebble trays or grouping help the sensitive ones.', tropicals.map((p) => p.id));
      break;
    }
    case 12:
      task('deep-winter', 'Deep winter', 'Most plants are resting. Watch cold windowsills at night and water with restraint.');
      break;
    default:
      break;
  }
  return tasks;
}

/** All twelve months, in order — convenience for the calendar view. */
export function yearTasks(plants) {
  const months = [];
  for (let month = 1; month <= 12; month++) {
    months.push({ month, tasks: monthTasks(month, plants) });
  }
  return months;
}
