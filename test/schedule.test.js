import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastEventOfType,
  wateringIntervalFor,
  wateringStatus,
  compareUrgency,
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
