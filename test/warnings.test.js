import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getWarnings, formatWarning } from '../shared/warnings.js';
import { makePlant, makeEvent } from './fixtures.js';

const JULY = '2026-07-22';

const overduePlantAndEvents = () => {
  const plant = makePlant(); // summer interval 7
  const events = [makeEvent({ date: '2026-07-12T10:00:00' })]; // 10 days before JULY
  return { plant, events };
};

describe('getWarnings — watering overdue', () => {
  it('fires for an overdue active plant with the numbers in data', () => {
    const { plant, events } = overduePlantAndEvents();
    const warnings = getWarnings({ plants: [plant], events, today: JULY });
    assert.equal(warnings.length, 1);
    const w = warnings[0];
    assert.equal(w.type, 'watering-overdue');
    assert.equal(w.id, 'watering-overdue:test-plant');
    assert.equal(w.severity, 'warn');
    assert.deepEqual(w.data, { daysSince: 10, interval: 7, overdueDays: 3, season: 'summer' });
  });

  it('respects the observed override — no alarm at the reference frequency', () => {
    const { plant, events } = overduePlantAndEvents();
    plant.care.observed = { watering_days_summer: 14 };
    assert.deepEqual(getWarnings({ plants: [plant], events, today: JULY }), []);
  });

  it('escalates to urgent past 1.5× the interval', () => {
    const plant = makePlant(); // interval 7; 1.5× = 10.5
    const at = (date) =>
      getWarnings({ plants: [plant], events: [makeEvent({ date })], today: JULY })[0];
    assert.equal(at('2026-07-12T10:00:00').severity, 'warn'); // 10 days
    assert.equal(at('2026-07-11T10:00:00').severity, 'urgent'); // 11 days
  });

  it('stays silent for non-active plants and never-watered plants', () => {
    const wishlist = makePlant({ id: 'wish', status: 'wishlist' });
    const deceased = makePlant({ id: 'rip', status: 'deceased' });
    const neverWatered = makePlant({ id: 'new' });
    const events = [
      makeEvent({ plantId: 'wish', date: '2026-05-01T10:00:00' }),
      makeEvent({ plantId: 'rip', date: '2026-05-01T10:00:00' }),
    ];
    assert.deepEqual(
      getWarnings({ plants: [wishlist, deceased, neverWatered], events, today: JULY }),
      [],
    );
  });

  it('uses the season parameter for interval selection', () => {
    const { plant, events } = overduePlantAndEvents(); // 10 days since; winter interval 12
    assert.equal(getWarnings({ plants: [plant], events, today: JULY, season: 'winter' }).length, 0);
  });
});

describe('getWarnings — calendar warnings', () => {
  it('warns about seasonal light in September for high-sun plants only', () => {
    const sunny = makePlant({ id: 'sunny' });
    sunny.care.reference.sun_need = 'high';
    const shady = makePlant({ id: 'shady' });
    shady.care.reference.sun_need = 'low';

    const september = getWarnings({ plants: [sunny, shady], events: [], today: '2026-09-10' });
    const light = september.filter((w) => w.type === 'seasonal-light');
    assert.equal(light.length, 1);
    assert.equal(light[0].id, 'seasonal-light:sunny:2026');

    const august = getWarnings({ plants: [sunny], events: [], today: '2026-08-10' });
    assert.equal(august.filter((w) => w.type === 'seasonal-light').length, 0);
  });

  it('reads sun_need through effective care (observed override counts)', () => {
    const plant = makePlant();
    plant.care.reference.sun_need = 'medium';
    plant.care.observed = { sun_need: 'high' };
    const warnings = getWarnings({ plants: [plant], events: [], today: '2026-09-10' });
    assert.equal(warnings.filter((w) => w.type === 'seasonal-light').length, 1);
  });

  it('fires feeding-resume in March and feeding-stop in October, once, globally', () => {
    const march = getWarnings({ plants: [], events: [], today: '2026-03-05' });
    assert.deepEqual(
      march.map((w) => w.id),
      ['feeding-resume:2026'],
    );

    const october = getWarnings({ plants: [], events: [], today: '2026-10-05' });
    assert.deepEqual(
      october.map((w) => w.id),
      ['feeding-stop:2026-autumn'],
    );

    assert.deepEqual(getWarnings({ plants: [], events: [], today: JULY }), []);
  });

  it('ignores the manual season override for calendar warnings', () => {
    // Forcing winter in July must NOT fire the autumn feeding-stop.
    const july = getWarnings({ plants: [], events: [], today: JULY, season: 'winter' });
    assert.deepEqual(july, []);
  });
});

