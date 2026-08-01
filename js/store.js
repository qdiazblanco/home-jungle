// App state: loads the data (freshness rules below), exposes a snapshot
// with pending queue ops overlaid, and turns user actions into ops.
//
// Read path:
// - Gardener online → GET both files from the contents API (content+sha in
//   one response — the only sha-safe write base) and refresh the mirror.
// - Visitor → fetch Pages JSON relative with {cache:'no-cache'} (Pages sends
//   max-age=600; the ETag makes this a cheap 304). Saved to the mirror as
//   display data (sha: null — never a write base).
// - Offline / API down → localStorage mirror, which is at least as fresh as
//   anything Pages could serve.
//
// Rendering: views read getSnapshot(), which is mirror data + queued ops +
// in-grace ops (the 5 s undo window) applied via pure applyOps — so a tap
// flips the UI instantly and double-logging is structurally impossible.

import * as gh from './github.js';
import { applyOps } from '../shared/ops.js';
import { validateData } from '../shared/validate.js';
import { todayString, localTimestamp } from '../shared/dates.js';
import { seasonForDay } from '../shared/season.js';
import { getSettings, isGardener, onSettingsChange } from './settings.js';
import { snackbar } from './ui.js';
import { ensureAuthor } from './components/author-gate.js';

export const DEFAULT_HOUSE = { grid: { w: 24, h: 16 }, rooms: [] };

const state = {
  phase: 'loading', // 'loading' | 'ready' | 'error'
  plants: [],
  events: [],
  house: DEFAULT_HOUSE,
  errors: [],
  issues: [],
  source: null, // 'api' | 'pages' | 'mirror'
  loadError: null,
};

const graceOps = []; // ops inside their undo window (not yet queued, in-memory)
const listeners = new Set();
let snapshotCache = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  snapshotCache = null;
  for (const fn of listeners) fn();
}

export function getState() {
  return state;
}

/** Current data with pending + in-grace ops applied. */
export function getSnapshot() {
  if (!snapshotCache) {
    const queued = gh.pendingOps().filter((e) => !e.parked).map((e) => e.op);
    const data = applyOps(
      { plants: state.plants, events: state.events, house: state.house },
      [...queued, ...graceOps.map((g) => g.op)],
    );
    snapshotCache = {
      plants: data.plants,
      events: data.events,
      house: data.house ?? DEFAULT_HOUSE,
      plantsById: new Map(data.plants.map((p) => [p.id, p])),
    };
  }
  return snapshotCache;
}

/**
 * Plant ids with an op currently pending or in grace (for inert buttons).
 * Pass an event type ('watering', 'check', …) to match only pending events
 * of that type — so a "still moist" tap doesn't make the water button ✓.
 */
export function pendingPlantIds(eventType = null) {
  const ids = new Set();
  const collect = (op) => {
    if (op.type === 'appendEvents') {
      op.events.forEach((e) => {
        if (!eventType || e.type === eventType) ids.add(e.plantId);
      });
    }
    if (!eventType) {
      if (op.type === 'patchPlant') ids.add(op.plantId);
      if (op.type === 'createPlant') ids.add(op.plant.id);
    }
  };
  gh.pendingOps().filter((e) => !e.parked).forEach((e) => collect(e.op));
  graceOps.forEach((g) => collect(g.op));
  return ids;
}

export function today() {
  return todayString();
}

/** Season honoring the Settings override (intervals only — see shared/season.js). */
export function currentSeason() {
  const { seasonOverride } = getSettings();
  return seasonForDay(todayString(), seasonOverride === 'auto' ? null : seasonOverride);
}

/**
 * Schedule mode for wateringStatus/getWarnings. A manual season override is
 * an explicit "treat it as summer/winter" — it wins over blending.
 */
export function scheduleMode() {
  const { seasonMode, seasonOverride } = getSettings();
  return seasonMode === 'blended' && (seasonOverride ?? 'auto') === 'auto' ? 'blended' : 'binary';
}

/* ---------------- load ---------------- */

