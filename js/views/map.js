// House map view (Phase 2, v2): a literal blueprint. Rooms are rectangles
// on a grid (data/house.json, synced like everything else); every active
// plant appears as a tappable urgency dot inside its room. Gardener mode
// gets a layout editor: drag to move, corner handle to resize, add/remove
// rooms, one commit per save.

import * as store from '../store.js';
import { isGardener } from '../settings.js';
import { el, icon, clear, snackbar } from '../ui.js';
import { wateringStatus } from '../../shared/schedule.js';
import { plantPhoto, stateChip } from '../components/plant-row.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Like el(), but for SVG elements. */
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (!child) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const roomKey = (name) => String(name ?? '').trim().toLowerCase();

const MIN_ROOM = 3;

// Editor state survives store-driven re-renders (module-level draft).
let editor = null; // { draft } | null
let currentDraw = null; // latest draw() — drags must repaint the LIVE root

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    editor = null;
  });
}

export function render(container) {
  const root = el('div');
  container.appendChild(root);
  const draw = () => {
    clear(root);
    drawContent(root, draw);
  };
  currentDraw = draw;
  draw();
}

function drawContent(root, draw) {
  const { plants, events, house } = store.getSnapshot();
  const today = store.today();
  const season = store.currentSeason();
  const canEdit = isGardener();

  const active = plants.filter((p) => p.status === 'active');
  const layout = editor?.draft ?? house;
  const gridW = layout?.grid?.w ?? 24;
  const gridH = layout?.grid?.h ?? 16;
  const rooms = layout?.rooms ?? [];

  /* ---- plants grouped by room key ---- */
  const byRoom = new Map();
  for (const plant of active) {
    const key = roomKey(plant.location?.room) || '(unplaced)';
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key).push(plant);
  }
  const placedKeys = new Set(rooms.map((room) => roomKey(room.name)));

  /* ---- header ---- */
  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'House map'),
      canEdit && !editor
        ? el(
            'button',
            {
              class: 'btn btn--sm',
              onclick: () => {
                editor = { draft: structuredClone({ ...layout, grid: { ...layout?.grid, w: gridW, h: gridH }, rooms }) };
                draw();
              },
            },
            icon('edit'),
            'Edit floor plan',
          )
        : el('span', { class: 'muted small' }, editor ? 'editing the floor plan' : 'the jungle, room by room'),
    ),
  );

  /* ---- the blueprint ---- */
  const statusOf = (plant) => wateringStatus(plant, events, today, season);
  root.appendChild(
    el(
      'div',
      { class: 'card bp-card' },
      renderBlueprint({ gridW, gridH, rooms, byRoom, statusOf, draw }),
    ),
  );

  /* ---- legend ---- */
  root.appendChild(
    el(
      'div',
      { class: 'bp-legend small muted' },
      ['overdue', 'due', 'soon', 'fine', 'unknown'].map((state) =>
        el(
          'span',
          { class: 'bp-legend__item' },
          el('span', { class: `bp-legend__dot bp-dot--${state}` }),
          state === 'unknown' ? 'no log' : state,
        ),
      ),
    ),
  );

  /* ---- editor controls ---- */
  if (editor) {
    renderEditorControls(root, { gridW, gridH, byRoom, draw });
  }

  /* ---- rooms with plants but no rectangle ---- */
  const unplaced = [...byRoom.entries()].filter(([key]) => !placedKeys.has(key));
  if (unplaced.length) {
    root.appendChild(
      el(
        'div',
        { class: 'section-title' },
        el('h2', {}, 'Not on the plan yet'),
        canEdit && !editor
          ? el('span', { class: 'muted small' }, 'add their rooms via “Edit floor plan”')
          : null,
      ),
    );
    for (const [, roomPlants] of unplaced) {
      for (const plant of roomPlants) {
        root.appendChild(
          el(
            'a',
            { class: 'room-card__plant card', href: `#/plant/${encodeURIComponent(plant.id)}` },
            plantPhoto(plant, 'room-card__photo'),
            el(
              'span',
              { class: 'room-card__plant-body' },
              el('span', { class: 'room-card__plant-name' }, plant.name),
              el('span', { class: 'small muted' }, plant.location?.room || 'no room set'),
            ),
            stateChip(statusOf(plant)),
          ),
        );
      }
    }
  }

  if (!editor) {
    root.appendChild(
      el(
        'p',
        { class: 'small muted' },
        'Tap a dot to open its plant. Dot colors are live watering urgency.',
      ),
    );
  }
}

