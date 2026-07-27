// Wishlist view (Phase 2): the plants we don't have yet — where we saw
// them, what they'd need, and a celebratory way in when one comes home.

import * as store from '../store.js';
import { isGardener } from '../settings.js';
import { el, icon, clear, showSheet, formField } from '../ui.js';
import { effectiveCare } from '../../shared/effective-care.js';
import { renderMarkdown } from '../../shared/markdown.js';
import { todayString } from '../../shared/dates.js';
import { plantPhoto } from '../components/plant-row.js';
import { navigate } from '../router.js';

export function render(container) {
  const root = el('div');
  container.appendChild(root);
  const draw = () => {
    clear(root);
    drawContent(root, draw);
  };
  draw();
}

function drawContent(root, draw) {
  const { plants } = store.getSnapshot();
  const canEdit = isGardener();
  const wishes = plants.filter((p) => p.status === 'wishlist');

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'Wishlist'),
      el('span', { class: 'muted small' }, 'the jungle we dream of'),
    ),
  );

  if (!wishes.length) {
    root.appendChild(
      el(
        'div',
        { class: 'empty-state' },
        icon('leaf'),
        el('p', {}, 'No wishes right now — the jungle is complete. For now.'),
        canEdit
          ? el(
              'p',
              { class: 'small' },
              'Spotted something? Add it with status “wishlist” and note where you saw it.',
            )
          : null,
      ),
    );
    if (canEdit) {
      root.appendChild(el('a', { class: 'btn btn--primary', href: '#/add' }, icon('plus'), 'Add a wish'));
    }
    return;
  }

  for (const plant of wishes) {
    const care = effectiveCare(plant);
    const facts = [
      care.values.light,
      care.values.humidity,
      care.values.watering_days_summer ? `every ${care.values.watering_days_summer} d in summer` : null,
      care.values.toxic_to_pets ? 'toxic to pets' : null,
    ].filter(Boolean);

    root.appendChild(
      el(
        'div',
        { class: 'card wish-card' },
        el(
          'div',
          { class: 'wish-card__head' },
          plantPhoto(plant),
          el(
            'div',
            { class: 'plant-card__body' },
            el(
              'a',
              { class: 'plant-card__name', href: `#/plant/${encodeURIComponent(plant.id)}` },
              plant.name,
            ),
            plant.species && plant.species !== plant.name
              ? el('div', { class: 'small muted', style: 'font-style:italic' }, plant.species)
              : null,
            el(
              'div',
              { class: 'plant-card__meta' },
              facts.map((f) => el('span', {}, f)),
            ),
          ),
          canEdit
            ? el(
                'button',
                { class: 'btn btn--sm btn--primary', onclick: () => openGotIt(plant, draw) },
                'Got it! 🎉',
              )
            : null,
        ),
        plant.general_notes?.trim()
          ? el('div', { class: 'notes-rendered small', html: renderMarkdown(plant.general_notes) })
          : null,
      ),
    );
  }

  if (canEdit) {
    root.appendChild(
      el(
        'p',
        { class: 'small muted' },
        'To add a wish: ',
        el('a', { href: '#/add' }, 'new plant'),
        ' with status “wishlist” — note where you saw it and what it would need.',
      ),
    );
  }
}

/** The happy path: a wish becomes a real plant. */
function openGotIt(plant, draw) {
  const { plants } = store.getSnapshot();
  const rooms = [...new Set(plants.map((p) => p.location?.room).filter(Boolean))];
  const { close, body } = showSheet({ title: `${plant.name} — welcome home!` });

  const today = todayString();
  const dateInput = el('input', { type: 'date', value: today, max: today });
  const roomInput = el('input', {
    type: 'text',
    list: 'wish-room-list',
    value: plant.location?.room ?? '',
  });

  body.append(
    el('p', { class: 'small muted' }, 'This makes it an active plant — it joins Today and the Care table.'),
    formField('Acquired', dateInput),
    formField('Room', el('span', {},
      roomInput,
      el('datalist', { id: 'wish-room-list' }, rooms.map((r) => el('option', { value: r }))),
    )),
    el(
      'div',
      { class: 'sheet__actions' },
      el('button', { class: 'btn', onclick: () => close() }, 'Not yet'),
      el(
        'button',
        {
          class: 'btn btn--primary',
          onclick: () => {
            const changes = {
              status: 'active',
              acquired: dateInput.value || today,
            };
            const room = roomInput.value.trim();
            if (room) changes['location.room'] = room;
            store.patchPlant(plant.id, changes);
            close();
            navigate(`#/plant/${encodeURIComponent(plant.id)}`);
          },
        },
        'Plant it 🌱',
      ),
    ),
  );
  void draw;
}
