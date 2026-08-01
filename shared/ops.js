// Operation model for the write path.
//
// User actions are stored as OPERATIONS, never as file snapshots. On a sha
// conflict the flusher refetches fresh data and re-applies the operation,
// which makes the "refetch + merge + retry" contract actually merge:
// - appendEvents / removeEvent are idempotent set operations;
// - patchPlant carries a field-level diff (dot paths), so re-applying a
//   stale queue onto fresh data preserves every field the other gardener
//   touched — a whole-plant snapshot would silently clobber them.
//
// applyOp returns the SAME data object when an op changes nothing, so the
// flusher can detect "already applied upstream" (e.g. a PUT that succeeded
// but whose response was lost) and dequeue without committing a duplicate.
//
// Pure module: also unit-tested in Node; usable by a future Action.

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Set a dot-path ("care.observed.watering_days_summer"), creating objects. */
export function deepSet(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(node[parts[i]])) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

/** Delete a dot-path if present; empty parent objects are left in place. */
export function deepDelete(obj, path) {
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(node[parts[i]])) return;
    node = node[parts[i]];
  }
  delete node[parts[parts.length - 1]];
}

/**
 * Field-level diff of an edited plant against the base version the UI was
 * showing: { changes: { "dot.path": value }, removals: ["dot.path"] }.
 * Plain objects recurse; arrays and primitives are leaves (whole-value
 * replacement, matching the effective-care contract). `id` is immutable and
 * never diffed.
 */
export function diffPlant(base, edited) {
  const changes = {};
  const removals = [];

  (function walk(b, e, path) {
    const keys = new Set([...Object.keys(b), ...Object.keys(e)]);
    for (const key of keys) {
      const p = path ? `${path}.${key}` : key;
      if (p === 'id') continue;
      const inBase = Object.hasOwn(b, key);
      const inEdited = Object.hasOwn(e, key);
      if (inBase && !inEdited) {
        removals.push(p);
        continue;
      }
      if (isPlainObject(b[key]) && isPlainObject(e[key])) {
        walk(b[key], e[key], p);
        continue;
      }
      if (!inBase || !deepEqual(b[key], e[key])) {
        changes[p] = e[key];
      }
    }
  })(base ?? {}, edited ?? {}, '');

  return { changes, removals };
}

/** Which data file an op targets. */
export function fileForOp(op) {
  if (op.type === 'setHouse') return 'data/house.json';
  return op.type === 'appendEvents' || op.type === 'removeEvent' || op.type === 'updateEvent'
    ? 'data/events.json'
    : 'data/plants.json';
}

/** Apply one op to { plants, events }; returns the same object if a no-op. */
export function applyOp(data, op) {
  switch (op.type) {
    case 'appendEvents': {
      const existing = new Set(data.events.map((e) => e.id));
      const fresh = op.events.filter((e) => !existing.has(e.id));
      if (!fresh.length) return data;
      return { ...data, events: [...data.events, ...fresh] };
    }
    case 'removeEvent': {
      if (!data.events.some((e) => e.id === op.id)) return data;
      return { ...data, events: data.events.filter((e) => e.id !== op.id) };
    }
    case 'setHouse': {
      // Whole-layout replacement: floor-plan edits are rare and low-conflict,
      // last-write-wins is fine. Identity return keeps replay idempotent.
      if (deepEqual(op.house, data.house)) return data;
      return { ...data, house: structuredClone(op.house) };
    }
    case 'updateEvent': {
      const index = data.events.findIndex((e) => e.id === op.id);
      if (index === -1) return data;
      const updated = { ...data.events[index], ...op.changes };
      if (deepEqual(updated, data.events[index])) return data;
      const events = [...data.events];
      events[index] = updated;
      return { ...data, events };
    }
    case 'createPlant': {
      if (data.plants.some((p) => p.id === op.plant.id)) return data;
      return { ...data, plants: [...data.plants, op.plant] };
    }
    case 'patchPlant': {
      const index = data.plants.findIndex((p) => p.id === op.plantId);
      if (index === -1) return data;
      const plant = structuredClone(data.plants[index]);
      for (const [path, value] of Object.entries(op.changes ?? {})) {
        deepSet(plant, path, structuredClone(value));
      }
      for (const path of op.removals ?? []) {
        deepDelete(plant, path);
      }
      if (deepEqual(plant, data.plants[index])) return data;
      const plants = [...data.plants];
      plants[index] = plant;
      return { ...data, plants };
    }
    default:
      return data;
  }
}

/** Apply a list of ops in order. */
export function applyOps(data, ops) {
  let result = data;
  for (const op of ops) result = applyOp(result, op);
  return result;
}

const EVENT_LABELS = {
  watering: 'watering',
  check: 'soil check',
  feeding: 'feeding',
  repotting: 'repotting',
  pruning: 'pruning',
  misting: 'misting',
  treatment: 'treatment',
  cutting: 'cutting',
  note: 'note',
  photo: 'photo',
};

/** Short human description of an op ("watering for Monstera, Pothos"). */
export function describeOp(op, plantsById = new Map()) {
  const nameOf = (id) => plantsById.get(id)?.name ?? id;
  switch (op.type) {
    case 'appendEvents': {
      const types = [...new Set(op.events.map((e) => EVENT_LABELS[e.type] ?? e.type))];
      const names = [...new Set(op.events.map((e) => nameOf(e.plantId)))];
      return `${types.join(' + ')} for ${names.join(', ')}`;
    }
    case 'removeEvent':
      return 'delete a logged event';
    case 'updateEvent':
      return 'edit a logged event';
    case 'setHouse':
      return 'update the floor plan';
    case 'createPlant':
      return `new plant "${op.plant.name}"`;
    case 'patchPlant':
      return `edit ${nameOf(op.plantId)}`;
    default:
      return op.type;
  }
}
