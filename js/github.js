// GitHub Contents API layer + sync engine.
//
// Invariants (hard-won, see the README's architecture notes):
// - A {content, sha} pair used as a write base always comes from ONE API
//   response (or from the mirror, whose sha came from a PUT/GET response).
//   Pages-served JSON is display-only and never a write base.
// - Ops replay idempotently: event ids are minted at enqueue, appendEvents
//   dedups against fresh data, so "PUT landed but the response was lost"
//   resolves itself through the conflict path instead of duplicating.
// - Bookkeeping order after a successful PUT: update mirror, then dequeue.
// - One canonical serializer (fixed key order, 2-space indent, trailing
//   newline) so git diffs stay clean and no-op writes are detectable.

import { getSettings, isGardener, repoCoords } from './settings.js';
import { applyOp, fileForOp, describeOp } from '../shared/ops.js';
import { localTimestamp } from '../shared/dates.js';

const API = 'https://api.github.com';
export const PLANTS_PATH = 'data/plants.json';
export const EVENTS_PATH = 'data/events.json';
export const HOUSE_PATH = 'data/house.json';

const QUEUE_KEY = 'digital-garden:queue';
const MIRROR_KEY = 'digital-garden:mirror';

/* ================= canonical serialization ================= */

const PLANT_KEY_ORDER = [
  'id', 'name', 'species', 'nickname', 'location', 'pot', 'photo', 'icon',
  'acquired', 'parent', 'care', 'general_notes', 'status',
];
const LOCATION_KEY_ORDER = ['room', 'orientation', 'detail'];
const CARE_PARAM_ORDER = [
  'source', 'light', 'sun_need', 'watering_days_summer', 'watering_days_winter',
  'humidity', 'feeding', 'feeding_summer', 'feeding_winter', 'substrate_recipe',
  'toxic_to_pets',
];
const EVENT_KEY_ORDER = ['id', 'plantId', 'type', 'date', 'author', 'note', 'src'];
const ROOM_KEY_ORDER = ['id', 'name', 'x', 'y', 'w', 'h'];
const FURNITURE_KEY_ORDER = ['id', 'roomId', 'kind', 'x', 'y', 'w', 'h'];

function orderKeys(obj, preferred) {
  const out = {};
  for (const key of preferred) {
    if (Object.hasOwn(obj, key)) out[key] = obj[key];
  }
  for (const key of Object.keys(obj).sort()) {
    if (!Object.hasOwn(out, key)) out[key] = obj[key];
  }
  return out;
}

function orderCareLayer(layer) {
  if (!layer || typeof layer !== 'object') return layer;
  const out = {};
  const place = (key) => {
    if (Object.hasOwn(layer, key)) out[key] = layer[key];
    if (Object.hasOwn(layer, `${key}_note`)) out[`${key}_note`] = layer[`${key}_note`];
  };
  for (const key of CARE_PARAM_ORDER) place(key);
  for (const key of Object.keys(layer).sort()) {
    if (!Object.hasOwn(out, key)) place(key.endsWith('_note') ? key.slice(0, -5) : key);
  }
  return out;
}

function canonicalPlant(plant) {
  const out = orderKeys(plant, PLANT_KEY_ORDER);
  if (out.location && typeof out.location === 'object') {
    out.location = orderKeys(out.location, LOCATION_KEY_ORDER);
  }
  if (out.care && typeof out.care === 'object') {
    out.care = {
      reference: orderCareLayer(out.care.reference ?? {}),
      observed: orderCareLayer(out.care.observed ?? {}),
    };
  }
  return out;
}

export function serializeFile(path, data) {
  let canonical;
  if (path === PLANTS_PATH) {
    canonical = data.map(canonicalPlant);
  } else if (path === HOUSE_PATH) {
    // Preserve unknown keys (hand-edits) like the other serializers do.
    canonical = orderKeys(data ?? {}, ['grid', 'rooms', 'furniture', 'placements']);
    canonical.grid = orderKeys({ w: 24, h: 16, ...(data?.grid ?? {}) }, ['w', 'h']);
    canonical.rooms = (data?.rooms ?? []).map((room) => orderKeys(room, ROOM_KEY_ORDER));
    canonical.furniture = (Array.isArray(data?.furniture) ? data.furniture : [])
      .filter((piece) => piece && typeof piece === 'object')
      .map((piece) => orderKeys(piece, FURNITURE_KEY_ORDER));
    canonical.placements = orderKeys(
      data?.placements && typeof data.placements === 'object' ? data.placements : {},
      [],
    );
  } else {
    canonical = data.map((ev) => orderKeys(ev, EVENT_KEY_ORDER));
  }
  return JSON.stringify(canonical, null, 2) + '\n';
}

