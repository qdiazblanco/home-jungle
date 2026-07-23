import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seasonForMonth, seasonForDay, SUMMER_MONTHS } from '../shared/season.js';

describe('seasonForMonth', () => {
  it('maps May–September to summer, the rest to winter', () => {
    const expected = {
      1: 'winter',
      2: 'winter',
      3: 'winter',
      4: 'winter',
      5: 'summer',
      6: 'summer',
      7: 'summer',
      8: 'summer',
      9: 'summer',
      10: 'winter',
      11: 'winter',
      12: 'winter',
    };
    for (const [month, season] of Object.entries(expected)) {
      assert.equal(seasonForMonth(Number(month)), season, `month ${month}`);
    }
  });

  it('exposes the summer table for reuse', () => {
    assert.deepEqual(SUMMER_MONTHS, [5, 6, 7, 8, 9]);
  });
});

describe('seasonForDay', () => {
  it('derives the season from the month at the exact boundaries', () => {
    assert.equal(seasonForDay('2026-04-30'), 'winter');
    assert.equal(seasonForDay('2026-05-01'), 'summer');
    assert.equal(seasonForDay('2026-09-30'), 'summer');
    assert.equal(seasonForDay('2026-10-01'), 'winter');
  });

  it('honors a manual override', () => {
    assert.equal(seasonForDay('2026-07-15', 'winter'), 'winter');
    assert.equal(seasonForDay('2026-01-15', 'summer'), 'summer');
  });

  it('treats "auto" and null as no override', () => {
    assert.equal(seasonForDay('2026-07-15', 'auto'), 'summer');
    assert.equal(seasonForDay('2026-07-15', null), 'summer');
  });
});
