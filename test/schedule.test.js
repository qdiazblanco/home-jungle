import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastEventOfType,
  wateringIntervalFor,
  wateringStatus,
  compareUrgency,
  CHECK_SNOOZE_DAYS,
} from '../shared/schedule.js';
import { makePlant, makeEvent } from './fixtures.js';

const TODAY = '2026-07-22';

describe('lastEventOfType', () => {
  it('picks the latest matching event by date, not by array position', () => {
    // A backdated watering ("I watered this yesterday") is appended AFTER a
    // newer one — max(date) must still win.
    const events = [
      makeEvent({ id: 'newer', date: '2026-07-20T10:00:00' }),
      makeEvent({ id: 'backdated', date: '2026-07-15T09:00:00' }),
    ];
    assert.equal(lastEventOfType(events, 'test-plant', 'watering', TODAY).id, 'newer');
  });

  it('ignores other event types — a note must not reset the watering clock', () => {
    const events = [
      makeEvent({ id: 'water', type: 'watering', date: '2026-07-10T10:00:00' }),
      makeEvent({ id: 'note', type: 'note', date: '2026-07-21T10:00:00' }),
      makeEvent({ id: 'mist', type: 'misting', date: '2026-07-21T18:00:00' }),
    ];
    assert.equal(lastEventOfType(events, 'test-plant', 'watering', TODAY).id, 'water');
  });

  it('ignores future-dated events (typos must not silence the schedule)', () => {
    const events = [
      makeEvent({ id: 'real', date: '2026-07-10T10:00:00' }),
      makeEvent({ id: 'typo', date: '2027-07-20T10:00:00' }),
    ];
    assert.equal(lastEventOfType(events, 'test-plant', 'watering', TODAY).id, 'real');
  });

  it('ignores events for other plants and unparseable dates', () => {
    const events = [
      makeEvent({ id: 'other', plantId: 'someone-else', date: '2026-07-21T10:00:00' }),
      makeEvent({ id: 'broken', date: 'not-a-date' }),
    ];
    assert.equal(lastEventOfType(events, 'test-plant', 'watering', TODAY), null);
  });

  it('handles multi-select batches sharing one timestamp deterministically', () => {
    const events = [
      makeEvent({ id: 'a', date: '2026-07-20T10:00:00' }),
      makeEvent({ id: 'b', date: '2026-07-20T10:00:00' }),
    ];
    const result = lastEventOfType(events, 'test-plant', 'watering', TODAY);
    assert.equal(result.id, 'a'); // first of equals — stable
  });
});

describe('wateringIntervalFor', () => {
  it('selects summer vs winter from effective care', () => {
    const plant = makePlant();
    assert.equal(wateringIntervalFor(plant, 'summer'), 7);
    assert.equal(wateringIntervalFor(plant, 'winter'), 12);
  });

  it('uses the observed override — never the reference — for scheduling', () => {
    const plant = makePlant({
      care: { reference: { watering_days_summer: 7 }, observed: { watering_days_summer: 14 } },
    });
    assert.equal(wateringIntervalFor(plant, 'summer'), 14);
  });

  it('returns null for missing or nonsense intervals', () => {
    assert.equal(wateringIntervalFor(makePlant({ care: { reference: {} } }), 'summer'), null);
    assert.equal(
      wateringIntervalFor(makePlant({ care: { reference: { watering_days_summer: 0 } } }), 'summer'),
      null,
    );
    assert.equal(
      wateringIntervalFor(
        makePlant({ care: { reference: { watering_days_summer: 'weekly' } } }),
        'summer',
      ),
      null,
    );
  });
});