async function fetchPagesFile(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Fetching ${path} failed with HTTP ${res.status}`);
  return res.text();
}

function normalizeHouse(house) {
  if (!house || typeof house !== 'object' || !Array.isArray(house.rooms)) return DEFAULT_HOUSE;
  return house;
}

function adopt(plants, events, source, house = undefined) {
  const { errors, issues } = validateData(plants, events, { today: todayString() });
  if (errors.length) {
    state.phase = 'error';
    state.errors = errors;
    state.issues = issues;
    state.source = source;
  } else {
    state.phase = 'ready';
    state.plants = plants;
    state.events = events;
    if (house !== undefined) state.house = normalizeHouse(house);
    state.errors = [];
    state.issues = issues;
    state.source = source;
  }
  notify();
}

function parseOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function load() {
  state.phase = 'loading';
  state.loadError = null;
  notify();

  // 1) Gardener online: the API is the source of truth (and write base).
  if (isGardener() && navigator.onLine) {
    try {
      const [plantsFile, eventsFile, houseFile] = await Promise.all([
        gh.getFile(gh.PLANTS_PATH),
        gh.getFile(gh.EVENTS_PATH),
        gh.getFile(gh.HOUSE_PATH).catch(() => null), // optional file
      ]);
      const plants = plantsFile ? parseOrNull(plantsFile.text) : [];
      const events = eventsFile ? parseOrNull(eventsFile.text) : [];
      const house = houseFile ? parseOrNull(houseFile.text) : null;
      if (Array.isArray(plants) && Array.isArray(events)) {
        gh.updateMirror(gh.PLANTS_PATH, plants, plantsFile?.sha ?? null);
        gh.updateMirror(gh.EVENTS_PATH, events, eventsFile?.sha ?? null);
        // Mirror only a valid shape: a broken upstream file must NOT be
        // paired with its real sha, or writeBase would silently overwrite
        // it instead of refusing (display still degrades via normalizeHouse).
        const houseValid =
          house && typeof house === 'object' && !Array.isArray(house) && Array.isArray(house.rooms);
        if (houseFile && houseValid) gh.updateMirror(gh.HOUSE_PATH, house, houseFile.sha ?? null);
        adopt(plants, events, 'api', house);
        gh.scheduleFlush(500); // drain anything queued from a previous session
        return;
      }
      adopt(plants ?? {}, events ?? {}, 'api'); // let validateData explain
      return;
    } catch (err) {
      state.loadError = err.message;
      // fall through to mirror/Pages
    }
  }

  // 2) Mirror (offline, or API unreachable). At least as fresh as Pages.
  const mirrorPlants = gh.mirrorEntry(gh.PLANTS_PATH);
  const mirrorEvents = gh.mirrorEntry(gh.EVENTS_PATH);
  if (isGardener() && mirrorPlants && mirrorEvents) {
    adopt(mirrorPlants.data, mirrorEvents.data, 'mirror', gh.mirrorEntry(gh.HOUSE_PATH)?.data);
    return;
  }

  // 3) Pages JSON (visitor path, or first gardener run with API trouble).
  try {
    const [plantsText, eventsText, houseText] = await Promise.all([
      fetchPagesFile('data/plants.json'),
      fetchPagesFile('data/events.json'),
      fetchPagesFile('data/house.json').catch(() => null), // optional file
    ]);
    const plants = parseOrNull(plantsText);
    const events = parseOrNull(eventsText);
    const house = houseText ? parseOrNull(houseText) : null;
    if (plants === null || events === null) {
      state.phase = 'error';
      state.errors = [
        {
          path: plants === null ? 'data/plants.json' : 'data/events.json',
          message: 'The file is not valid JSON — probably a hand-edit typo (a missing comma or quote).',
        },
      ];
      notify();
      return;
    }
    // Visitor display cache only (sha: null → never a write base).
    if (!isGardener()) {
      gh.updateMirror(gh.PLANTS_PATH, plants, null);
      gh.updateMirror(gh.EVENTS_PATH, events, null);
      if (house) gh.updateMirror(gh.HOUSE_PATH, normalizeHouse(house), null);
    }
    adopt(plants, events, 'pages', house ?? gh.mirrorEntry(gh.HOUSE_PATH)?.data);
  } catch (err) {
    if (mirrorPlants && mirrorEvents) {
      adopt(mirrorPlants.data, mirrorEvents.data, 'mirror', gh.mirrorEntry(gh.HOUSE_PATH)?.data);
      return;
    }
    state.phase = 'error';
    state.loadError = err.message;
    state.errors = [
      {
        path: 'data/*.json',
        message: `Could not load the plant data (${err.message}). Are you offline on a first visit?`,
      },
    ];
    notify();
  }
}

/* ---------------- actions (gardener mode) ---------------- */

function requireAuthor() {
  return getSettings().author || null;
}

function makeEvent(plantId, type, { note = null, date = null, src = null } = {}) {
  const when =
    date && date !== todayString() ? `${date}T12:00:00` : localTimestamp();
  return {
    id: crypto.randomUUID(),
    plantId,
    type,
    date: when,
    author: requireAuthor() ?? 'Unknown',
    note: note || null,
    // Only photo events carry a file reference; absent otherwise.
    ...(src ? { src } : {}),
  };
}

/**
 * Stage an op behind the 5 s undo snackbar; it only enters the persistent
 * queue when the window elapses. Used by one-tap actions.
 */
function stageWithUndo(op, message) {
  const grace = { gid: crypto.randomUUID(), op };
  graceOps.push(grace);
  notify();
  const commit = () => {
    const index = graceOps.indexOf(grace);
    if (index !== -1) {
      graceOps.splice(index, 1);
      gh.enqueue(op);
      notify();
    }
  };
  snackbar({
    message,
    actionLabel: 'Undo',
    duration: 5000,
    onTimeout: commit,
    onAction: () => {
      const index = graceOps.indexOf(grace);
      if (index !== -1) {
        graceOps.splice(index, 1);
        notify();
      }
    },
  });
  return grace.gid;
}

/** Flush grace ops immediately (e.g. page is being hidden mid-window). */
export function commitGraceOpsNow() {
  while (graceOps.length) {
    const grace = graceOps.shift();
    gh.enqueue(grace.op);
  }
  notify();
}

/**
 * One-tap (or multi-select) logging with the undo grace window —
 * one op, one commit. Used for water/feed quick actions.
 * Prompts for the author once on a fresh device (events + commits carry it).
 */
export async function quickLog(plantIds, type = 'watering', { note = null, date = null } = {}) {
  if (!(await ensureAuthor())) return;
  const snapshot = getSnapshot();
  const events = plantIds.map((id) => makeEvent(id, type, { note, date }));
  const names = plantIds.map((id) => snapshot.plantsById.get(id)?.name ?? id);
  const label = names.length > 2 ? `${names.length} plants` : names.join(' & ');
  const message =
    type === 'watering'
      ? `Watered ${label}`
      : type === 'feeding'
        ? `Fed ${label}`
        : type === 'check'
          ? `Still moist — snoozed ${label}`
          : `Logged ${label}`;
  stageWithUndo({ type: 'appendEvents', events }, message);
}

/** Log any event type from the dialog (explicitly confirmed — no grace).
 * `src` (photo events) must reference an ALREADY-uploaded file — the queue
 * carries JSON only, never image data. */
export function logEvent(plantId, type, { note = null, date = null, src = null } = {}) {
  gh.enqueue({ type: 'appendEvents', events: [makeEvent(plantId, type, { note, date, src })] });
  notify();
}

export function patchPlant(plantId, changes, removals = []) {
  gh.enqueue({ type: 'patchPlant', plantId, changes, removals });
  notify();
}

export function createPlant(plant) {
  gh.enqueue({ type: 'createPlant', plant });
  notify();
}

export function removeEvent(eventId) {
  gh.enqueue({ type: 'removeEvent', id: eventId });
  notify();
}

/** Fix a logged event in place (author, date, note). */
export function updateEvent(eventId, changes) {
  gh.enqueue({ type: 'updateEvent', id: eventId, changes });
  notify();
}

/** Replace the floor plan (blueprint editor). */
export function setHouse(house) {
  gh.enqueue({ type: 'setHouse', house });
  notify();
}

export function dismissIssues() {
  state.issues = [];
  notify();
}

/* ---------------- wiring ---------------- */

// After a flush the queue drains but state.plants/events still pre-date the
// write — adopt the mirror (updated from the PUT/GET responses) so the
// snapshot never moves backwards. This also surfaces the other gardener's
// edits when a conflict-refetch pulled them in.
function adoptMirror() {
  if (!isGardener() || state.phase !== 'ready') return;
  const plants = gh.mirrorEntry(gh.PLANTS_PATH);
  const events = gh.mirrorEntry(gh.EVENTS_PATH);
  if (plants && events) {
    state.plants = plants.data;
    state.events = events.data;
    const house = gh.mirrorEntry(gh.HOUSE_PATH);
    if (house) state.house = normalizeHouse(house.data);
  }
}

gh.onSyncChange(() => {
  adoptMirror();
  notify();
});
onSettingsChange(() => notify());

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') commitGraceOpsNow();
  });
}
