// House map view (Phase 2, v3): an illustrated blueprint. Rooms are
// rectangles on a grid (data/house.json, synced like everything else),
// drawn with architectural walls, floor texture, soft shadows and windows
// derived from each plant's window orientation. Every active plant is a
// small potted glyph tinted by live watering urgency; hovering (or a first
// tap on touch) shows an info card, activating opens the profile.
//
// Gardener mode keeps the layout editor: drag to move, corner handle to
// resize, add/remove rooms, one commit per save.

import * as store from '../store.js';
import { isGardener } from '../settings.js';
import { el, icon, clear, snackbar, fmtRelativeDay } from '../ui.js';
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
let tip = null; // { el, plantId } — the hover/tap info card

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    editor = null;
    hideTip();
  });
}

function hideTip() {
  tip?.el.remove();
  tip = null;
}

export function render(container) {
  const root = el('div');
  container.appendChild(root);
  const draw = () => {
    hideTip();
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
                editor = {
                  draft: structuredClone({
                    ...layout,
                    grid: { ...layout?.grid, w: gridW, h: gridH },
                    rooms,
                  }),
                };
                draw();
              },
            },
            icon('edit'),
            'Edit floor plan',
          )
        : el(
            'span',
            { class: 'muted small' },
            editor ? 'editing the floor plan' : 'the jungle, room by room',
          ),
    ),
  );

  /* ---- the blueprint ---- */
  const statusOf = (plant) => wateringStatus(plant, events, today, season);
  const boardCard = el('div', { class: 'card bp-card' });
  boardCard.appendChild(renderBlueprint(boardCard, { gridW, gridH, rooms, byRoom, statusOf }));
  // A tap anywhere that is not a plant or the card dismisses the info card.
  boardCard.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.bp-plant, .bp-tip')) hideTip();
  });
  root.appendChild(boardCard);

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
        'Hover a plant (or tap once) for its card; open it from there or with a second tap. ',
        'Windows are drawn from each plant’s recorded orientation.',
      ),
    );
  }
}

/* ================= blueprint rendering ================= */

const FLOOR_TONES = ['bp-floor--a', 'bp-floor--b', 'bp-floor--c'];

function toneFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return FLOOR_TONES[Math.abs(hash) % FLOOR_TONES.length];
}