/* ================= blueprint rendering ================= */

function renderBlueprint({ gridW, gridH, rooms, byRoom, statusOf, draw }) {
  const board = svg('svg', {
    class: `bp${editor ? ' bp--editing' : ''}`,
    viewBox: `-0.3 -0.3 ${gridW + 0.6} ${gridH + 0.6}`,
    role: 'group',
    'aria-label': 'Floor plan of the house with plants placed in their rooms',
  });

  // outer walls
  board.appendChild(
    svg('rect', { class: 'bp-walls', x: 0, y: 0, width: gridW, height: gridH, rx: 0.3 }),
  );

  for (const room of rooms) {
    board.appendChild(renderRoom(board, room, { gridW, gridH, byRoom, statusOf, draw }));
  }
  return board;
}

function renderRoom(board, room, { gridW, gridH, byRoom, statusOf, draw }) {
  const group = svg('g', { class: 'bp-room' });
  const rect = svg('rect', {
    class: 'bp-room__rect',
    x: room.x,
    y: room.y,
    width: room.w,
    height: room.h,
    rx: 0.2,
  });
  group.appendChild(rect);
  group.appendChild(
    svg('text', { class: 'bp-room__label', x: room.x + 0.5, y: room.y + 1.0 }, room.name),
  );

  /* plants as urgency dots */
  const roomPlants = byRoom.get(roomKey(room.name)) ?? [];
  const pad = 0.7;
  const step = 1.3;
  const cols = Math.max(1, Math.floor((room.w - pad * 2) / step));
  const maxRows = Math.max(1, Math.floor((room.h - 1.6 - pad) / step));
  const capacity = cols * maxRows;
  roomPlants.slice(0, capacity).forEach((plant, index) => {
    const col = index % cols;
    const rowIndex = Math.floor(index / cols);
    const cx = room.x + pad + 0.35 + col * step;
    const cy = room.y + 1.6 + 0.35 + rowIndex * step;
    const state = statusOf(plant)?.state ?? 'unknown';
    const label = `${plant.name} — ${state === 'unknown' ? 'no log yet' : state}`;
    const parts = [
      svg('circle', { class: 'bp-plant__hit', cx, cy, r: 0.62 }),
      svg('circle', { class: `bp-plant__dot bp-dot--${state}`, cx, cy, r: 0.42 }),
      svg('title', {}, label),
    ];
    // View mode: a real (focusable, announced) SVG link. Edit mode: inert.
    const dot = editor
      ? svg('g', { class: 'bp-plant' }, ...parts)
      : svg(
          'a',
          { class: 'bp-plant', href: `#/plant/${encodeURIComponent(plant.id)}`, 'aria-label': label },
          ...parts,
        );
    group.appendChild(dot);
  });
  if (roomPlants.length > capacity) {
    group.appendChild(
      svg(
        'text',
        { class: 'bp-room__more', x: room.x + room.w - 0.5, y: room.y + room.h - 0.4, 'text-anchor': 'end' },
        `+${roomPlants.length - capacity}`,
      ),
    );
  }

  /* editor affordances */
  if (editor) {
    const draftRoom = editor.draft.rooms.find((r) => r.id === room.id);
    // In edit mode `room` IS draftRoom (same object) — snapshot the render-time
    // geometry so cumulative pointer deltas apply to a fixed base, never to
    // values the previous pointermove already mutated.
    const start = { x: room.x, y: room.y, w: room.w, h: room.h };
    attachDrag(board, rect, (dx, dy) => {
      draftRoom.x = clamp(Math.round(start.x + dx), 0, gridW - draftRoom.w);
      draftRoom.y = clamp(Math.round(start.y + dy), 0, gridH - draftRoom.h);
      group.setAttribute('transform', `translate(${draftRoom.x - start.x} ${draftRoom.y - start.y})`);
    });

    const handle = svg('rect', {
      class: 'bp-room__resize',
      x: room.x + room.w - 0.8,
      y: room.y + room.h - 0.8,
      width: 0.8,
      height: 0.8,
    });
    attachDrag(board, handle, (dx, dy) => {
      draftRoom.w = clamp(Math.round(start.w + dx), MIN_ROOM, gridW - draftRoom.x);
      draftRoom.h = clamp(Math.round(start.h + dy), MIN_ROOM, gridH - draftRoom.y);
      rect.setAttribute('width', draftRoom.w);
      rect.setAttribute('height', draftRoom.h);
      handle.setAttribute('x', draftRoom.x + draftRoom.w - 0.8);
      handle.setAttribute('y', draftRoom.y + draftRoom.h - 0.8);
    });
    group.appendChild(handle);

    group.appendChild(
      svg(
        'g',
        {
          class: 'bp-room__delete',
          onclick: () => {
            editor.draft.rooms = editor.draft.rooms.filter((r) => r.id !== room.id);
            draw();
          },
        },
        svg('circle', { cx: room.x + room.w - 0.55, cy: room.y + 0.55, r: 0.5 }),
        svg(
          'text',
          { x: room.x + room.w - 0.55, y: room.y + 0.78, 'text-anchor': 'middle' },
          '✕',
        ),
        svg('title', {}, `Remove ${room.name} from the plan`),
      ),
    );
  }

  return group;
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/** Pointer-drag in grid units; full redraw (of the LIVE root) on release. */
function attachDrag(board, node, onMove) {
  node.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort */
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const scale = board.getBoundingClientRect().width / (board.viewBox.baseVal.width || 1);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      currentDraw?.();
    };
    const move = (ev) => {
      if (ev.buttons === 0) return up(); // missed pointerup (window lost focus)
      onMove((ev.clientX - startX) / scale, (ev.clientY - startY) / scale);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

/* ================= editor controls ================= */

function renderEditorControls(root, { gridW, gridH, byRoom, draw }) {
  const placed = new Set(editor.draft.rooms.map((room) => roomKey(room.name)));
  const suggestions = [...byRoom.keys()]
    .filter((key) => key !== '(unplaced)' && !placed.has(key))
    .map((key) => byRoom.get(key)[0].location.room.trim());

  const nameInput = el('input', {
    type: 'text',
    list: 'bp-room-names',
    placeholder: suggestions[0] ?? 'Room name…',
  });

  root.appendChild(
    el(
      'div',
      { class: 'card' },
      el(
        'p',
        { class: 'small muted' },
        'Drag a room to move it, drag its corner square to resize, ✕ removes it. ',
        'Room names must match the rooms your plants use.',
      ),
      el(
        'div',
        { class: 'field-row', style: 'grid-template-columns: 1fr auto' },
        el('span', {}, nameInput, el('datalist', { id: 'bp-room-names' }, suggestions.map((n) => el('option', { value: n })))),
        el(
          'button',
          {
            class: 'btn',
            onclick: () => {
              const name = nameInput.value.trim();
              if (!name) return;
              if (editor.draft.rooms.some((room) => roomKey(room.name) === roomKey(name))) {
                snackbar({ message: `${name} is already on the plan.` });
                return;
              }
              const slug = roomKey(name).replace(/[^a-z0-9]+/g, '-') || 'room';
              let id = slug;
              let n = 2;
              while (editor.draft.rooms.some((room) => room.id === id)) id = `${slug}-${n++}`;
              editor.draft.rooms.push({
                id,
                name,
                ...findFreeSpot(editor.draft.rooms, gridW, gridH),
              });
              nameInput.value = '';
              draw();
            },
          },
          icon('plus'),
          'Add room',
        ),
      ),
      el(
        'div',
        { class: 'sheet__actions' },
        el(
          'button',
          {
            class: 'btn',
            onclick: () => {
              editor = null;
              draw();
            },
          },
          'Cancel',
        ),
        el(
          'button',
          {
            class: 'btn btn--primary',
            onclick: () => {
              store.setHouse(editor.draft);
              editor = null;
              draw();
            },
          },
          'Save floor plan',
        ),
      ),
    ),
  );
}

/** First grid position where a default 6×5 room fits without overlap. */
function findFreeSpot(rooms, gridW, gridH) {
  const w = Math.min(6, gridW);
  const h = Math.min(5, gridH);
  const overlaps = (x, y) =>
    rooms.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
  for (let y = 0; y + h <= gridH; y++) {
    for (let x = 0; x + w <= gridW; x++) {
      if (!overlaps(x, y)) return { x, y, w, h };
    }
  }
  return { x: 0, y: 0, w, h }; // crowded plan: overlap, user rearranges
}