describe('wateringStatus', () => {
  const statusAfter = (daysSince) => {
    const plant = makePlant(); // summer interval 7
    const events = [makeEvent({ date: `2026-07-${String(22 - daysSince).padStart(2, '0')}T10:00:00` })];
    return wateringStatus(plant, events, TODAY, 'summer');
  };

  it('walks the exact state boundaries: interval −2, −1, 0, +1 days', () => {
    assert.equal(statusAfter(5).state, 'fine'); // dueIn 2
    assert.equal(statusAfter(6).state, 'soon'); // dueIn 1
    assert.equal(statusAfter(7).state, 'due'); // dueIn 0
    assert.equal(statusAfter(8).state, 'overdue'); // dueIn -1
  });

  it('reports the numbers views need', () => {
    const s = statusAfter(8);
    assert.equal(s.daysSince, 8);
    assert.equal(s.interval, 7);
    assert.equal(s.dueIn, -1);
    assert.equal(s.lastWatering, '2026-07-14');
  });

  it('does not fire overdue at the reference interval when observed is longer', () => {
    // The brief's unacceptable bug: observed 14 days must not alarm at 7.
    const plant = makePlant({
      care: { reference: { watering_days_summer: 7 }, observed: { watering_days_summer: 14 } },
    });
    const events = [makeEvent({ date: '2026-07-12T10:00:00' })]; // 10 days ago
    assert.equal(wateringStatus(plant, events, TODAY, 'summer').state, 'fine');
  });

  it('returns explicit unknown for a never-watered active plant — not fake overdue', () => {
    const s = wateringStatus(makePlant(), [], TODAY, 'summer');
    assert.equal(s.state, 'unknown');
    assert.equal(s.reason, 'never-watered');
    assert.equal(s.daysSince, null);
  });

  it('returns unknown (no-interval) when care has no usable frequency', () => {
    const plant = makePlant({ care: { reference: {} } });
    const events = [makeEvent({ date: '2026-07-20T10:00:00' })];
    const s = wateringStatus(plant, events, TODAY, 'summer');
    assert.equal(s.state, 'unknown');
    assert.equal(s.reason, 'no-interval');
  });

  it('returns null for every non-active status, even with matching events', () => {
    for (const status of ['wishlist', 'gifted', 'deceased']) {
      const plant = makePlant({ status });
      const events = [makeEvent({ date: '2026-06-01T10:00:00' })];
      assert.equal(wateringStatus(plant, events, TODAY, 'summer'), null, status);
    }
  });

  it('switches interval with the season', () => {
    const plant = makePlant(); // 7 summer / 12 winter
    const events = [makeEvent({ date: '2026-07-12T10:00:00' })]; // 10 days ago
    assert.equal(wateringStatus(plant, events, TODAY, 'summer').state, 'overdue');
    assert.equal(wateringStatus(plant, events, TODAY, 'winter').state, 'fine');
  });
});

describe('wateringIntervalFor — blended mode', () => {
  // Fixture plant: summer 7 / winter 12. Blend = winter + (summer−winter)·w.
  const blendedAt = (today, plant = makePlant()) =>
    wateringIntervalFor(plant, 'summer', { mode: 'blended', today });

  it('hits the anchors: January = winter value, July = summer value', () => {
    assert.equal(blendedAt('2026-01-15'), 12);
    assert.equal(blendedAt('2026-07-15'), 7);
  });

  it('interpolates the shoulder months, rounded', () => {
    assert.equal(blendedAt('2026-04-10'), 10); // 12 − 5·(3/6) = 9.5 → 10
    assert.equal(blendedAt('2026-10-10'), 10); // symmetric
    assert.equal(blendedAt('2026-06-10'), 8); // 12 − 5·(5/6) ≈ 7.83 → 8
    assert.equal(blendedAt('2026-02-10'), 11); // 12 − 5·(1/6) ≈ 11.17 → 11
  });

  it('never drops below 1 day', () => {
    const plant = makePlant({
      care: { reference: { watering_days_summer: 1, watering_days_winter: 1 }, observed: {} },
    });
    assert.equal(blendedAt('2026-07-15', plant), 1);
  });

  it('keeps a single usable value year-round instead of blending with nothing', () => {
    const summerOnly = makePlant({
      care: { reference: { watering_days_summer: 7 }, observed: {} },
    });
    assert.equal(blendedAt('2026-01-15', summerOnly), 7);
    const neither = makePlant({ care: { reference: {}, observed: {} } });
    assert.equal(blendedAt('2026-01-15', neither), null);
  });

  it('reads the observed layer like binary mode does', () => {
    const plant = makePlant({
      care: {
        reference: { watering_days_summer: 7, watering_days_winter: 12 },
        observed: { watering_days_winter: 20 },
      },
    });
    assert.equal(blendedAt('2026-01-15', plant), 20);
    assert.equal(blendedAt('2026-04-10', plant), 14); // 20 − 13·(3/6) = 13.5 → 14
  });

  it('threads through wateringStatus without changing binary defaults', () => {
    const plant = makePlant(); // summer 7
    const events = [makeEvent({ date: '2026-07-13T10:00:00' })]; // 9 days before TODAY
    assert.equal(wateringStatus(plant, events, TODAY, 'summer').state, 'overdue');
    assert.equal(
      wateringStatus(plant, events, TODAY, 'summer', { mode: 'blended' }).state,
      'overdue', // July blends to the pure summer value anyway
    );
  });
});

