// House map view (Phase 2): the jungle room by room — every room's plants
// with their window orientation and current thirst, useful when rotating
// plants or acting on a light warning.

import * as store from '../store.js';
import { el, icon, clear } from '../ui.js';
import { wateringStatus } from '../../shared/schedule.js';
import { plantPhoto, stateChip } from '../components/plant-row.js';

const ORIENTATION_ARROWS = {
  north: '↑ N',
  northeast: '↗ NE',
  east: '→ E',
  southeast: '↘ SE',
  south: '↓ S',
  southwest: '↙ SW',
  west: '← W',
  northwest: '↖ NW',
};

export function render(container) {
  const root = el('div');
  container.appendChild(root);
  clear(root);

  const { plants, events } = store.getSnapshot();
  const today = store.today();
  const season = store.currentSeason();

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'House map'),
      el('span', { class: 'muted small' }, 'the jungle, room by room'),
    ),
  );

  const active = plants.filter((p) => p.status === 'active');

  if (!active.length) {
    root.appendChild(
      el('div', { class: 'empty-state' }, icon('leaf'), el('p', {}, 'No plants placed yet.')),
    );
    return;
  }

  // Group by room, biggest jungle corners first.
  const rooms = new Map();
  for (const plant of active) {
    const room = plant.location?.room?.trim() || 'Somewhere unplaced';
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(plant);
  }
  const sorted = [...rooms.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const grid = el('div', { class: 'room-grid' });
  for (const [room, roomPlants] of sorted) {
    grid.appendChild(
      el(
        'div',
        { class: 'card room-card' },
        el(
          'div',
          { class: 'room-card__head' },
          el('h2', {}, room),
          el('span', { class: 'muted small num' }, `${roomPlants.length} ${roomPlants.length === 1 ? 'plant' : 'plants'}`),
        ),
        roomPlants
          .map((plant) => ({ plant, status: wateringStatus(plant, events, today, season) }))
          .map(({ plant, status }) =>
            el(
              'a',
              {
                class: 'room-card__plant',
                href: `#/plant/${encodeURIComponent(plant.id)}`,
              },
              plantPhoto(plant, 'room-card__photo'),
              el(
                'span',
                { class: 'room-card__plant-body' },
                el('span', { class: 'room-card__plant-name' }, plant.name),
                plant.location?.orientation
                  ? el(
                      'span',
                      { class: 'small muted num', title: `${plant.location.orientation}-facing window` },
                      ORIENTATION_ARROWS[plant.location.orientation] ?? plant.location.orientation,
                    )
                  : null,
              ),
              stateChip(status),
            ),
          ),
      ),
    );
  }
  root.appendChild(grid);

  root.appendChild(
    el(
      'p',
      { class: 'small muted' },
      'Orientations are each plant’s window. Urgency chips are live — a good screen to plan a watering round through the house.',
    ),
  );
}
