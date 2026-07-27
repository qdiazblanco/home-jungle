import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOp,
  applyOps,
  diffPlant,
  deepSet,
  deepDelete,
  fileForOp,
  describeOp,
} from '../shared/ops.js';
import { makePlant, makeEvent } from './fixtures.js';

const baseData = () => ({
  plants: [makePlant()],
  events: [makeEvent({ id: 'existing', date: '2026-07-01T10:00:00' })],
});

describe('applyOp — appendEvents', () => {
  it('appends new events', () => {
    const data = baseData();
    const out = applyOp(data, {
      type: 'appendEvents',
      events: [makeEvent({ id: 'fresh' })],
    });
    assert.equal(out.events.length, 2);
    assert.notEqual(out, data);
  });

  it('is idempotent: already-present ids are skipped, full replay is a no-op', () => {
    // The "PUT succeeded but the response was lost" scenario: on retry the
    // same op must not duplicate the six waterings it already committed.
    const data = baseData();
    const op = { type: 'appendEvents', events: [makeEvent({ id: 'once' })] };
    const first = applyOp(data, op);
    const second = applyOp(first, op);
    assert.equal(second, first); // same object → flusher sees "already applied"
    assert.equal(second.events.filter((e) => e.id === 'once').length, 1);
  });

  it('appends only the missing part of a partially-applied batch', () => {
    const data = baseData();
    const op = {
      type: 'appendEvents',
      events: [makeEvent({ id: 'existing' }), makeEvent({ id: 'new-one' })],
    };
    const out = applyOp(data, op);
    assert.equal(out.events.length, 2);
    assert.ok(out.events.some((e) => e.id === 'new-one'));
  });
});

describe('applyOp — removeEvent / createPlant', () => {
  it('removes an event by id, idempotently', () => {
    const data = baseData();
    const op = { type: 'removeEvent', id: 'existing' };
    const out = applyOp(data, op);
    assert.equal(out.events.length, 0);
    assert.equal(applyOp(out, op), out);
  });

  it('updates an event in place, idempotently (fixing the author)', () => {
    const data = baseData();
    const op = {
      type: 'updateEvent',
      id: 'existing',
      changes: { author: 'Pepa', note: 'It was me all along' },
    };
    const out = applyOp(data, op);
    assert.equal(out.events[0].author, 'Pepa');
    assert.equal(out.events[0].note, 'It was me all along');
    assert.equal(out.events[0].type, 'watering'); // untouched fields survive
    assert.equal(applyOp(out, op), out); // replay is a no-op
    assert.equal(applyOp(data, { type: 'updateEvent', id: 'ghost', changes: { author: 'X' } }), data);
  });

  it('creates a plant unless the id already exists', () => {
    const data = baseData();
    const plant = makePlant({ id: 'newbie', name: 'Newbie' });
    const out = applyOp(data, { type: 'createPlant', plant });
    assert.equal(out.plants.length, 2);
    assert.equal(applyOp(out, { type: 'createPlant', plant }), out);
  });
});

describe('applyOp — patchPlant', () => {
  it('sets nested dot-paths and removes overrides', () => {
    const data = baseData();
    const out = applyOp(data, {
      type: 'patchPlant',
      plantId: 'test-plant',
      changes: {
        'care.observed.watering_days_summer': 14,
        'care.observed.watering_days_summer_note': 'less thirsty here',
      },
      removals: ['care.observed.humidity'],
    });
    const plant = out.plants[0];
    assert.equal(plant.care.observed.watering_days_summer, 14);
    assert.equal(plant.care.observed.watering_days_summer_note, 'less thirsty here');
    assert.equal(Object.hasOwn(plant.care.observed, 'humidity'), false);
    // untouched fields intact
    assert.equal(plant.care.reference.watering_days_summer, 7);
    assert.equal(data.plants[0].care.observed.watering_days_summer, undefined); // no mutation
  });

  it('is a no-op for unknown plants and for changes already applied', () => {
    const data = baseData();
    assert.equal(
      applyOp(data, { type: 'patchPlant', plantId: 'ghost', changes: { name: 'X' } }),
      data,
    );
    const op = { type: 'patchPlant', plantId: 'test-plant', changes: { name: 'Renamed' } };
    const once = applyOp(data, op);
    assert.equal(applyOp(once, op), once);
  });

  it('preserves the other gardener’s interim edits on replay (the two-phone case)', () => {
    // Kike edits the watering override offline. Meanwhile Pepa's note lands
    // upstream. Kike's queued PATCH must merge onto fresh data, not clobber it.
    const base = makePlant();
    const kikeEdit = structuredClone(base);
    kikeEdit.care.observed = { watering_days_summer: 14 };
    const patch = diffPlant(base, kikeEdit);

    const fresh = structuredClone(base);
    fresh.general_notes = 'Pepa: new leaf unfurling!';

    const out = applyOp(
      { plants: [fresh], events: [] },
      { type: 'patchPlant', plantId: base.id, ...patch },
    );
    assert.equal(out.plants[0].general_notes, 'Pepa: new leaf unfurling!'); // preserved
    assert.equal(out.plants[0].care.observed.watering_days_summer, 14); // applied
  });
});

