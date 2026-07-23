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
