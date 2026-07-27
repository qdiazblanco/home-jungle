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
import { render3D, dollhouseRooms } from './map3d.js';

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

/** Furniture catalogue: fixed footprints, top height in grid units. */
export const FURNITURE_KINDS = {
  table: { label: 'Table', w: 3, h: 2, z: 1.0 },
  shelf: { label: 'Shelf', w: 3, h: 1, z: 1.9 },
  stand: { label: 'Plant stand', w: 1.2, h: 1.2, z: 0.75 },
  windowsill: { label: 'Windowsill', w: 2.4, h: 0.7, z: 0.95 },
};

/**
 * Resolves the layout into renderable furniture and plant spots:
 * furniture pieces with absolute coords + the plants placed on each, and
 * the remaining floor plants per room key.
 */
function furnitureModel(layout, byRoom) {
  const rooms = layout?.rooms ?? [];
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const placements =
    layout?.placements && typeof layout.placements === 'object' ? layout.placements : {};

  const furniture = (Array.isArray(layout?.furniture) ? layout.furniture : []).flatMap((piece) => {
    const room = roomsById.get(piece.roomId);
    const spec = FURNITURE_KINDS[piece.kind];
    if (!room || !spec || !Number.isFinite(piece.x) || !Number.isFinite(piece.y)) return [];
    const w = Number(piece.w) || spec.w;
    const h = Number(piece.h) || spec.h;
    return [{ ...piece, w, h, spec, room, absX: room.x + piece.x, absY: room.y + piece.y }];
  });
  const furnitureById = new Map(furniture.map((piece) => [piece.id, piece]));

  const onFurniture = new Map(); // furnitureId -> plants
  const floorByRoom = new Map(); // room key -> plants
  for (const [key, plants] of byRoom) {
    for (const plant of plants) {
      const spot = furnitureById.get(placements[plant.id]);
      if (spot && roomKey(spot.room.name) === key) {
        if (!onFurniture.has(spot.id)) onFurniture.set(spot.id, []);
        onFurniture.get(spot.id).push(plant);
      } else {
        if (!floorByRoom.has(key)) floorByRoom.set(key, []);
        floorByRoom.get(key).push(plant);
      }
    }
  }
  return { furniture, furnitureById, onFurniture, floorByRoom };
}

