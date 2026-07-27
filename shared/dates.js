// Pure date helpers shared by the browser app and the Phase 2 GitHub Action.
//
// Event dates are stored as local wall-clock strings ("2026-07-22T09:30:00",
// no timezone offset). Parsing those with `new Date()` gives different
// calendar days on a Madrid phone vs a UTC Actions runner, so ALL day
// arithmetic in shared modules goes through these helpers instead: they work
// on the "YYYY-MM-DD" prefix only, diffed via Date.UTC, which is
// timezone-independent. The test suite runs under both TZ=UTC and
// TZ=Europe/Madrid to enforce this.

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

/** Calendar day ("YYYY-MM-DD") of a stored date/datetime string, or null. */
export function dayOf(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return null;
  const day = value.slice(0, 10);
  return isValidDay(day) ? day : null;
}

/** True if `day` is a real calendar date in "YYYY-MM-DD" form. */
export function isValidDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const roundTrip = new Date(ms);
  return (
    roundTrip.getUTCFullYear() === y &&
    roundTrip.getUTCMonth() === m - 1 &&
    roundTrip.getUTCDate() === d
  );
}

function utcMs(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `fromDay` to `toDay` (positive when toDay is later). */
export function daysBetween(fromDay, toDay) {
  return Math.round((utcMs(toDay) - utcMs(fromDay)) / MS_PER_DAY);
}

/** `day` shifted by `n` calendar days (n may be negative). */
export function addDays(day, n) {
  const d = new Date(utcMs(day) + n * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Month (1–12) of a day string. */
export function monthOf(day) {
  return Number(day.slice(5, 7));
}

/** Year of a day string. */
export function yearOf(day) {
  return Number(day.slice(0, 4));
}

/**
 * Calendar month grid for a year/month (1–12): an array of weeks (Monday
 * first), each week an array of 7 cells { day: "YYYY-MM-DD", inMonth }.
 * Leading/trailing cells come from the neighbouring months so every week
 * is complete. Pure UTC arithmetic — timezone-proof like everything here.
 */
export function monthGrid(year, month) {
  const first = Date.UTC(year, month - 1, 1);
  // getUTCDay: 0=Sunday … 6=Saturday → Monday-first offset
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const start = first - lead * MS_PER_DAY;
  const weeks = [];
  for (let cursor = start; ; ) {
    const week = [];
    for (let i = 0; i < 7; i++, cursor += MS_PER_DAY) {
      const d = new Date(cursor);
      week.push({
        day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        inMonth: d.getUTCMonth() === month - 1 && d.getUTCFullYear() === year,
      });
    }
    weeks.push(week);
    const next = new Date(cursor);
    if (next.getUTCMonth() !== month - 1 || next.getUTCFullYear() !== year) break;
  }
  return weeks;
}

/** { year, month } shifted by n months (month 1–12). */
export function addMonths(year, month, n) {
  const total = year * 12 + (month - 1) + n;
  return { year: Math.floor(total / 12), month: (total % 12 + 12) % 12 + 1 };
}

/**
 * The local calendar day of a Date, as "YYYY-MM-DD".
 * Callers (browser app, Action) produce `today` with this and pass it into
 * the pure modules — Date objects never cross the shared/ boundary.
 */
export function todayString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Local wall-clock timestamp for storing on events
 * ("2026-07-22T09:30:00", no offset — matches the data model).
 * Never use toISOString() for this: it shifts the calendar day near midnight.
 */
export function localTimestamp(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