function renderBlueprint(container, { gridW, gridH, rooms, byRoom, statusOf }) {
  const board = svg('svg', {
    class: `bp${editor ? ' bp--editing' : ''}`,
    viewBox: `-0.5 -1.9 ${gridW + 1} ${gridH + 2.6}`,
    role: 'group',
    'aria-label': 'Floor plan of the house with plants placed in their rooms',
  });

  board.appendChild(
    svg(
      'defs',
      {},
      svg(
        'filter',
        { id: 'bp-shadow', x: '-20%', y: '-20%', width: '140%', height: '140%' },
        svg('feDropShadow', {
          dx: 0,
          dy: 0.12,
          stdDeviation: 0.14,
          'flood-color': '#2b332a',
          'flood-opacity': 0.22,
        }),
      ),
      svg(
        'pattern',
        { id: 'bp-boards', width: 1.7, height: 1.7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(90)' },
        svg('path', { d: 'M0 0 H1.7', class: 'bp-boards-line' }),
      ),
    ),
  );

  // ground slab + outer walls
  board.appendChild(svg('rect', { class: 'bp-slab', x: -0.25, y: -0.25, width: gridW + 0.5, height: gridH + 0.5, rx: 0.35, filter: 'url(#bp-shadow)' }));
  board.appendChild(svg('rect', { class: 'bp-walls', x: 0, y: 0, width: gridW, height: gridH }));

  for (const room of rooms) {
    board.appendChild(renderRoom(container, board, room, { gridW, gridH, byRoom, statusOf }));
  }

  // compass, floating above the top-right corner
  board.appendChild(
    svg(
      'g',
      { class: 'bp-compass', transform: `translate(${gridW - 0.9} -1.0)` },
      svg('circle', { r: 0.75 }),
      svg('path', { d: 'M0 0.42 L0.2 0.12 L0 -0.45 L-0.2 0.12 Z' }),
      svg('text', { y: -0.62, 'text-anchor': 'middle' }, 'N'),
    ),
  );

  return board;
}

/** Window glyphs on a wall from a plant orientation ("northeast" → north wall, east end). */
const WINDOW_SPOTS = {
  north: ['n', 0.5],
  northeast: ['n', 0.78],
  east: ['e', 0.5],
  southeast: ['e', 0.78],
  south: ['s', 0.5],
  southwest: ['s', 0.22],
  west: ['w', 0.5],
  northwest: ['n', 0.22],
};

function windowSegment(room, orientation) {
  const spot = WINDOW_SPOTS[orientation];
  if (!spot) return null;
  const [wall, f] = spot;
  const horizontal = wall === 'n' || wall === 's';
  const len = Math.min(2.4, (horizontal ? room.w : room.h) * 0.38);
  if (horizontal) {
    const y = wall === 'n' ? room.y : room.y + room.h;
    const cx = room.x + room.w * f;
    return { x1: cx - len / 2, y1: y, x2: cx + len / 2, y2: y };
  }
  const x = wall === 'e' ? room.x + room.w : room.x;
  const cy = room.y + room.h * f;
  return { x1: x, y1: cy - len / 2, x2: x, y2: cy + len / 2 };
}

function renderRoom(container, board, room, { gridW, gridH, byRoom, statusOf }) {
  const group = svg('g', { class: 'bp-room' });
  const rect = svg('rect', {
    class: `bp-room__rect ${toneFor(room.id ?? room.name)}`,
    x: room.x,
    y: room.y,
    width: room.w,
    height: room.h,
  });
  group.appendChild(rect);
  // floor texture overlay (inert)
  group.appendChild(
    svg('rect', {
      class: 'bp-room__boards',
      x: room.x,
      y: room.y,
      width: room.w,
      height: room.h,
      fill: 'url(#bp-boards)',
    }),
  );

  const roomPlants = byRoom.get(roomKey(room.name)) ?? [];

  /* windows from the room's plants' orientations */
  const orientations = [...new Set(roomPlants.map((p) => p.location?.orientation).filter(Boolean))];
  for (const orientation of orientations) {
    const seg = windowSegment(room, orientation);
    if (!seg) continue;
    group.appendChild(svg('line', { class: 'bp-window__gap', ...seg }));
    group.appendChild(svg('line', { class: 'bp-window__glass', ...seg }));
  }

  group.appendChild(
    svg('text', { class: 'bp-room__label', x: room.x + 0.55, y: room.y + 1.05 }, room.name),
  );

  /* plants as potted glyphs */
  const pad = 0.85;
  const step = 1.9;
  const cols = Math.max(1, Math.floor((room.w - pad * 2) / step));
  const maxRows = Math.max(1, Math.floor((room.h - 1.7 - pad) / step));
  const capacity = cols * maxRows;
  roomPlants.slice(0, capacity).forEach((plant, index) => {
    const col = index % cols;
    const rowIndex = Math.floor(index / cols);
    const cx = room.x + pad + 0.5 + col * step;
    const cy = room.y + 1.9 + 0.6 + rowIndex * step;
    group.appendChild(renderPlantGlyph(container, plant, statusOf(plant), cx, cy));
  });
  if (roomPlants.length > capacity) {
    group.appendChild(
      svg(
        'text',
        {
          class: 'bp-room__more',
          x: room.x + room.w - 0.5,
          y: room.y + room.h - 0.4,
          'text-anchor': 'end',
        },
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
            currentDraw?.();
          },
        },
        svg('circle', { cx: room.x + room.w - 0.55, cy: room.y + 0.55, r: 0.5 }),
        svg('text', { x: room.x + room.w - 0.55, y: room.y + 0.78, 'text-anchor': 'middle' }, '✕'),
        svg('title', {}, `Remove ${room.name} from the plan`),
      ),
    );
  }

  return group;
}

/* ---------------- plant glyphs + info card ---------------- */