/** Plant silhouette markup for a 24×30 viewBox, foliage tinted by urgency. */
export function iconMarkup(state, iconKind) {
  const leaf = (extra) => `class="bp-dot--${state}" stroke="rgba(43,51,42,0.25)" stroke-width="0.6" ${extra}`;
  const potBase =
    `<ellipse cx="12" cy="27.4" rx="7" ry="1.8" fill="rgba(43,51,42,0.2)"/>` +
    `<path d="M6.5 16.5 L17.5 16.5 L15.8 24 L8.2 24 Z" fill="var(--terracotta)"/>` +
    `<rect x="5.4" y="15" width="13.2" height="2.4" rx="0.8" fill="#b5654a"/>`;
  switch (iconKind) {
    case 'bushy':
      return (
        potBase +
        `<circle ${leaf('cx="6.8" cy="12.2" r="3.4"')}/>` +
        `<circle ${leaf('cx="17.2" cy="12.2" r="3.4"')}/>` +
        `<circle ${leaf('cx="9.2" cy="7.8" r="3.6"')}/>` +
        `<circle ${leaf('cx="14.8" cy="7.8" r="3.6"')}/>` +
        `<circle ${leaf('cx="12" cy="12" r="3.8"')}/>`
      );
    case 'tree':
      return (
        potBase +
        `<rect x="11" y="8" width="2" height="8" rx="1" fill="#7a5a3a"/>` +
        `<circle ${leaf('cx="12" cy="6.4" r="5.6"')}/>`
      );
    case 'cactus':
      return (
        potBase +
        `<rect ${leaf('x="9.4" y="4.5" width="5.2" height="11.5" rx="2.6"')}/>` +
        `<rect ${leaf('x="4.8" y="7.5" width="3.4" height="6" rx="1.7"')}/>` +
        `<rect ${leaf('x="15.8" y="9" width="3.4" height="5" rx="1.7"')}/>`
      );
    case 'hanging':
      return (
        `<ellipse cx="12" cy="27.4" rx="7" ry="1.8" fill="rgba(43,51,42,0.2)"/>` +
        `<path d="M7 8.5 L17 8.5 L15.6 14.5 L8.4 14.5 Z" fill="var(--terracotta)"/>` +
        `<rect x="6" y="7.2" width="12" height="2.2" rx="0.8" fill="#b5654a"/>` +
        `<path d="M8 14.5 C7 19 7.5 23 6.5 26" fill="none" stroke="var(--leaf-deep)" stroke-width="0.9"/>` +
        `<path d="M12 14.5 C12 20 11.5 24 12.5 27" fill="none" stroke="var(--leaf-deep)" stroke-width="0.9"/>` +
        `<path d="M16 14.5 C17 19 16.5 23 17.5 25" fill="none" stroke="var(--leaf-deep)" stroke-width="0.9"/>` +
        `<circle ${leaf('cx="6.6" cy="19" r="1.7"')}/>` +
        `<circle ${leaf('cx="12.2" cy="21" r="1.7"')}/>` +
        `<circle ${leaf('cx="16.8" cy="18" r="1.7"')}/>` +
        `<circle ${leaf('cx="7" cy="24.5" r="1.7"')}/>` +
        `<circle ${leaf('cx="17.2" cy="23" r="1.7"')}/>` +
        `<circle ${leaf('cx="10" cy="6.2" r="2.4"')}/>` +
        `<circle ${leaf('cx="14" cy="6.2" r="2.4"')}/>`
      );
    default: // 'pot'
      return (
        potBase +
        `<circle ${leaf('cx="7.6" cy="10.6" r="4.4"')}/>` +
        `<circle ${leaf('cx="16.4" cy="10.6" r="4.4"')}/>` +
        `<circle ${leaf('cx="12" cy="5.6" r="4.9"')}/>`
      );
  }
}

const MODE_KEY = 'digital-garden:map-view';

// 'plan' (schematic, editable) | '3d' (dollhouse). Device-local preference.
let viewMode = 'plan';
try {
  viewMode = localStorage.getItem(MODE_KEY) === '3d' ? '3d' : 'plan';
} catch {
  /* storage unavailable — default stands */
}

// Editor state survives store-driven re-renders (module-level draft).
let editor = null; // { draft } | null
let currentDraw = null; // latest draw() — drags must repaint the LIVE root
let tip = null; // { el, plantId } — the hover/tap info card
let tipHideTimer = null; // ONE timer for the card, owned by show/hide below
let tipContainer = null; // the .bp-card the tip positions against
let compassNeedle = null; // rotates with the dollhouse yaw

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    editor = null;
    hideTip();
  });
}

function cancelTipHide() {
  if (tipHideTimer) clearTimeout(tipHideTimer);
  tipHideTimer = null;
}

function scheduleTipHide() {
  cancelTipHide();
  tipHideTimer = setTimeout(hideTip, 140);
}

function hideTip() {
  cancelTipHide();
  tip?.el.remove();
  tip = null;
}

