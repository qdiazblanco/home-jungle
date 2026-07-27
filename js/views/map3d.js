// Dollhouse view (Phase 2): the same floor plan as the schematic blueprint,
// tilted into a CSS-3D perspective — extruded walls with glazed window
// openings, floor tones, and plants standing as billboards that always face
// the camera. Drag orbits the house (horizontal = spin, vertical = tilt).
//
// Pure presentation: reads the exact same layout/plants the schematic uses;
// editing always happens in the schematic view.

import { el } from '../ui.js';

const WALL_H = 1.6; // wall height in grid units
const roomKey = (name) => String(name ?? '').trim().toLowerCase();

// Session-persistent camera (module-level, like the map's other view state).
const orbit = { yaw: -28, tilt: 56 };

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

/** Merged window spans (fractions of wall length → units) for one wall. */
function windowSpans(room, orientations, wall) {
  const len = wall === 'n' || wall === 's' ? room.w : room.h;
  const spans = [];
  for (const orientation of orientations) {
    const spot = WINDOW_SPOTS[orientation];
    if (!spot || spot[0] !== wall) continue;
    const winLen = Math.min(2.4, len * 0.38);
    const center = len * spot[1];
    const from = Math.max(0.2, center - winLen / 2);
    const to = Math.min(len - 0.2, center + winLen / 2);
    if (to - from > 0.05) spans.push([from, to]); // tiny walls: no window
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

/** Solid/glass pieces covering 0..len around the window spans. */
function wallPieces(len, spans) {
  const pieces = [];
  let cursor = 0;
  for (const [from, to] of spans) {
    if (from > cursor) pieces.push({ from: cursor, to: from, glass: false });
    pieces.push({ from, to, glass: true });
    cursor = Math.max(cursor, to);
  }
  if (cursor < len) pieces.push({ from: cursor, to: len, glass: false });
  return pieces;
}

/**
 * Renders the dollhouse into `host` (emptied first).
 * @param {object} opts { gridW, gridH, rooms, byRoom, statusOf, plantSprite,
 *   onYaw } — plantSprite(plant, status) builds the billboard's inner
 *   element (with its own tip/click behavior); onYaw(deg) feeds the compass.
 */
export function render3D(host, { gridW, gridH, rooms, model, statusOf, plantSprite, onYaw }) {
  host.textContent = '';
  const stage = el('div', { class: 'd3-stage' });
  host.appendChild(stage);

  let scene = null;
  let billboards = [];
  let lastWidth = 0;

  const apply = () => {
    if (!scene) return;
    scene.style.transform = `rotateX(${orbit.tilt}deg) rotateZ(${orbit.yaw}deg)`;
    const face = `rotateZ(${-orbit.yaw}deg) rotateX(${-orbit.tilt}deg)`;
    for (const sprite of billboards) {
      sprite.style.transform = `${face} translate(-50%, -100%)`;
    }
    onYaw?.(orbit.yaw);
  };

  const build = () => {
    const width = stage.clientWidth || 340;
    lastWidth = width;
    stage.textContent = '';
    billboards = [];

    const unit = width / (gridW + 4); // margin for the orbiting corners
    const sceneW = gridW * unit;
    const sceneH = gridH * unit;
    stage.style.height = `${Math.max(240, sceneH * 0.95 + 3 * unit)}px`;

    scene = el('div', { class: 'd3-scene' });
    scene.style.width = `${sceneW}px`;
    scene.style.height = `${sceneH}px`;
    scene.style.marginLeft = `${-sceneW / 2}px`;
    scene.style.marginTop = `${-sceneH / 2}px`;

    const px = (units) => units * unit;

    /* ground slab */
    scene.appendChild(
      el('div', {
        class: 'd3-slab',
        style: `left:${px(-0.6)}px; top:${px(-0.6)}px; width:${px(gridW + 1.2)}px; height:${px(gridH + 1.2)}px;`,
      }),
    );

    // Glass renders in a second pass, nudged half a pixel toward its room's
    // interior — otherwise a neighbouring room's coplanar solid wall paints
    // over the opening (the same shared-wall lesson as the plan view).
    const glassPieces = [];

    for (const room of rooms) {
      scene.appendChild(
        el('div', {
          class: `d3-floor ${room.tone}`,
          style: `left:${px(room.x)}px; top:${px(room.y)}px; width:${px(room.w)}px; height:${px(room.h)}px;`,
        }),
      );
      scene.appendChild(
        el(
          'div',
          {
            class: 'd3-label',
            style: `left:${px(room.x + 0.4)}px; top:${px(room.y + 0.3)}px; font-size:${Math.max(9, unit * 0.72)}px;`,
          },
          room.name,
        ),
      );

      const orientations = room.orientations ?? [];
      const walls = [
        { wall: 'n', x: room.x, y: room.y, len: room.w, dir: 'h' },
        { wall: 's', x: room.x, y: room.y + room.h, len: room.w, dir: 'h' },
        { wall: 'w', x: room.x, y: room.y, len: room.h, dir: 'v' },
        { wall: 'e', x: room.x + room.w, y: room.y, len: room.h, dir: 'v' },
      ];
      for (const side of walls) {
        for (const piece of wallPieces(side.len, windowSpans(room, orientations, side.wall))) {
          const pieceLen = piece.to - piece.from;
          if (pieceLen <= 0.05) continue;
          if (piece.glass) {
            glassPieces.push({ side, from: piece.from, len: pieceLen });
            continue;
          }
          scene.appendChild(wallDiv(side, piece.from, pieceLen, false, px, 0, 0));
        }
      }

      /* floor plants as billboards (same capacity rules as the plan view) */
      const roomPlants = model?.floorByRoom.get(roomKey(room.name)) ?? [];
      const pad = 0.9;
      const step = 1.9;
      const cols = Math.max(1, Math.floor((room.w - pad * 2) / step));
      const maxRows = Math.max(1, Math.floor((room.h - 1.6 - 0.7) / step));
      const capacity = cols * maxRows;
      roomPlants.slice(0, capacity).forEach((plant, index) => {
        const col = index % cols;
        const rowIndex = Math.floor(index / cols);
        const cx = room.x + pad + 0.5 + col * step;
        const cy = Math.min(room.y + 1.6 + rowIndex * step, room.y + room.h - 0.7);
        const anchor = el('div', {
          class: 'd3-plant-anchor',
          style: `left:${px(cx)}px; top:${px(cy)}px;`,
        });
        const sprite = plantSprite(plant, statusOf(plant));
        sprite.classList.add('d3-plant');
        sprite.style.width = `${Math.max(22, unit * 1.5)}px`;
        anchor.appendChild(sprite);
        scene.appendChild(anchor);
        billboards.push(sprite);
      });
      if (roomPlants.length > capacity) {
        scene.appendChild(
          el(
            'div',
            {
              class: 'd3-label d3-label--more',
              style: `left:${px(room.x + room.w - 1.4)}px; top:${px(room.y + room.h - 1.1)}px; font-size:${Math.max(9, unit * 0.6)}px;`,
            },
            `+${roomPlants.length - capacity}`,
          ),
        );
      }
    }

    for (const piece of glassPieces) {
      const nudgeX = piece.side.wall === 'w' ? 0.5 : piece.side.wall === 'e' ? -0.5 : 0;
      const nudgeY = piece.side.wall === 'n' ? 0.5 : piece.side.wall === 's' ? -0.5 : 0;
      scene.appendChild(wallDiv(piece.side, piece.from, piece.len, true, px, nudgeX, nudgeY));
    }

    /* furniture: simple extruded boxes, plants standing on their tops */
    for (const piece of model?.furniture ?? []) {
      const { absX, absY, w, h, spec } = piece;
      const kindClass = `d3-furn--${piece.kind}`;
      const sides = [
        { dir: 'h', x: absX, y: absY, len: w },
        { dir: 'h', x: absX, y: absY + h, len: w },
        { dir: 'v', x: absX, y: absY, len: h },
        { dir: 'v', x: absX + w, y: absY, len: h },
      ];
      for (const side of sides) {
        const style =
          side.dir === 'h'
            ? `left:${px(side.x)}px; top:${px(side.y)}px; width:${px(side.len)}px; height:${px(spec.z)}px; transform: rotateX(90deg);`
            : `left:${px(side.x)}px; top:${px(side.y)}px; width:${px(side.len)}px; height:${px(spec.z)}px; transform: rotateZ(90deg) rotateX(90deg);`;
        scene.appendChild(el('div', { class: `d3-furn__side ${kindClass}`, style }));
      }
      scene.appendChild(
        el('div', {
          class: `d3-furn__top ${kindClass}`,
          style: `left:${px(absX)}px; top:${px(absY)}px; width:${px(w)}px; height:${px(h)}px; transform: translateZ(${px(spec.z)}px);`,
        }),
      );

      const plantsOn = model?.onFurniture.get(piece.id) ?? [];
      const spread = Math.max(1, Math.floor(w / 1.1));
      if (plantsOn.length > spread) {
        scene.appendChild(
          el(
            'div',
            {
              class: 'd3-label d3-label--more',
              style: `left:${px(absX + w - 0.9)}px; top:${px(absY + h + 0.15)}px; font-size:${Math.max(9, unit * 0.6)}px;`,
            },
            `+${plantsOn.length - spread}`,
          ),
        );
      }
      plantsOn.slice(0, spread).forEach((plant, index) => {
        const cx = Math.min(absX + 0.6 + index * 1.1, absX + w - 0.5);
        const cy = absY + h / 2;
        const anchor = el('div', {
          class: 'd3-plant-anchor',
          style: `left:${px(cx)}px; top:${px(cy)}px; transform: translateZ(${px(spec.z)}px);`,
        });
        const sprite = plantSprite(plant, statusOf(plant));
        sprite.classList.add('d3-plant');
        sprite.style.width = `${Math.max(22, unit * 1.5)}px`;
        anchor.appendChild(sprite);
        scene.appendChild(anchor);
        billboards.push(sprite);
      });
    }

    stage.appendChild(scene);
    apply();
  };

  /* drag to orbit — one pointer at a time, others ignored */
  let activePointer = null;
  stage.addEventListener('pointerdown', (event) => {
    if (activePointer !== null) return;
    if (event.target.closest('.d3-plant, .bp-tip')) return;
    event.preventDefault();
    activePointer = event.pointerId;
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      /* best-effort */
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const startYaw = orbit.yaw;
    const startTilt = orbit.tilt;
    const up = (ev) => {
      if (ev && ev.pointerId !== activePointer) return;
      activePointer = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    const move = (ev) => {
      if (ev.pointerId !== activePointer) return;
      if (ev.buttons === 0) return up();
      // yaw stays continuous (no wrapping): the compass needle transitions,
      // and a ±360° jump would spin it a full backwards turn. Negative dx
      // factor = "grab the house": drag right, house turns right.
      orbit.yaw = startYaw - (ev.clientX - startX) * 0.4;
      orbit.tilt = Math.min(78, Math.max(25, startTilt - (ev.clientY - startY) * 0.25));
      apply();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  /* build now and on real size changes (rotation, resize) */
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (!stage.isConnected) {
        observer.disconnect();
        return;
      }
      if (Math.abs((stage.clientWidth || 0) - lastWidth) >= 2) build();
    });
    observer.observe(stage); // first callback performs the initial build
  } else {
    requestAnimationFrame(build);
  }
  return stage;
}

/** One wall slab (solid or glass), standing on its plan edge. */
function wallDiv(side, along, pieceLen, glass, px, nudgeX, nudgeY) {
  const style =
    side.dir === 'h'
      ? `left:${px(side.x + along) + nudgeX}px; top:${px(side.y) + nudgeY}px; width:${px(pieceLen)}px; height:${px(WALL_H)}px;` +
        ` transform: rotateX(90deg);`
      : `left:${px(side.x) + nudgeX}px; top:${px(side.y + along) + nudgeY}px; width:${px(pieceLen)}px; height:${px(WALL_H)}px;` +
        ` transform: rotateZ(90deg) rotateX(90deg);`;
  return el('div', {
    class: `d3-wall d3-wall--${side.dir}${glass ? ' d3-wall--glass' : ''}`,
    style,
  });
}

/** Prepares render3D's room inputs from the raw layout + plant groups. */
export function dollhouseRooms(rooms, byRoom, toneFor) {
  return rooms.map((room) => {
    const plants = byRoom.get(roomKey(room.name)) ?? [];
    return {
      ...room,
      tone: toneFor(room.id ?? room.name),
      plants,
      orientations: [...new Set(plants.map((p) => p.location?.orientation).filter(Boolean))],
    };
  });
}
