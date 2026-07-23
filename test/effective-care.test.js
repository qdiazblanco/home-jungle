import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveCare } from '../shared/effective-care.js';
import { makePlant } from './fixtures.js';

describe('effectiveCare', () => {
  it('returns reference values untouched when nothing is observed', () => {
    const { values, fields } = effectiveCare(makePlant());
    assert.equal(values.watering_days_summer, 7);
    assert.equal(fields.watering_days_summer.source, 'reference');
    assert.equal(fields.watering_days_summer.observed, undefined);
  });

  it('lets an observed value override the reference — the monstera case', () => {
    const plant = makePlant({
      care: {
        reference: { watering_days_summer: 7 },
        observed: {
          watering_days_summer: 14,
          watering_days_summer_note: 'Thrives with far less water than the literature says',
        },
      },
    });
    const { values, fields } = effectiveCare(plant);
    assert.equal(values.watering_days_summer, 14);
    assert.deepEqual(fields.watering_days_summer, {
      value: 14,
      source: 'observed',
      reference: 7,
      observed: 14,
      note: 'Thrives with far less water than the literature says',
    });
  });

  it('never leaks the reference value once overridden (scheduling reads values only)', () => {
    const plant = makePlant({
      care: { reference: { watering_days_summer: 7 }, observed: { watering_days_summer: 14 } },
    });
    assert.equal(effectiveCare(plant).values.watering_days_summer, 14);
  });

  it('decides by key presence, not truthiness — false and 0 win', () => {
    const plant = makePlant({
      care: {
        reference: { toxic_to_pets: true, watering_days_winter: 12 },
        observed: { toxic_to_pets: false, watering_days_winter: 0 },
      },
    });
    const { values } = effectiveCare(plant);
    assert.equal(values.toxic_to_pets, false);
    assert.equal(values.watering_days_winter, 0);
  });

  it('excludes _note companions from the parameter set', () => {
    const plant = makePlant({
      care: {
        reference: { humidity: 'Medium' },
        observed: { humidity: 'Does fine without misting', humidity_note: 'Tested all winter' },
      },
    });
    const { values, fields } = effectiveCare(plant);
    assert.equal(Object.hasOwn(values, 'humidity_note'), false);
    assert.equal(Object.hasOwn(fields, 'humidity_note'), false);
    assert.equal(fields.humidity.note, 'Tested all winter');
  });

  it('replaces arrays whole, never index-merges them', () => {
    const plant = makePlant({
      care: {
        reference: {
          substrate_recipe: [
            { component: 'Potting mix', ratio: '60%' },
            { component: 'Perlite', ratio: '30%' },
            { component: 'Bark', ratio: '10%' },
          ],
        },
        observed: {
          substrate_recipe: [
            { component: 'Potting mix', ratio: '50%' },
            { component: 'Pumice', ratio: '50%' },
          ],
        },
      },
    });
    const { values } = effectiveCare(plant);
    assert.equal(values.substrate_recipe.length, 2);
    assert.equal(values.substrate_recipe[1].component, 'Pumice');
  });

  it('keeps an observed-only key (no reference twin) visible with provenance', () => {
    const plant = makePlant({
      care: { reference: {}, observed: { misting: 'Twice a week' } },
    });
    const { values, fields } = effectiveCare(plant);
    assert.equal(values.misting, 'Twice a week');
    assert.equal(fields.misting.source, 'observed');
    assert.equal(fields.misting.reference, undefined);
  });

  it('treats an explicit observed null as no override (validate flags it)', () => {
    const plant = makePlant({
      care: { reference: { watering_days_summer: 7 }, observed: { watering_days_summer: null } },
    });
    const { values, fields } = effectiveCare(plant);
    assert.equal(values.watering_days_summer, 7);
    assert.equal(fields.watering_days_summer.source, 'reference');
  });

  it('survives plants with no care block at all', () => {
    const { values, fields } = effectiveCare({ id: 'x', name: 'X', status: 'wishlist' });
    assert.deepEqual(values, {});
    assert.deepEqual(fields, {});
  });
});