/* ================= UTF-8-safe base64 ================= */

export function encodeContent(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeContent(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** Base64 for raw bytes (photo uploads) — chunked like encodeContent. */
export function encodeBytes(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/* ================= API client & error taxonomy ================= */

export class ApiError extends Error {
  /** kind: 'auth' | 'rate-limit' | 'not-found' | 'conflict' | 'validation' | 'network' | 'server' | 'config' */
  constructor(kind, message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

async function classifyResponse(res) {
  let bodyMessage = '';
  try {
    bodyMessage = (await res.clone().json())?.message ?? '';
  } catch {
    /* non-JSON body */
  }
  const status = res.status;
  const retryAfterMs =
    Number(res.headers.get('retry-after') ?? 0) * 1000 ||
    Math.max(0, Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000 - Date.now());

  if (status === 401) return new ApiError('auth', 'Token rejected (expired or revoked).', { status });
  if (status === 403 || status === 429) {
    if (retryAfterMs || res.headers.get('x-ratelimit-remaining') === '0') {
      return new ApiError('rate-limit', 'GitHub rate limit hit.', { status, retryAfterMs });
    }
    return new ApiError('auth', `GitHub refused the request: ${bodyMessage}`, { status });
  }
  if (status === 404) return new ApiError('not-found', 'Not found (repo, path, or token access).', { status });
  if (status === 409) return new ApiError('conflict', 'File changed upstream (sha mismatch).', { status });
  if (status === 422) {
    return /sha/i.test(bodyMessage)
      ? new ApiError('conflict', bodyMessage, { status })
      : new ApiError('validation', `GitHub rejected the payload: ${bodyMessage}`, { status });
  }
  if (status >= 500) return new ApiError('server', `GitHub server error (${status}).`, { status });
  return new ApiError('validation', `Unexpected response ${status}: ${bodyMessage}`, { status });
}

async function apiFetch(path, { method = 'GET', accept, body, token: tokenOverride } = {}) {
  const token = tokenOverride ?? getSettings().token;
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Accept: accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 'Network request failed.');
  }
  if (!res.ok) throw await classifyResponse(res);
  return res;
}

function coordsOrThrow() {
  const coords = repoCoords();
  if (!coords) {
    throw new ApiError('config', 'Repository not configured — set owner/repo in Settings.');
  }
  return coords;
}

/** GET a data file: { text, sha } | null when the file does not exist yet. */
export async function getFile(path) {
  const { owner, repo, branch } = coordsOrThrow();
  const url = `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  let res;
  try {
    res = await apiFetch(url);
  } catch (err) {
    if (err.kind === 'not-found') return null;
    throw err;
  }
  const json = await res.json();
  if (json.encoding === 'base64' && typeof json.content === 'string' && json.content !== '') {
    return { text: decodeContent(json.content), sha: json.sha };
  }
  // Files past the inline-content ceiling (~1 MB): fetch raw, keep the sha
  // from the metadata response. Refusing to guess here is what protects
  // events.json history from a merge-onto-empty wipe.
  if (json.sha) {
    const raw = await apiFetch(url, { accept: 'application/vnd.github.raw+json' });
    return { text: await raw.text(), sha: json.sha };
  }
  throw new ApiError('validation', `Unexpected contents response for ${path}.`);
}

function commitAuthor() {
  const { author } = getSettings();
  return author
    ? { name: author, email: `${author.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@home-jungle.local` }
    : undefined;
}

/** PUT a data file; returns the new content sha from the response. */
export async function putFile(path, text, sha, message) {
  const { owner, repo, branch } = coordsOrThrow();
  const gitAuthor = commitAuthor();
  const res = await apiFetch(`/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: {
      message,
      content: encodeContent(text),
      branch,
      ...(sha ? { sha } : {}),
      ...(gitAuthor ? { author: gitAuthor } : {}),
    },
  });
  const json = await res.json();
  return { sha: json.content?.sha };
}

/**
 * Create-only binary PUT for photo files. No sha handling on purpose:
 * photos are append-only under unique paths, so an existing file surfaces
 * as a conflict error and the caller picks the next filename. Never queued —
 * the ops queue stays JSON-only.
 */
export async function putBinaryFile(path, buffer, message) {
  const { owner, repo, branch } = coordsOrThrow();
  const gitAuthor = commitAuthor();
  const res = await apiFetch(`/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: {
      message,
      content: encodeBytes(buffer),
      branch,
      ...(gitAuthor ? { author: gitAuthor } : {}),
    },
  });
  const json = await res.json();
  return { sha: json.content?.sha };
}

/** Git blob sha ("blob <len>\0" + bytes, SHA-1) of raw bytes. */
async function gitBlobSha(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Contents-API sha of a path, or null when it does not exist. */
async function getFileSha(path) {
  const { owner, repo, branch } = coordsOrThrow();
  try {
    const res = await apiFetch(
      `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    );
    return (await res.json()).sha ?? null;
  } catch (err) {
    if (err.kind === 'not-found') return null;
    throw err;
  }
}

/**
 * putBinaryFile that resolves the lost-response case (the photo analogue of
 * the data files' idempotent replay): on a conflict, if the existing file
 * already holds these exact bytes the earlier PUT landed and this is a
 * retry — report success instead of letting the caller duplicate the blob
 * under a bumped filename. Returns { existed } so callers can tell.
 */
export async function putBinaryFileIfAbsent(path, buffer, message) {
  try {
    await putBinaryFile(path, buffer, message);
    return { existed: false };
  } catch (err) {
    if (err.kind !== 'conflict') throw err;
    const remoteSha = await getFileSha(path);
    if (remoteSha && remoteSha === (await gitBlobSha(buffer))) return { existed: true };
    throw err; // genuinely different file (the other phone) — caller bumps
  }
}

/**
 * Cheap authenticated probe used by Settings to validate a token.
 * Pass { token } to probe a CANDIDATE token before it is saved — a bad
 * token must never be stored, not even briefly.
 */
export async function probeRepo({ token } = {}) {
  const { owner, repo } = coordsOrThrow();
  const res = await apiFetch(`/repos/${owner}/${repo}`, { token });
  const json = await res.json();
  return { fullName: json.full_name, permissions: json.permissions ?? null };
}

/* ================= mirror ================= */

function readMirror() {
  try {
    return JSON.parse(localStorage.getItem(MIRROR_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeMirror(mirror) {
  localStorage.setItem(MIRROR_KEY, JSON.stringify(mirror));
}

/** { data, sha, savedAt } for a file, or null. */
export function mirrorEntry(path) {
  return readMirror()[path] ?? null;
}

export function updateMirror(path, data, sha) {
  const mirror = readMirror();
  mirror[path] = { data, sha: sha ?? null, savedAt: localTimestamp() };
  writeMirror(mirror);
}

function invalidateMirrorSha(path) {
  const mirror = readMirror();
  if (mirror[path]) {
    mirror[path].sha = null;
    writeMirror(mirror);
  }
}

/* ================= op queue ================= */

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/* ================= sync engine ================= */

const listeners = new Set();

const engineState = {
  flushing: false,
  paused: false, // true after an auth failure until the token changes
  lastError: null, // { kind, message }
  lastSyncAt: null,
  retryTimer: null,
};

function notify() {
  const status = getStatus();
  for (const fn of listeners) fn(status);
}

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pendingOps() {
  return readQueue();
}

/**
 * Sync status for the chip:
 * { state: 'idle'|'saving'|'offline'|'auth'|'error', pending, parked, message, lastSyncAt }
 */
export function getStatus() {
  const queue = readQueue();
  const parked = queue.filter((e) => e.parked);
  const active = queue.length - parked.length;
  let state = 'idle';
  if (engineState.paused) state = 'auth';
  else if (engineState.flushing) state = 'saving';
  else if (queue.length && !navigator.onLine) state = 'offline';
  else if (parked.length || engineState.lastError) state = 'error';
  else if (active) state = 'saving';
  return {
    state,
    pending: active,
    parked: parked.length,
    message: engineState.lastError?.message ?? null,
    kind: engineState.lastError?.kind ?? null,
    lastSyncAt: engineState.lastSyncAt,
  };
}

/** Queue an op (gardener mode only — a hard chokepoint, not just hidden UI). */
export function enqueue(op) {
  if (!isGardener()) {
    console.warn('Ignored write attempt without a token (visitor mode).');
    return false;
  }
  const queue = readQueue();
  queue.push({
    qid: crypto.randomUUID(),
    op,
    createdAt: localTimestamp(),
    attempts: 0,
    parked: false,
    lastError: null,
  });
  writeQueue(queue);
  notify();
  scheduleFlush(0);
  return true;
}

export function discardOp(qid) {
  writeQueue(readQueue().filter((e) => e.qid !== qid));
  if (!readQueue().some((e) => !e.parked)) engineState.lastError = null;
  notify();
}

export function clearQueue() {
  writeQueue([]);
  engineState.lastError = null;
  notify();
}

/** Resume after the user fixed their token. */
export function resumeAfterAuthFix() {
  engineState.paused = false;
  engineState.lastError = null;
  notify();
  scheduleFlush(0);
}

let flushTimer = null;

export function scheduleFlush(delayMs = 0) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, delayMs);
}

async function withFlushLock(fn) {
  if (navigator.locks?.request) {
    return navigator.locks.request('digital-garden:flush', { ifAvailable: true }, async (lock) => {
      if (!lock) return; // another tab/PWA context is flushing
      await fn();
    });
  }
  // Fallback: timestamp lock in localStorage.
  const LOCK_KEY = 'digital-garden:flush-lock';
  const now = Date.now();
  const held = Number(localStorage.getItem(LOCK_KEY) ?? 0);
  if (held && now - held < 20000) return;
  localStorage.setItem(LOCK_KEY, String(now));
  try {
    await fn();
  } finally {
    localStorage.removeItem(LOCK_KEY);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function flush() {
  if (!isGardener() || engineState.paused || engineState.flushing) return;
  if (!navigator.onLine) {
    notify();
    return;
  }
  engineState.flushing = true;
  notify();
  try {
    await withFlushLock(async () => {
      let batches = 0;
      for (;;) {
        const queue = readQueue().filter((e) => !e.parked);
        if (!queue.length) break;
        const path = fileForOp(queue[0].op);
        const batch = queue.filter((e) => fileForOp(e.op) === path);
        if (batches > 0) await sleep(1100); // ≥1s between commits (secondary limits)
        await flushBatch(path, batch);
        batches += 1;
      }
      // Keep the parked-op explanation visible until every parked entry is
      // resolved — a successful flush of the REST of the queue must not
      // silently blank the error banner.
      if (!readQueue().some((e) => e.parked)) engineState.lastError = null;
      if (batches) engineState.lastSyncAt = localTimestamp();
    });
  } catch (err) {
    handleFlushError(err);
  } finally {
    engineState.flushing = false;
    notify();
    // Cross-context race: an op enqueued by the other tab/PWA context while
    // we held the lock (its own ifAvailable flush bailed) would otherwise
    // wait for the next wakeup. Cheap self-check covers it.
    if (!engineState.paused && !engineState.lastError && readQueue().some((e) => !e.parked)) {
      scheduleFlush(1000);
    }
  }
}

/** Write base for a path: mirror when it has a sha, else a fresh API GET. */
async function writeBase(path) {
  const entry = mirrorEntry(path);
  if (entry?.sha) return { data: entry.data, sha: entry.sha };
  const fetched = await getFile(path);
  if (!fetched) return { data: path === HOUSE_PATH ? { grid: { w: 24, h: 16 }, rooms: [] } : [], sha: null };
  let data;
  try {
    data = JSON.parse(fetched.text);
  } catch {
    throw new ApiError('validation', `${path} on GitHub is not valid JSON — fix it before syncing.`);
  }
  const shapeOk =
    path === HOUSE_PATH
      ? data !== null && typeof data === 'object' && !Array.isArray(data)
      : Array.isArray(data);
  if (!shapeOk) {
    throw new ApiError('validation', `${path} on GitHub has the wrong shape — refusing to overwrite it.`);
  }
  updateMirror(path, data, fetched.sha);
  return { data, sha: fetched.sha };
}

function applyBatch(path, baseData, batch) {
  let combined = {
    plants: path === PLANTS_PATH ? baseData : mirrorEntry(PLANTS_PATH)?.data ?? [],
    events: path === EVENTS_PATH ? baseData : mirrorEntry(EVENTS_PATH)?.data ?? [],
    house: path === HOUSE_PATH ? baseData : mirrorEntry(HOUSE_PATH)?.data ?? null,
  };
  for (const entry of batch) combined = applyOp(combined, entry.op);
  if (path === PLANTS_PATH) return combined.plants;
  if (path === HOUSE_PATH) return combined.house;
  return combined.events;
}

async function flushBatch(path, batch) {
  for (let attempt = 0; ; attempt++) {
    const base = await writeBase(path);
    const before = serializeFile(path, base.data);
    const after = serializeFile(path, applyBatch(path, base.data, batch));

    if (after === before && base.sha) {
      // Everything in this batch is already upstream (lost-response replay).
      finishBatch(path, base.data, base.sha, batch);
      return;
    }

    try {
      const { sha } = await putFile(path, after, base.sha, commitMessage(batch));
      finishBatch(path, JSON.parse(after), sha, batch);
      return;
    } catch (err) {
      if (err.kind === 'conflict' && attempt < 3) {
        invalidateMirrorSha(path); // force a fresh API GET next round
        await sleep(300 + Math.random() * 700);
        continue;
      }
      if (err.kind === 'validation' && batch.length > 1) {
        // Isolate the poison op instead of blocking the whole queue.
        for (const entry of batch) await flushBatch(path, [entry]);
        return;
      }
      if (err.kind === 'validation') {
        parkEntry(batch[0], err);
        return;
      }
      bumpAttempts(batch, err);
      throw err;
    }
  }
}

/** Mirror first, then dequeue — a crash between the two replays as a no-op. */
function finishBatch(path, data, sha, batch) {
  updateMirror(path, data, sha);
  const done = new Set(batch.map((e) => e.qid));
  writeQueue(readQueue().filter((e) => !done.has(e.qid)));
  notify();
}

function parkEntry(entry, err) {
  const queue = readQueue();
  const found = queue.find((e) => e.qid === entry.qid);
  if (found) {
    found.parked = true;
    found.lastError = err.message;
    writeQueue(queue);
  }
  engineState.lastError = { kind: 'validation', message: 'A change could not be saved — review it in the sync panel.' };
  notify();
}

function bumpAttempts(batch, err) {
  const ids = new Set(batch.map((e) => e.qid));
  const queue = readQueue();
  for (const entry of queue) {
    if (ids.has(entry.qid)) {
      entry.attempts += 1;
      entry.lastError = err.message;
    }
  }
  writeQueue(queue);
}

function handleFlushError(err) {
  const kind = err.kind ?? 'validation';
  if (kind === 'auth') {
    engineState.paused = true;
    engineState.lastError = { kind, message: 'GitHub token expired or revoked — fix it in Settings.' };
    return;
  }
  if (kind === 'rate-limit') {
    engineState.lastError = { kind, message: 'GitHub rate limit — retrying automatically.' };
    scheduleFlush(Math.max(err.retryAfterMs, 60_000));
    return;
  }
  if (kind === 'network' || kind === 'server') {
    engineState.lastError = { kind, message: 'Could not reach GitHub — will retry.' };
    scheduleFlush(30_000);
    return;
  }
  if (kind === 'not-found' || kind === 'config') {
    engineState.lastError = {
      kind: 'config',
      message: 'Repository not reachable — check owner/repo and token access in Settings.',
    };
    return;
  }
  engineState.lastError = { kind, message: err.message };
}

/* ================= commit messages ================= */

const TYPE_VERBS = {
  watering: 'water',
  check: 'still moist',
  feeding: 'feed',
  misting: 'mist',
  pruning: 'prune',
  repotting: 'repot',
  treatment: 'treat',
  cutting: 'cutting',
  note: 'note',
  photo: 'photo',
};

function commitMessage(batch) {
  const { author } = getSettings();
  const suffix = author ? ` (${author})` : '';
  const plants = mirrorEntry(PLANTS_PATH)?.data ?? [];
  const byId = new Map(plants.map((p) => [p.id, p]));
  const nameOf = (id) => byId.get(id)?.name ?? id;

  let subject;
  if (batch.length === 1) {
    const op = batch[0].op;
    if (op.type === 'appendEvents') {
      const types = [...new Set(op.events.map((e) => e.type))];
      const names = [...new Set(op.events.map((e) => nameOf(e.plantId)))];
      const list = names.length > 3 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
      subject = types.length === 1 ? `${TYPE_VERBS[types[0]] ?? 'log'}: ${list}` : `log: ${list}`;
    } else if (op.type === 'createPlant') {
      subject = `plant: add ${op.plant.name}`;
    } else if (op.type === 'patchPlant') {
      subject = `plant: edit ${nameOf(op.plantId)}`;
    } else if (op.type === 'removeEvent') {
      subject = 'log: remove an entry';
    } else if (op.type === 'updateEvent') {
      subject = 'log: edit an entry';
    } else if (op.type === 'setHouse') {
      subject = 'house: update the floor plan';
    } else {
      subject = describeOp(op, byId);
    }
  } else {
    subject = `sync: ${batch.length} queued changes`;
  }

  subject += suffix;
  return subject.length <= 72 ? subject : `${subject.slice(0, 69)}…`;
}

/* ================= wakeups ================= */

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => scheduleFlush(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleFlush(1000);
  });
  window.addEventListener('storage', (e) => {
    if (e.key === QUEUE_KEY) notify(); // another tab changed the queue
  });
  window.addEventListener('offline', notify);
}