describe('wateringStatus — "still moist" soil checks', () => {
  // The brief's worked example: interval 10, watered 12 days ago → overdue;
  // a check today lifts it to fine (dueIn 2), then the nag walks back in.
  const tenDayPlant = () =>
    makePlant({ care: { reference: { watering_days_summer: 10 }, observed: {} } });
  const watered = makeEvent({ id: 'w', date: '2026-07-10T10:00:00' }); // 12 days before the 22nd

  it('snoozes an overdue plant for CHECK_SNOOZE_DAYS, then resumes the nag', () => {
    assert.equal(CHECK_SNOOZE_DAYS, 2);
    const plant = tenDayPlant();
    const check = makeEvent({ id: 'c', type: 'check', date: '2026-07-22T09:00:00' });

    assert.equal(wateringStatus(plant, [watered], TODAY, 'summer').state, 'overdue');

    const day = (today) => wateringStatus(plant, [watered, check], today, 'summer');
    assert.equal(day('2026-07-22').state, 'fine'); // dueIn 2
    assert.equal(day('2026-07-22').dueIn, 2);
    assert.equal(day('2026-07-23').state, 'soon'); // dueIn 1
    assert.equal(day('2026-07-24').state, 'due'); // dueIn 0
    assert.equal(day('2026-07-25').state, 'overdue'); // nag resumes
  });

  it('keeps daysSince honest and exposes the check as the active anchor', () => {
    const plant = tenDayPlant();
    const check = makeEvent({ id: 'c', type: 'check', date: '2026-07-22T09:00:00' });
    const s = wateringStatus(plant, [watered, check], TODAY, 'summer');
    assert.equal(s.daysSince, 12); // days since the WATERING, not the check
    assert.equal(s.lastWatering, '2026-07-10');
    assert.equal(s.lastCheck, '2026-07-22');
  });

  it('handles backdated checks (snooze window counted from the check day)', () => {
    const plant = tenDayPlant();
    const backdated = makeEvent({ id: 'c', type: 'check', date: '2026-07-21T12:00:00' });
    const s = wateringStatus(plant, [watered, backdated], TODAY, 'summer');
    assert.equal(s.dueIn, 1); // 2 − 1 day since the check
    assert.equal(s.state, 'soon');
  });

  it('ignores a check older than the last watering', () => {
    const plant = tenDayPlant();
    const stale = makeEvent({ id: 'c', type: 'check', date: '2026-07-05T10:00:00' });
    const s = wateringStatus(plant, [watered, stale], TODAY, 'summer');
    assert.equal(s.state, 'overdue');
    assert.equal(s.lastCheck, null);
  });

  it('never rescues an unknown plant — a check is not a watering', () => {
    const plant = tenDayPlant();
    const check = makeEvent({ id: 'c', type: 'check', date: '2026-07-22T09:00:00' });
    const s = wateringStatus(plant, [check], TODAY, 'summer');
    assert.equal(s.state, 'unknown');
    assert.equal(s.reason, 'never-watered');
  });

  it('never lowers dueIn for a freshly watered plant', () => {
    const plant = tenDayPlant();
    const fresh = makeEvent({ id: 'w2', date: '2026-07-21T10:00:00' }); // 1 day ago
    const check = makeEvent({ id: 'c', type: 'check', date: '2026-07-22T09:00:00' });
    const s = wateringStatus(plant, [fresh, check], TODAY, 'summer');
    assert.equal(s.dueIn, 9); // max(9, 2) — the snooze can only lift
    assert.equal(s.state, 'fine');
  });
});

describe('compareUrgency', () => {
  it('orders overdue < due < soon < unknown < fine, deepest overdue first', () => {
    const sorted = [
      { state: 'fine', dueIn: 3 },
      { state: 'overdue', dueIn: -1 },
      { state: 'unknown', dueIn: null },
      { state: 'overdue', dueIn: -5 },
      { state: 'soon', dueIn: 1 },
      { state: 'due', dueIn: 0 },
    ].sort(compareUrgency);
    assert.deepEqual(
      sorted.map((s) => `${s.state}:${s.dueIn}`),
      ['overdue:-5', 'overdue:-1', 'due:0', 'soon:1', 'unknown:null', 'fine:3'],
    );
  });
});