describe('diffPlant', () => {
  it('produces a minimal field-level patch, never touching id', () => {
    const base = makePlant();
    const edited = structuredClone(base);
    edited.id = 'hacked';
    edited.name = 'Renamed';
    edited.location.room = 'Bedroom';
    delete edited.care.reference.humidity;

    const { changes, removals } = diffPlant(base, edited);
    assert.deepEqual(changes, { name: 'Renamed', 'location.room': 'Bedroom' });
    assert.deepEqual(removals, ['care.reference.humidity']);
  });

  it('treats arrays as whole-value leaves', () => {
    const base = makePlant();
    const edited = structuredClone(base);
    edited.care.reference.substrate_recipe = [{ component: 'Pumice', ratio: '100%' }];
    const { changes } = diffPlant(base, edited);
    assert.deepEqual(Object.keys(changes), ['care.reference.substrate_recipe']);
    assert.equal(changes['care.reference.substrate_recipe'].length, 1);
  });

  it('round-trips: applying the diff to the base reproduces the edit', () => {
    const base = makePlant();
    const edited = structuredClone(base);
    edited.nickname = 'The Monster';
    edited.care.observed = { humidity: 'Fine without misting' };
    delete edited.photo;

    const patch = diffPlant(base, edited);
    const out = applyOp(
      { plants: [base], events: [] },
      { type: 'patchPlant', plantId: base.id, ...patch },
    );
    assert.deepEqual(out.plants[0], edited);
  });
});

describe('deepSet / deepDelete', () => {
  it('creates intermediate objects and deletes leaves', () => {
    const obj = {};
    deepSet(obj, 'a.b.c', 1);
    assert.deepEqual(obj, { a: { b: { c: 1 } } });
    deepDelete(obj, 'a.b.c');
    assert.deepEqual(obj, { a: { b: {} } });
    deepDelete(obj, 'never.existed.path'); // must not throw
  });
});

describe('helpers', () => {
  it('maps ops to their target file', () => {
    assert.equal(fileForOp({ type: 'appendEvents' }), 'data/events.json');
    assert.equal(fileForOp({ type: 'removeEvent' }), 'data/events.json');
    assert.equal(fileForOp({ type: 'createPlant' }), 'data/plants.json');
    assert.equal(fileForOp({ type: 'patchPlant' }), 'data/plants.json');
  });

  it('describes ops in human terms', () => {
    const plantsById = new Map([['test-plant', makePlant()]]);
    const op = {
      type: 'appendEvents',
      events: [makeEvent({ type: 'watering' }), makeEvent({ type: 'feeding' })],
    };
    assert.equal(describeOp(op, plantsById), 'watering + feeding for Test plant');
  });
});

describe('applyOps', () => {
  it('applies in order and preserves identity when nothing changes', () => {
    const data = baseData();
    const ops = [
      { type: 'appendEvents', events: [makeEvent({ id: 'q1' })] },
      { type: 'patchPlant', plantId: 'test-plant', changes: { name: 'Watered friend' } },
    ];
    const out = applyOps(data, ops);
    assert.equal(out.events.length, 2);
    assert.equal(out.plants[0].name, 'Watered friend');
    assert.equal(applyOps(out, ops), out);
  });
});
