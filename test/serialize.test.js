// Canonical-serializer regression net: the checked-in data files must
// round-trip byte-identically (a drifting serializer means every in-app
// commit starts with a whole-file reformat), and the house serializer must
// preserve hand-added unknown keys like the plants/events ones do.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// js/github.js touches localStorage only inside functions, but stub it so
// accidental top-level use would fail loudly here rather than in a browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let gh;
before(async () => {
  gh = await import('../js/github.js');
});

describe('canonical serializer', () => {
  for (const path of ['data/plants.json', 'data/events.json', 'data/house.json']) {
    it(`round-trips ${path} byte-identically`, async () => {
      const text = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
      assert.equal(gh.serializeFile(path, JSON.parse(text)), text);
    });
  }

  it('preserves unknown keys in house.json (hand-edit friendliness)', () => {
    const house = {
      grid: { w: 24, h: 16, note: 'custom' },
      rooms: [{ id: 'a', name: 'A', x: 0, y: 0, w: 5, h: 5, floor: 'tiles' }],
      furniture: [{ id: 'f1', roomId: 'a', kind: 'table', x: 1, y: 1, w: 3, h: 2, wood: 'oak' }],
      placements: { 'some-plant': 'f1' },
      spots: { 'floor-plant': [2.5, 3] },
      architect: 'Pepa',
    };
    const parsed = JSON.parse(gh.serializeFile('data/house.json', house));
    assert.equal(parsed.grid.note, 'custom');
    assert.equal(parsed.rooms[0].floor, 'tiles');
    assert.equal(parsed.furniture[0].wood, 'oak');
    assert.equal(parsed.placements['some-plant'], 'f1');
    assert.deepEqual(parsed.spots['floor-plant'], [2.5, 3]);
    assert.equal(parsed.architect, 'Pepa');
  });

  it('orders src after note on photo events', () => {
    const event = {
      src: 'img/plants/monstera/2026-07-31-1.jpg',
      note: 'new leaf',
      author: 'Kike',
      date: '2026-07-31T10:00:00',
      type: 'photo',
      plantId: 'monstera',
      id: 'ev-photo',
    };
    const parsed = JSON.parse(gh.serializeFile('data/events.json', [event]));
    assert.deepEqual(Object.keys(parsed[0]), ['id', 'plantId', 'type', 'date', 'author', 'note', 'src']);
  });

  it('encodes raw bytes to base64 (photo uploads)', () => {
    const bytes = new Uint8Array([0, 1, 254, 255, 104, 105]);
    assert.equal(gh.encodeBytes(bytes.buffer), Buffer.from(bytes).toString('base64'));
  });

  it('defaults missing furniture/placements/spots to empty containers', () => {
    const parsed = JSON.parse(
      gh.serializeFile('data/house.json', { grid: { w: 10, h: 10 }, rooms: [] }),
    );
    assert.deepEqual(parsed.furniture, []);
    assert.deepEqual(parsed.placements, {});
    assert.deepEqual(parsed.spots, {});
  });
});
