import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seasonForMonth, seasonForDay, summerWeight, SUMMER_MONTHS } from '../shared/season.js';

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

describe('summerWeight (blended schedule mode)', () => {
  it('anchors January at 0 and July at 1 with symmetric linear ramps', () => {
    const sixths = (n) => n / 6;
    const expected = {
      1: 0,
      2: sixths(1),
      3: sixths(2),
      4: sixths(3),
      5: sixths(4),
      6: sixths(5),
      7: 1,
      8: sixths(5),
      9: sixths(4),
      10: sixths(3),
      11: sixths(2),
      12: sixths(1),
    };
    for (const [month, weight] of Object.entries(expected)) {
      assert.equal(summerWeight(Number(month)), weight, `month ${month}`);
    }
  });

  it('is symmetric around July (April equals October)', () => {
    assert.equal(summerWeight(4), summerWeight(10));
    assert.equal(summerWeight(2), summerWeight(12));
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
