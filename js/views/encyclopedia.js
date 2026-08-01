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

/* search + badge + care filters (module state, reset on route change) */
const EMPTY_ENC_FILTERS = { q: '', which: 'all', room: '', sun: '', pets: '' };
let encFilters = { ...EMPTY_ENC_FILTERS }; // which: 'all' | 'got' | 'want'

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    encFilters = { ...EMPTY_ENC_FILTERS };
  });
}

function encFiltersActive() {
  return Boolean(encFilters.q || encFilters.room || encFilters.sun || encFilters.pets);
}

export function render(container) {
  const root = el('div');
  container.appendChild(root);

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'Encyclopedia'),
      el('span', { class: 'muted small' }, 'the jungle we have & the jungle we dream of'),
    ),
  );

  const listRoot = el('div');
  const draw = () => {
    clear(listRoot);
    drawContent(listRoot, draw);
  };

  // Persistent bar: only the list redraws, so typing keeps focus.
  const whichSeg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Show' });
  const drawWhich = () => {
    whichSeg.textContent = '';
    for (const [value, label] of [['all', 'All'], ['got', 'I got it'], ['want', 'I want it']]) {
      whichSeg.appendChild(
        el(
          'button',
          {
            'aria-pressed': String(encFilters.which === value),
            onclick: () => {
              encFilters.which = value;
              drawWhich();
              draw();
            },
          },
          label,
        ),
      );
    }
  };
  drawWhich();
  const rooms = [
    ...new Set(store.getSnapshot().plants.map((p) => p.location?.room).filter(Boolean)),
  ].sort();
  const select = (label, get, set, options) =>
    el(
      'select',
      {
        'aria-label': `Filter by ${label.toLowerCase()}`,
        onchange: (e) => {
          set(e.target.value);
          draw();
        },
      },
      el('option', { value: '', selected: get() === '' }, label),
      options.map(([value, text]) => el('option', { value, selected: get() === value }, text)),
    );
  root.appendChild(
    el(
      'div',
      { class: 'filter-bar' },
      el('input', {
        type: 'search',
        placeholder: 'Search name, species, notes…',
        'aria-label': 'Search the encyclopedia',
        value: encFilters.q,
        oninput: (e) => {
          encFilters.q = e.target.value.trim();
          draw();
        },
      }),
      whichSeg,
      select('Room', () => encFilters.room, (v) => (encFilters.room = v), rooms.map((r) => [r, r])),
      select('Sun', () => encFilters.sun, (v) => (encFilters.sun = v), [
        ['low', 'low sun'],
        ['medium', 'medium sun'],
        ['high', 'high sun'],
      ]),
      select('Pets', () => encFilters.pets, (v) => (encFilters.pets = v), [
        ['safe', 'pet-safe'],
        ['toxic', 'toxic to pets'],
      ]),
    ),
  );
  root.appendChild(listRoot);
  draw();
}

function matchesSearch(plant) {
  if (encFilters.q) {
    const hay = `${plant.name} ${plant.species ?? ''} ${plant.nickname ?? ''} ${plant.general_notes ?? ''}`.toLowerCase();
    if (!hay.includes(encFilters.q.toLowerCase())) return false;
  }
  if (encFilters.room && (plant.location?.room ?? '') !== encFilters.room) return false;
  if (encFilters.sun || encFilters.pets) {
    const care = effectiveCare(plant);
    if (encFilters.sun && care.values.sun_need !== encFilters.sun) return false;
    if (encFilters.pets === 'safe' && care.values.toxic_to_pets) return false;
    if (encFilters.pets === 'toxic' && !care.values.toxic_to_pets) return false;
  }
  return true;
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
    .filter((p) => p.status === 'wishlist' && matchesSearch(p))
    .sort((a, b) => a.name.localeCompare(b.name));
  const STATUS_ORDER = { active: 0, gifted: 1, deceased: 2 };
  const got = plants
    .filter((p) => p.status !== 'wishlist' && matchesSearch(p))
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) ||
        a.name.localeCompare(b.name),
    );

  // Emptiness is judged on what the current segment SHOWS — matches hidden
  // behind the other tab must be pointed at, not silently swallowed.
  const visibleEmpty =
    encFilters.which === 'want'
      ? !wishes.length
      : encFilters.which === 'got'
        ? !got.length
        : !wishes.length && !got.length;
  if (encFiltersActive() && visibleEmpty) {
    const hiddenCount = encFilters.which === 'want' ? got.length : wishes.length;
    const hiddenLabel = encFilters.which === 'want' ? 'I got it' : 'I want it';
    root.appendChild(
      el(
        'div',
        { class: 'empty-state', style: 'padding: 1rem' },
        icon('leaf'),
        el('p', {}, 'Nothing here matches those filters.'),
        encFilters.which !== 'all' && hiddenCount
          ? el(
              'p',
              { class: 'small' },
              `${hiddenCount} ${hiddenCount === 1 ? 'match is' : 'matches are'} under “${hiddenLabel}”.`,
            )
          : null,
      ),
    );
    return;
  }

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
  if (encFilters.which !== 'got') {
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
        el(
          'p',
          { class: 'small muted' },
          encFiltersActive()
            ? 'No wishes match those filters.'
            : 'No wishes right now — the jungle is complete. For now.',
        ),
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
  }

  /* ---- I got it ---- */
  if (encFilters.which !== 'want') {
    root.appendChild(
      el(
        'div',
        { class: 'section-title' },
        el('h2', {}, 'I got it'),
        el('span', { class: 'muted small' }, `${got.length} in the records`),
      ),
    );
    if (got.length) {
      for (const plant of got) root.appendChild(plantEntry(plant, { canEdit, draw }));
    } else {
      root.appendChild(
        el(
          'p',
          { class: 'small muted' },
          encFiltersActive() ? 'Nothing you own matches those filters.' : 'No records yet.',
        ),
      );
    }
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