export function render(container) {
  const root = el('div');
  container.appendChild(root);
  // A tap anywhere in the view that is not a plant or the card dismisses it.
  root.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.bp-plant, .bp-tip')) hideTip();
  });
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
  const model = furnitureModel(layout, byRoom);

  /* ---- header: view toggle + edit ---- */
  const setMode = (mode) => {
    viewMode = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* preference only */
    }
    draw();
  };
  const openEditor = () => {
    viewMode = 'plan'; // editing is a schematic affair
    editor = {
      draft: structuredClone({
        ...layout,
        grid: { ...layout?.grid, w: gridW, h: gridH },
        rooms,
      }),
    };
    draw();
  };

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'House map'),
      editor
        ? el('span', { class: 'muted small' }, 'editing the floor plan')
        : el(
            'span',
            { class: 'map-tools' },
            el(
              'span',
              { class: 'segmented', role: 'group', 'aria-label': 'Map style' },
              el(
                'button',
                { 'aria-pressed': String(viewMode === 'plan'), onclick: () => setMode('plan') },
                'Plan',
              ),
              el(
                'button',
                { 'aria-pressed': String(viewMode === '3d'), onclick: () => setMode('3d') },
                '3D',
              ),
            ),
            canEdit
              ? el('button', { class: 'btn btn--sm', onclick: openEditor }, icon('edit'), 'Edit')
              : null,
          ),
    ),
  );

  /* ---- the blueprint / dollhouse ---- */
  const statusOf = (plant) => wateringStatus(plant, events, today, season);
  const boardCard = el('div', { class: 'card bp-card' });
  tipContainer = boardCard;

  if (viewMode === '3d' && !editor) {
    render3D(boardCard, {
      gridW,
      gridH,
      rooms: dollhouseRooms(rooms, byRoom, toneFor),
      model,
      statusOf,
      plantSprite: (plant, status) => makeSprite(plant, status),
      onYaw: (yaw) => {
        if (compassNeedle) compassNeedle.style.transform = `rotate(${yaw}deg)`;
      },
    });
  } else {
    boardCard.appendChild(renderBlueprint({ gridW, gridH, rooms, model, statusOf }));
  }

  // Compass as an HTML overlay: never clipped, and it turns with the house.
  compassNeedle = el(
    'span',
    { class: 'map-compass__needle', style: viewMode === '3d' ? '' : 'transform: rotate(0deg)' },
    el('span', { class: 'map-compass__arrow' }),
    el('span', { class: 'map-compass__n' }, 'N'),
  );
  boardCard.appendChild(
    el('div', { class: 'map-compass', title: 'North' }, compassNeedle),
  );
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
        viewMode === '3d'
          ? 'Drag to turn the house. Hover a plant (or tap once) for its card; open it from there or with a second tap.'
          : 'Hover a plant (or tap once) for its card; open it from there or with a second tap. Windows are drawn from each plant’s recorded orientation.',
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

