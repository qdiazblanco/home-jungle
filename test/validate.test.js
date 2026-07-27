import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateData, PLANT_STATUSES, EVENT_TYPES, SUN_NEEDS } from '../shared/validate.js';
import { makePlant, makeEvent } from './fixtures.js';

const messagesOf = (list) => list.map((e) => e.message).join(' | ');

describe('validateData — errors (block rendering)', () => {
  it('rejects non-array roots', () => {
    assert.ok(validateData({}, []).errors.length);
    assert.ok(validateData([], 'nope').errors.length);
  });

  it('rejects plants without id or name', () => {
    const { errors } = validateData([{ status: 'active' }], []);
    assert.match(messagesOf(errors), /string id/);
    assert.match(messagesOf(errors), /needs a name/);
  });

  it('rejects duplicate plant ids', () => {
    const { errors } = validateData([makePlant(), makePlant()], []);
    assert.match(messagesOf(errors), /Duplicate plant id/);
  });

  it('rejects unknown status and sun_need enums', () => {
    const plant = makePlant({ status: 'thriving' });
    plant.care.reference.sun_need = 'lots';
    const { errors } = validateData([plant], []);
    assert.match(messagesOf(errors), /Status "thriving"/);
    assert.match(messagesOf(errors), /sun_need "lots"/);
  });

  it('rejects bad events: missing id, duplicate id, unknown type, undated', () => {
    const events = [
      makeEvent({ id: '' }),
      makeEvent({ id: 'dup' }),
      makeEvent({ id: 'dup' }),
      makeEvent({ type: 'vibing' }),
      makeEvent({ date: 'yesterday-ish' }),
    ];
    const { errors } = validateData([makePlant()], events);
    assert.match(messagesOf(errors), /non-empty string id/);
    assert.match(messagesOf(errors), /Duplicate event id/);
    assert.match(messagesOf(errors), /not one of/);
    assert.match(messagesOf(errors), /needs a date/);
  });

  it('passes clean fixture data with no errors and no issues', () => {
    const result = validateData([makePlant()], [makeEvent()], { today: '2026-07-22' });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.issues, []);
  });
});

describe('validateData — issues (render + banner)', () => {
  it('flags an observed key with no reference twin (the silent-typo trap)', () => {
    const plant = makePlant();
    plant.care.observed = { watering_summer_days: 14 }; // typo'd key
    const { errors, issues } = validateData([plant], []);
    assert.equal(errors.length, 0);
    assert.match(messagesOf(issues), /matches no reference parameter/);
  });

  it('accepts canonical care params observed without a reference twin', () => {
    // The quick-edit sheet can record an observation before any literature
    // value exists — that must not be flagged as a typo.
    const plant = makePlant({ care: { reference: {}, observed: { watering_days_summer: 10 } } });
    const { errors, issues } = validateData([plant], []);
    assert.equal(errors.length, 0);
    assert.deepEqual(issues, []);
  });

  it('flags observed nulls and orphan _note companions', () => {
    const plant = makePlant();
    plant.care.observed = { humidity: null, feeding_note: 'orphan' };
    const { issues } = validateData([plant], []);
    assert.match(messagesOf(issues), /is null/);
    assert.match(messagesOf(issues), /no matching observed override/);
  });

  it('flags events referencing unknown plants', () => {
    const { issues } = validateData([makePlant()], [makeEvent({ plantId: 'ghost' })]);
    assert.match(messagesOf(issues), /unknown plant "ghost"/);
  });

  it('flags a parent that matches no plant id', () => {
    const { issues } = validateData([makePlant({ parent: 'mother-ship' })], []);
    assert.match(messagesOf(issues), /Parent "mother-ship"/);
  });

  it('flags future-dated events only when today is provided', () => {
    const events = [makeEvent({ date: '2027-01-01T10:00:00' })];
    assert.equal(validateData([makePlant()], events).issues.length, 0);
    const { issues } = validateData([makePlant()], events, { today: '2026-07-22' });
    assert.match(messagesOf(issues), /future/);
  });

  it('flags unknown plant icons (falls back to the default pot)', () => {
    const { issues } = validateData([makePlant({ icon: 'gnome' })], []);
    assert.match(messagesOf(issues), /Icon "gnome"/);
    assert.equal(validateData([makePlant({ icon: 'hanging' })], []).issues.length, 0);
  });

  it('flags authorless events and bad acquired dates', () => {
    const plant = makePlant({ acquired: 'spring 2024' });
    const { issues } = validateData([plant], [makeEvent({ author: '' })]);
    assert.match(messagesOf(issues), /no author/);
    assert.match(messagesOf(issues), /not a valid YYYY-MM-DD/);
  });
});

describe('exported enums', () => {
  it('match the brief', () => {
    assert.deepEqual(PLANT_STATUSES, ['active', 'gifted', 'deceased', 'wishlist']);
    assert.equal(EVENT_TYPES.length, 9);
    assert.deepEqual(SUN_NEEDS, ['low', 'medium', 'high']);
  });
});
