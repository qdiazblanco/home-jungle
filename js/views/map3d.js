// Dollhouse view (Phase 2): the same floor plan as the schematic blueprint,
// tilted into a CSS-3D perspective — extruded walls with glazed window
// openings, floor tones, and plants standing as billboards that always face
// the camera. Drag orbits the house (horizontal = spin, vertical = tilt).
//
// Pure presentation: reads the exact same layout/plants the schematic uses;
// editing always happens in the schematic view.

import { el } from '../ui.js';

const WALL_H = 1.15; // wall height in grid units
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
    spans.push([Math.max(0.2, center - winLen / 2), Math.min(len - 0.2, center + winLen / 2)]);
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
    cursor = to;
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
export function render3D(host, { gridW, gridH, rooms, byRoom, statusOf, plantSprite, onYaw }) {
  host.textContent = '';
  const stage = el('div', { class: 'd3-stage' });
  host.appendChild(stage);

  const build = () => {
    const width = stage.clientWidth || 340;
    const unit = width / (gridW + 4); // margin for the orbiting corners
    const sceneW = gridW * unit;
    const sceneH = gridH * unit;
    stage.style.height = `${Math.max(240, sceneH * 0.95 + 3 * unit)}px`;

    const scene = el('div', { class: 'd3-scene' });
    scene.style.width = `${sceneW}px`;
    scene.style.height = `${sceneH}px`;
    scene.style.marginLeft = `${-sceneW / 2}px`;
    scene.style.marginTop = `${-sceneH / 2}px`;

    const billboards = [];
    const px = (units) => units * unit;

    /* ground slab */
    scene.appendChild(
      el('div', {
        class: 'd3-slab',
        style: `left:${px(-0.6)}px; top:${px(-0.6)}px; width:${px(gridW + 1.2)}px; height:${px(gridH + 1.2)}px;`,
      }),
    );

    /* rooms: floor, label, walls with window openings */
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
          const along = piece.from;
          const style =
            side.dir === 'h'
              ? `left:${px(side.x + along)}px; top:${px(side.y)}px; width:${px(pieceLen)}px; height:${px(WALL_H)}px;` +
                ` transform: rotateX(90deg);`
              : `left:${px(side.x)}px; top:${px(side.y + along)}px; width:${px(pieceLen)}px; height:${px(WALL_H)}px;` +
                ` transform: rotateZ(90deg) rotateX(90deg);`;
          scene.appendChild(
            el('div', {
              class: `d3-wall d3-wall--${side.dir}${piece.glass ? ' d3-wall--glass' : ''}`,
              style,
            }),
          );
        }
      }

      /* plants as billboards */
      const roomPlants = room.plants ?? [];
      const pad = 0.9;
      const step = 1.9;
      const cols = Math.max(1, Math.floor((room.w - pad * 2) / step));
      roomPlants.forEach((plant, index) => {
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
    }

    const apply = () => {
      scene.style.transform = `rotateX(${orbit.tilt}deg) rotateZ(${orbit.yaw}deg)`;
      const face = `rotateZ(${-orbit.yaw}deg) rotateX(${-orbit.tilt}deg)`;
      for (const sprite of billboards) {
        sprite.style.transform = `${face} translate(-50%, -100%)`;
      }
      onYaw?.(orbit.yaw);
    };
    apply();

    /* drag to orbit */
    stage.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.d3-plant, .bp-tip')) return;
      event.preventDefault();
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        /* best-effort */
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const startYaw = orbit.yaw;
      const startTilt = orbit.tilt;
      const move = (ev) => {
        if (ev.buttons === 0) return up();
        orbit.yaw = (startYaw + (ev.clientX - startX) * 0.4) % 360;
        orbit.tilt = Math.min(78, Math.max(25, startTilt - (ev.clientY - startY) * 0.25));
        apply();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });

    stage.appendChild(scene);
  };

  // The stage needs layout before it can be measured.
  requestAnimationFrame(build);
  return stage;
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