function renderBlueprint({ gridW, gridH, rooms, model, statusOf }) {
  const board = svg('svg', {
    class: `bp${editor ? ' bp--editing' : ''}`,
    viewBox: `-0.5 -0.5 ${gridW + 1} ${gridH + 1}`,
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

  // Windows render in a layer ABOVE all rooms — a later-drawn room's wall
  // stroke must not paint over an earlier room's window on a shared wall.
  const windowLayer = svg('g', { class: 'bp-windows' });
  for (const room of rooms) {
    board.appendChild(renderRoom(board, room, { gridW, gridH, model, statusOf, windowLayer }));
  }
  board.appendChild(windowLayer);

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

function renderRoom(board, room, { gridW, gridH, model, statusOf, windowLayer }) {
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

  const key = roomKey(room.name);
  const floorPlants = model.floorByRoom.get(key) ?? [];
  const roomFurniture = model.furniture.filter((piece) => piece.room.id === room.id);
  const allRoomPlants = [
    ...floorPlants,
    ...roomFurniture.flatMap((piece) => model.onFurniture.get(piece.id) ?? []),
  ];

  /* windows from the room's plants' orientations */
  const orientations = [...new Set(allRoomPlants.map((p) => p.location?.orientation).filter(Boolean))];
  for (const orientation of orientations) {
    const seg = windowSegment(room, orientation);
    if (!seg) continue;
    windowLayer.appendChild(svg('line', { class: 'bp-window__gap', ...seg }));
    windowLayer.appendChild(svg('line', { class: 'bp-window__glass', ...seg }));
  }

  group.appendChild(
    svg('text', { class: 'bp-room__label', x: room.x + 0.55, y: room.y + 1.05 }, room.name),
  );

  /* furniture, then its plants on top */
  for (const piece of roomFurniture) {
    const rect = svg('rect', {
      class: `bp-furn bp-furn--${piece.kind}`,
      x: piece.absX,
      y: piece.absY,
      width: piece.w,
      height: piece.h,
      rx: 0.15,
    });
    group.appendChild(rect);
    group.appendChild(
      svg('title', {}, `${piece.spec.label}`),
    );

    if (editor) {
      const draftPiece = editor.draft.furniture?.find((f) => f.id === piece.id);
      if (draftPiece) {
        const start = { x: piece.x, y: piece.y };
        attachDrag(board, rect, (dx, dy) => {
          draftPiece.x = clamp(Math.round((start.x + dx) * 2) / 2, 0, Math.max(0, room.w - piece.w));
          draftPiece.y = clamp(Math.round((start.y + dy) * 2) / 2, 0, Math.max(0, room.h - piece.h));
          rect.setAttribute('x', room.x + draftPiece.x);
          rect.setAttribute('y', room.y + draftPiece.y);
        });
        group.appendChild(
          svg(
            'g',
            {
              class: 'bp-room__delete',
              onclick: () => {
                editor.draft.furniture = (editor.draft.furniture ?? []).filter((f) => f.id !== piece.id);
                currentDraw?.();
              },
            },
            svg('circle', { cx: piece.absX + piece.w, cy: piece.absY, r: 0.42 }),
            svg('text', { x: piece.absX + piece.w, y: piece.absY + 0.2, 'text-anchor': 'middle' }, '✕'),
            svg('title', {}, `Remove this ${piece.spec.label.toLowerCase()}`),
          ),
        );
      }
    } else {
      const plantsOn = model.onFurniture.get(piece.id) ?? [];
      plantsOn.forEach((plant, index) => {
        const cx = piece.absX + 0.6 + (index % Math.max(1, Math.floor(piece.w / 1.1))) * 1.1;
        const cy = piece.absY + piece.h / 2;
        group.appendChild(renderPlantGlyph(plant, statusOf(plant), Math.min(cx, piece.absX + piece.w - 0.5), cy));
      });
    }
  }

  /* floor plants as potted glyphs */
  const pad = 0.85;
  const step = 1.9;
  const cols = Math.max(1, Math.floor((room.w - pad * 2) / step));
  const maxRows = Math.max(1, Math.floor((room.h - 1.7 - pad) / step));
  const capacity = cols * maxRows;
  floorPlants.slice(0, capacity).forEach((plant, index) => {
    const col = index % cols;
    const rowIndex = Math.floor(index / cols);
    const cx = room.x + pad + 0.5 + col * step;
    const cy = Math.min(room.y + 1.9 + 0.6 + rowIndex * step, room.y + room.h - 0.8);
    group.appendChild(renderPlantGlyph(plant, statusOf(plant), cx, cy));
  });
  if (floorPlants.length > capacity) {
    group.appendChild(
      svg(
        'text',
        {
          class: 'bp-room__more',
          x: room.x + room.w - 0.5,
          y: room.y + room.h - 0.4,
          'text-anchor': 'end',
        },
        `+${floorPlants.length - capacity}`,
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

function renderPlantGlyph(plant, status, cx, cy) {
  const state = status?.state ?? 'unknown';
  const label = `${plant.name} — ${state === 'unknown' ? 'no log yet' : state}`;

  const icon = svg('svg', {
    x: cx - 0.75,
    y: cy - 1.05,
    width: 1.5,
    height: 1.9,
    viewBox: '0 0 24 30',
  });
  icon.innerHTML = iconMarkup(state, plant.icon);

  const parts = [
    svg('circle', { class: 'bp-plant__hit', cx, cy, r: 0.95 }),
    icon,
    svg('title', {}, label),
  ];

  if (editor) return svg('g', { class: 'bp-plant' }, ...parts);

  const link = svg(
    'a',
    { class: 'bp-plant', href: `#/plant/${encodeURIComponent(plant.id)}`, 'aria-label': label },
    ...parts,
  );

  wireTip(link, plant, status);
  return link;
}

/** Hover (mouse) / first-tap (touch) / focus info-card wiring for a link. */
function wireTip(link, plant, status) {
  let lastPointerType = 'mouse';
  // Chrome focuses a tapped link BEFORE click fires (its focus handler would
  // show the card and defeat the guard) — decide from pre-focus state.
  let tipWasShown = false;

  link.addEventListener('pointerdown', (event) => {
    lastPointerType = event.pointerType || 'mouse';
    tipWasShown = tip?.plantId === plant.id;
  });
  link.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') showTip(tipContainer, link, plant, status);
  });
  link.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') scheduleTipHide();
  });
  link.addEventListener('focus', () => showTip(tipContainer, link, plant, status));
  link.addEventListener('blur', () => scheduleTipHide());
  link.addEventListener('click', (event) => {
    // Touch: first tap shows the card, second tap (or the card) opens.
    if (lastPointerType !== 'mouse' && !tipWasShown) {
      event.preventDefault();
      showTip(tipContainer, link, plant, status);
    }
  });
}

/** Upright potted-plant sprite for the dollhouse (billboarded by map3d). */
function makeSprite(plant, status) {
  const state = status?.state ?? 'unknown';
  const label = `${plant.name} — ${state === 'unknown' ? 'no log yet' : state}`;
  const link = el('a', {
    class: 'bp-plant',
    href: `#/plant/${encodeURIComponent(plant.id)}`,
    'aria-label': label,
    title: label,
  });
  link.innerHTML = `<svg viewBox="0 0 24 30" aria-hidden="true">${iconMarkup(state, plant.icon)}</svg>`;
  wireTip(link, plant, status);
  return link;
}

function showTip(container, anchor, plant, status) {
  cancelTipHide();
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
  card.addEventListener('pointerenter', cancelTipHide);
  card.addEventListener('pointerleave', scheduleTipHide);

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
  let activePointer = null;
  node.addEventListener('pointerdown', (event) => {
    if (activePointer !== null) return; // one pointer drives a drag
    event.preventDefault();
    event.stopPropagation();
    activePointer = event.pointerId;
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort */
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const scale = board.getBoundingClientRect().width / (board.viewBox.baseVal.width || 1);
    const up = (ev) => {
      if (ev && ev.pointerId !== activePointer) return; // another finger lifted
      activePointer = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      currentDraw?.();
    };
    const move = (ev) => {
      if (ev.pointerId !== activePointer) return; // ignore other pointers
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
  editor.draft.furniture ??= [];
  editor.draft.placements ??= {};
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
        { class: 'field-row', style: 'grid-template-columns: 1fr 1fr auto; margin-top: 0.5rem' },
        el(
          'select',
          { 'aria-label': 'Furniture kind', id: 'bp-furn-kind' },
          Object.entries(FURNITURE_KINDS).map(([kind, spec]) =>
            el('option', { value: kind }, spec.label),
          ),
        ),
        el(
          'select',
          { 'aria-label': 'Room for the furniture', id: 'bp-furn-room' },
          editor.draft.rooms.map((room) => el('option', { value: room.id }, room.name)),
        ),
        el(
          'button',
          {
            class: 'btn',
            onclick: () => {
              const kind = document.getElementById('bp-furn-kind')?.value;
              const roomId = document.getElementById('bp-furn-room')?.value;
              const spec = FURNITURE_KINDS[kind];
              const room = editor.draft.rooms.find((r) => r.id === roomId);
              if (!spec || !room) return;
              let id = `${kind}-1`;
              let n = 2;
              while (editor.draft.furniture.some((piece) => piece.id === id)) id = `${kind}-${n++}`;
              editor.draft.furniture.push({
                id,
                roomId,
                kind,
                x: Math.max(0, Math.round((room.w - spec.w) / 2)),
                y: Math.max(0, Math.round((room.h - spec.h) / 2)),
                w: spec.w,
                h: spec.h,
              });
              draw();
            },
          },
          icon('plus'),
          'Add furniture',
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
              const draft = editor.draft;
              // prune furniture in deleted rooms + placements onto gone pieces
              const roomIds = new Set((draft.rooms ?? []).map((room) => room.id));
              draft.furniture = (draft.furniture ?? []).filter((piece) => roomIds.has(piece.roomId));
              const pieceIds = new Set(draft.furniture.map((piece) => piece.id));
              draft.placements = Object.fromEntries(
                Object.entries(draft.placements ?? {}).filter(([, id]) => pieceIds.has(id)),
              );
              store.setHouse(draft);
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
