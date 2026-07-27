import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayOf,
  isValidDay,
  daysBetween,
  addDays,
  monthOf,
  yearOf,
  todayString,
  localTimestamp,
  monthGrid,
  addMonths,
} from '../shared/dates.js';

describe('dayOf', () => {
  it('extracts the calendar day from a wall-clock timestamp', () => {
    assert.equal(dayOf('2026-07-22T09:30:00'), '2026-07-22');
  });

  it('accepts a bare day string', () => {
    assert.equal(dayOf('2026-07-22'), '2026-07-22');
  });

  it('keeps a late-evening event on its own calendar day in every timezone', () => {
    // The classic drift bug: parsing "23:30" local as a Date can land on the
    // previous/next day depending on TZ. Prefix slicing cannot.
    assert.equal(dayOf('2026-07-22T23:30:00'), '2026-07-22');
  });

  it('rejects garbage and impossible dates', () => {
    assert.equal(dayOf('not a date'), null);
    assert.equal(dayOf('2026-02-30T10:00:00'), null);
    assert.equal(dayOf(null), null);
    assert.equal(dayOf(20260722), null);
  });
});

describe('isValidDay', () => {
  it('accepts real dates and rejects impossible ones', () => {
    assert.equal(isValidDay('2026-02-28'), true);
    assert.equal(isValidDay('2024-02-29'), true); // leap year
    assert.equal(isValidDay('2026-02-29'), false);
    assert.equal(isValidDay('2026-13-01'), false);
    assert.equal(isValidDay('2026-7-2'), false);
  });
});

describe('daysBetween', () => {
  it('diffs whole days', () => {
    assert.equal(daysBetween('2026-07-01', '2026-07-22'), 21);
    assert.equal(daysBetween('2026-07-22', '2026-07-01'), -21);
    assert.equal(daysBetween('2026-07-22', '2026-07-22'), 0);
  });

  it('is immune to DST transitions (Europe/Madrid changes in March and October)', () => {
    assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
    assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
  });

  it('crosses year boundaries', () => {
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  });
});

describe('addDays', () => {
  it('adds and subtracts across month and year boundaries', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2026-07-22', 0), '2026-07-22');
  });
});

describe('monthOf / yearOf', () => {
  it('reads month and year from the string, no Date parsing', () => {
    assert.equal(monthOf('2026-10-01'), 10);
    assert.equal(monthOf('2026-01-31'), 1);
    assert.equal(yearOf('2026-10-01'), 2026);
  });
});

describe('monthGrid', () => {
  it('builds complete Monday-first weeks covering the month', () => {
    // July 2026: the 1st is a Wednesday; 31 days → 5 weeks.
    const grid = monthGrid(2026, 7);
    assert.equal(grid.length, 5);
    assert.ok(grid.every((week) => week.length === 7));
    assert.equal(grid[0][0].day, '2026-06-29'); // Monday before the 1st
    assert.equal(grid[0][0].inMonth, false);
    assert.equal(grid[0][2].day, '2026-07-01');
    assert.equal(grid[0][2].inMonth, true);
    assert.equal(grid[4][6].day, '2026-08-02'); // trailing Sunday
    assert.equal(grid[4][6].inMonth, false);
    const inMonth = grid.flat().filter((c) => c.inMonth);
    assert.equal(inMonth.length, 31);
    assert.equal(inMonth[30].day, '2026-07-31');
  });

  it('handles a month starting on Monday and February in a leap year', () => {
    // June 2026 starts on a Monday.
    const june = monthGrid(2026, 6);
    assert.equal(june[0][0].day, '2026-06-01');
    // February 2027 (28 days, starts Monday) fits exactly 4 weeks.
    const feb = monthGrid(2027, 2);
    assert.equal(feb.length, 4);
    assert.equal(feb.flat().filter((c) => c.inMonth).length, 28);
  });
});

describe('addMonths', () => {
  it('wraps across year boundaries in both directions', () => {
    assert.deepEqual(addMonths(2026, 12, 1), { year: 2027, month: 1 });
    assert.deepEqual(addMonths(2026, 1, -1), { year: 2025, month: 12 });
    assert.deepEqual(addMonths(2026, 7, -19), { year: 2024, month: 12 });
  });
});

describe('todayString', () => {
  it('formats the local calendar day of a Date', () => {
    assert.equal(todayString(new Date(2026, 6, 22, 23, 59, 59)), '2026-07-22');
    assert.equal(todayString(new Date(2026, 0, 2, 0, 0, 1)), '2026-01-02');
  });
});

describe('localTimestamp', () => {
  it('formats local wall-clock time, zero-padded, no timezone suffix', () => {
    assert.equal(localTimestamp(new Date(2026, 6, 22, 9, 5, 7)), '2026-07-22T09:05:07');
  });

  it('keeps a just-after-midnight log on the local day (unlike toISOString)', () => {
    const halfPastMidnight = new Date(2026, 6, 23, 0, 30, 0);
    assert.equal(localTimestamp(halfPastMidnight).slice(0, 10), '2026-07-23');
  });
});
