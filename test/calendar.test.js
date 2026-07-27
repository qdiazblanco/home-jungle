import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { monthTasks, yearTasks, isHumidityLover } from '../shared/calendar.js';
import { makePlant } from './fixtures.js';

describe('monthTasks', () => {
  it('gives every month at least one task', () => {
    for (let month = 1; month <= 12; month++) {
      assert.ok(monthTasks(month, []).length >= 1, `month ${month}`);
    }
  });

  it('has stable, month-scoped ids', () => {
    const a = monthTasks(10, []);
    const b = monthTasks(10, []);
    assert.deepEqual(a.map((t) => t.id), b.map((t) => t.id));
    assert.ok(a.every((t) => t.id.startsWith('calendar:') && t.id.endsWith(':10')));
  });

  it('marks the feeding transitions in March and October', () => {
    assert.ok(monthTasks(3, []).some((t) => t.id.includes('feeding-resume')));
    assert.ok(monthTasks(10, []).some((t) => t.id.includes('feeding-stop')));
  });

  it('lists high-sun plants for September, using effective care', () => {
    const sunny = makePlant({ id: 'sunny' });
    sunny.care.reference.sun_need = 'medium';
    sunny.care.observed = { sun_need: 'high' }; // observed override counts
    const shady = makePlant({ id: 'shady' });
    shady.care.reference.sun_need = 'low';

    const light = monthTasks(9, [sunny, shady]).find((t) => t.id.includes('seasonal-light'));
    assert.deepEqual(light.plantIds, ['sunny']);
  });

  it('targets humidity lovers for October tropical protection, active only', () => {
    const tropical = makePlant({ id: 'tropical' });
    tropical.care.reference.humidity = 'High — 60%+ or crispy edges';
    const gifted = makePlant({ id: 'gone', status: 'gifted' });
    gifted.care.reference.humidity = 'High';
    const desert = makePlant({ id: 'desert' });
    desert.care.reference.humidity = 'Irrelevant';

    const protect = monthTasks(10, [tropical, gifted, desert]).find((t) =>
      t.id.includes('protect-tropicals'),
    );
    assert.deepEqual(protect.plantIds, ['tropical']);
  });

  it('omits the tropical task when nobody needs it', () => {
    const desert = makePlant({ id: 'desert' });
    desert.care.reference.humidity = 'Irrelevant';
    assert.equal(
      monthTasks(10, [desert]).some((t) => t.id.includes('protect-tropicals')),
      false,
    );
  });
});

describe('isHumidityLover', () => {
  it('reads the effective humidity value', () => {
    const plant = makePlant();
    plant.care.reference.humidity = 'Medium';
    plant.care.observed = { humidity: 'Surprisingly high-maintenance: high humidity or drama' };
    assert.equal(isHumidityLover(plant), true);
  });
});

describe('yearTasks', () => {
  it('returns all twelve months in order', () => {
    const year = yearTasks([]);
    assert.equal(year.length, 12);
    assert.deepEqual(year.map((m) => m.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