describe('getWarnings — observed-interval suggestion', () => {
  // Fixture plant: summer interval 7. Two consecutive 9-day gaps (≥ 7+2)
  // ending in summer, the latest containing a "still moist" check.
  const wateringsAt = (...dates) =>
    dates.map((date, i) => makeEvent({ id: `w-${i}`, date: `${date}T10:00:00` }));

  const suggestionsFor = (events, today = JULY) =>
    getWarnings({ plants: [makePlant()], events, today }).filter(
      (w) => w.type === 'interval-suggestion',
    );

  it('suggests the median gap when ≥2 long gaps exist and the latest was checked', () => {
    const events = [
      ...wateringsAt('2026-07-01', '2026-07-10', '2026-07-19'),
      makeEvent({ id: 'c', type: 'check', date: '2026-07-17T09:00:00' }),
    ];
    const [w] = suggestionsFor(events);
    assert.ok(w, 'expected an interval-suggestion');
    assert.equal(w.id, 'interval-suggestion:test-plant:summer:9');
    assert.equal(w.severity, 'info');
    assert.deepEqual(w.data, { suggested: 9, interval: 7, gapCount: 2, season: 'summer' });
  });

  it('stays silent without a check in the most recent long gap', () => {
    const events = wateringsAt('2026-07-01', '2026-07-10', '2026-07-19');
    assert.equal(suggestionsFor(events).length, 0);
  });

  it('a check in an OLDER gap does not count', () => {
    const events = [
      ...wateringsAt('2026-07-01', '2026-07-10', '2026-07-19'),
      makeEvent({ id: 'c', type: 'check', date: '2026-07-05T09:00:00' }), // first gap
    ];
    assert.equal(suggestionsFor(events).length, 0);
  });

  it('needs at least two qualifying gaps', () => {
    const events = [
      ...wateringsAt('2026-07-10', '2026-07-19'), // one 9-day gap
      makeEvent({ id: 'c', type: 'check', date: '2026-07-17T09:00:00' }),
    ];
    assert.equal(suggestionsFor(events).length, 0);
  });

  it('gaps under interval + 2 days do not qualify', () => {
    const events = [
      ...wateringsAt('2026-07-03', '2026-07-11', '2026-07-19'), // two 8-day gaps (< 9)
      makeEvent({ id: 'c', type: 'check', date: '2026-07-17T09:00:00' }),
    ];
    assert.equal(suggestionsFor(events).length, 0);
  });

  it('a single ordinary gap breaks the pattern (top-up watering silences it)', () => {
    // Two long gaps, then a 2-day top-up by the other gardener: the latest
    // log contradicts "keeps doing fine for ~9 days", so nothing may fire.
    const events = [
      ...wateringsAt('2026-07-01', '2026-07-10', '2026-07-19', '2026-07-21'),
      makeEvent({ id: 'c', type: 'check', date: '2026-07-17T09:00:00' }),
    ];
    assert.equal(suggestionsFor(events).length, 0);
  });

  it('takes the median of an odd gap set (9, 9, 13 → 9)', () => {
    const events = [
      ...wateringsAt('2026-06-19', '2026-06-28', '2026-07-07', '2026-07-20'),
      makeEvent({ id: 'c', type: 'check', date: '2026-07-15T09:00:00' }),
    ];
    const [w] = suggestionsFor(events);
    assert.equal(w.data.suggested, 9);
    assert.equal(w.data.gapCount, 3);
  });

  it('only counts gaps lying entirely within the current season', () => {
    // Two winter gaps and the cross-season Jan→Jul gap (which ENDS in summer
    // but would skew the median to ~90 days) are all excluded; the single
    // all-summer gap stays below the 2-gap threshold.
    const events = [
      ...wateringsAt('2026-01-01', '2026-01-10', '2026-01-19', '2026-07-10', '2026-07-19'),
      makeEvent({ id: 'c', type: 'check', date: '2026-07-17T09:00:00' }),
    ];
    assert.equal(suggestionsFor(events).length, 0);
  });

  it('formats actionable prose, never auto-applies anything', () => {
    const events = [
      ...wateringsAt('2026-07-01', '2026-07-10', '2026-07-19'),
      makeEvent({ id: 'c', type: 'check', date: '2026-07-17T09:00:00' }),
    ];
    const [w] = suggestionsFor(events);
    assert.match(
      formatWarning(w, makePlant()),
      /consider recording 9 days as its observed summer rhythm/,
    );
  });
});

describe('getWarnings — determinism (Phase 2 dedup contract)', () => {
  it('returns identical ids and order across calls with the same inputs', () => {
    const plants = [makePlant({ id: 'b-plant' }), makePlant({ id: 'a-plant' })];
    plants.forEach((p) => {
      p.care.reference.sun_need = 'high';
    });
    const events = [
      makeEvent({ plantId: 'a-plant', date: '2026-08-25T10:00:00' }),
      makeEvent({ plantId: 'b-plant', date: '2026-08-25T10:00:00' }),
    ];
    const input = { plants, events, today: '2026-09-10' };
    const a = getWarnings(input);
    const b = getWarnings(input);
    assert.deepEqual(a, b);
    // severity desc, then type, then plantId
    assert.deepEqual(
      a.map((w) => w.id),
      [
        'watering-overdue:a-plant',
        'watering-overdue:b-plant',
        'seasonal-light:a-plant:2026',
        'seasonal-light:b-plant:2026',
      ],
    );
  });
});

describe('formatWarning', () => {
  it('renders overdue prose from data', () => {
    const { plant, events } = overduePlantAndEvents();
    const [w] = getWarnings({ plants: [plant], events, today: JULY });
    assert.equal(
      formatWarning(w, plant),
      "It's been 10 days since you watered Test plant — check the substrate moisture (summer rhythm is every 7 days).",
    );
  });

  it('renders every type without a plant object', () => {
    for (const type of ['seasonal-light', 'feeding-resume', 'feeding-stop']) {
      const text = formatWarning({ type, plantId: 'x', data: {} });
      assert.equal(typeof text, 'string');
      assert.ok(text.length > 10, type);
    }
  });
});
