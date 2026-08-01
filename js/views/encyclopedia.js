// Encyclopedia: every plant we keep, kept, or dream of — one page of
// records split by an honest badge: "I want it" (wishlist) and "I got it"
// (everything that ever came home, including gifted and deceased entries).
// Replaces the old Wishlist tab; the celebratory "Got it!" flow lives on
// here. The Care view stays a chore list for active plants only.

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

function badge(kind) {
  return kind === 'want'
    ? el('span', { class: 'enc-badge enc-badge--want' }, icon('star'), 'I want it')
    : el('span', { class: 'enc-badge enc-badge--got' }, icon('check'), 'I got it');
}

function plantEntry(plant, { canEdit, draw }) {
  const care = effectiveCare(plant);
  const facts = [
    care.values.light,
    care.values.humidity,
    care.values.watering_days_summer ? `every ${care.values.watering_days_summer} d in summer` : null,
    care.values.toxic_to_pets ? 'toxic to pets' : null,
  ].filter(Boolean);
  const wished = plant.status === 'wishlist';

  return el(
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
          badge(wished ? 'want' : 'got'),
          plant.status !== 'active' && !wished
            ? el('span', { class: `status-badge status-badge--${plant.status}` }, plant.status)
            : null,
          facts.map((f) => el('span', {}, f)),
        ),
      ),
      wished && canEdit
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
  );
}

function drawContent(root, draw) {
  const { plants } = store.getSnapshot();
  const canEdit = isGardener();

  const wishes = plants
    .filter((p) => p.status === 'wishlist')
    .sort((a, b) => a.name.localeCompare(b.name));
  const STATUS_ORDER = { active: 0, gifted: 1, deceased: 2 };
  const got = plants
    .filter((p) => p.status !== 'wishlist')
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) ||
        a.name.localeCompare(b.name),
    );

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'Encyclopedia'),
      el('span', { class: 'muted small' }, 'the jungle we have & the jungle we dream of'),
    ),
  );

  if (!wishes.length && !got.length) {
    root.appendChild(
      el(
        'div',
        { class: 'empty-state' },
        icon('leaf'),
        el('p', {}, 'The encyclopedia is empty — every jungle starts with one plant.'),
        canEdit ? el('a', { class: 'btn btn--primary', href: '#/add' }, 'Add the first one') : null,
      ),
    );
    return;
  }

  /* ---- I want it ---- */
  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h2', {}, 'I want it'),
      el('span', { class: 'muted small' }, 'spotted, coveted, not home yet'),
    ),
  );
  if (wishes.length) {
    for (const plant of wishes) root.appendChild(plantEntry(plant, { canEdit, draw }));
  } else {
    root.appendChild(
      el('p', { class: 'small muted' }, 'No wishes right now — the jungle is complete. For now.'),
    );
  }
  if (canEdit) {
    root.appendChild(
      el(
        'p',
        { class: 'small muted' },
        'Spotted something? ',
        el('a', { href: '#/add' }, 'Add it'),
        ' with status “wishlist” and note where you saw it.',
      ),
    );
  }

  /* ---- I got it ---- */
  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h2', {}, 'I got it'),
      el('span', { class: 'muted small' }, `${got.length} in the records`),
    ),
  );
  for (const plant of got) root.appendChild(plantEntry(plant, { canEdit, draw }));
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