function renderPlantGlyph(container, plant, status, cx, cy) {
  const state = status?.state ?? 'unknown';
  const label = `${plant.name} — ${state === 'unknown' ? 'no log yet' : state}`;

  const parts = [
    svg('circle', { class: 'bp-plant__hit', cx, cy, r: 0.95 }),
    svg('ellipse', { class: 'bp-plant__shadow', cx, cy: cy + 0.62, rx: 0.5, ry: 0.13 }),
    // pot
    svg('path', {
      class: 'bp-plant__pot',
      d: `M${cx - 0.4} ${cy + 0.12} L${cx + 0.4} ${cy + 0.12} L${cx + 0.28} ${cy + 0.6} L${cx - 0.28} ${cy + 0.6} Z`,
    }),
    svg('rect', { class: 'bp-plant__rim', x: cx - 0.46, y: cy + 0.02, width: 0.92, height: 0.16, rx: 0.06 }),
    // foliage, tinted by urgency
    svg('circle', { class: `bp-plant__leaf bp-dot--${state}`, cx: cx - 0.24, cy: cy - 0.22, r: 0.3 }),
    svg('circle', { class: `bp-plant__leaf bp-dot--${state}`, cx: cx + 0.24, cy: cy - 0.22, r: 0.3 }),
    svg('circle', { class: `bp-plant__leaf bp-dot--${state}`, cx, cy: cy - 0.46, r: 0.34 }),
    svg('title', {}, label),
  ];

  if (editor) return svg('g', { class: 'bp-plant' }, ...parts);

  const link = svg(
    'a',
    { class: 'bp-plant', href: `#/plant/${encodeURIComponent(plant.id)}`, 'aria-label': label },
    ...parts,
  );

  /* hover (mouse) / first-tap (touch) info card */
  let lastPointerType = 'mouse';
  let hideTimer = null;
  const scheduleHide = () => {
    hideTimer = setTimeout(() => hideTip(), 140);
  };
  const cancelHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
  };

  link.addEventListener('pointerdown', (event) => {
    lastPointerType = event.pointerType || 'mouse';
  });
  link.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') {
      cancelHide();
      showTip(container, link, plant, status);
    }
  });
  link.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') scheduleHide();
  });
  link.addEventListener('focus', () => showTip(container, link, plant, status));
  link.addEventListener('blur', () => scheduleHide());
  link.addEventListener('click', (event) => {
    // Touch: first tap shows the card, second tap (or the card) opens.
    if (lastPointerType !== 'mouse' && tip?.plantId !== plant.id) {
      event.preventDefault();
      showTip(container, link, plant, status);
    }
  });
  link.tipHooks = { cancelHide, scheduleHide };

  return link;
}

function showTip(container, anchor, plant, status) {
  if (tip?.plantId === plant.id) return;
  hideTip();

  const meta = [];
  if (status?.lastWatering) meta.push(`watered ${fmtRelativeDay(status.lastWatering)}`);
  if (status?.interval) meta.push(`every ${status.interval} d`);
  if (!meta.length) meta.push('no watering log yet');

  const card = el(
    'a',
    { class: 'bp-tip', href: `#/plant/${encodeURIComponent(plant.id)}` },
    plantPhoto(plant, 'bp-tip__photo'),
    el(
      'span',
      { class: 'bp-tip__body' },
      el('strong', { class: 'bp-tip__name' }, plant.name),
      plant.species && plant.species !== plant.name
        ? el('span', { class: 'bp-tip__species' }, plant.species)
        : null,
      stateChip(status),
      el('span', { class: 'small muted' }, meta.join(' · ')),
    ),
  );
  card.addEventListener('pointerenter', () => anchor.tipHooks?.cancelHide());
  card.addEventListener('pointerleave', () => anchor.tipHooks?.scheduleHide());

  // Position above the glyph, clamped inside the board card.
  card.style.visibility = 'hidden';
  container.appendChild(card);
  const anchorRect = anchor.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  let left = anchorRect.left + anchorRect.width / 2 - containerRect.left - cardRect.width / 2;
  left = clamp(left, 6, containerRect.width - cardRect.width - 6);
  let top = anchorRect.top - containerRect.top - cardRect.height - 8;
  if (top < 6) top = anchorRect.bottom - containerRect.top + 8;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.style.visibility = '';

  tip = { el: card, plantId: plant.id };
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
        el(
          'span',
          {},
          nameInput,
          el('datalist', { id: 'bp-room-names' }, suggestions.map((n) => el('option', { value: n }))),
        ),
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
