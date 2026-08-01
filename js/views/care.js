// Care view (MVP 2): every plant in a dense table — last/next watering,
// last feeding, light, room, status — with inline actions (water/feed/note)
// and quick edit of key values through the observed-layer sheet. Values are
// EFFECTIVE care; observed overrides carry a tappable marker. On narrow
// screens the same row models render as compact cards.

import * as store from '../store.js';
import { isGardener } from '../settings.js';
import { el, icon, clear, fmtRelativeDay, showSheet } from '../ui.js';
import { effectiveCare } from '../../shared/effective-care.js';
import { wateringStatus, lastEventOfType, compareUrgency } from '../../shared/schedule.js';
import { addDays, dayOf } from '../../shared/dates.js';
import { plantCard, stateChip, plantPhoto } from '../components/plant-row.js';
import { openCareEdit, explainOverride } from '../components/care-edit-sheet.js';
import { openEventDialog } from '../components/event-dialog.js';

const wideQuery = typeof window !== 'undefined' ? window.matchMedia('(min-width: 48rem)') : null;

/* ---------- filters (module state, reset on route change) ---------- */

const EMPTY_FILTERS = { q: '', room: '', sun: '', pets: '' };
let filters = { ...EMPTY_FILTERS };

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    filters = { ...EMPTY_FILTERS };
  });
}

function filtersActive() {
  return Boolean(filters.q || filters.room || filters.sun || filters.pets);
}

function matchesFilters(plant, care) {
  if (filters.q) {
    const hay = `${plant.name} ${plant.species ?? ''} ${plant.nickname ?? ''}`.toLowerCase();
    if (!hay.includes(filters.q.toLowerCase())) return false;
  }
  if (filters.room && (plant.location?.room ?? '') !== filters.room) return false;
  if (filters.sun && care.values.sun_need !== filters.sun) return false;
  if (filters.pets === 'safe' && care.values.toxic_to_pets) return false;
  if (filters.pets === 'toxic' && !care.values.toxic_to_pets) return false;
  return true;
}

/** Built once per mount — only the LIST redraws on change, so the search
 * box never loses focus mid-word. Returns { bar, resetBar }. */
function filterBar(plants, redraw) {
  const rooms = [...new Set(plants.map((p) => p.location?.room).filter(Boolean))].sort();
  const controls = [];
  const select = (label, get, set, options) => {
    const node = el(
      'select',
      {
        'aria-label': `Filter by ${label.toLowerCase()}`,
        onchange: (e) => {
          set(e.target.value);
          redraw();
        },
      },
      el('option', { value: '', selected: get() === '' }, label),
      options.map(([value, text]) => el('option', { value, selected: get() === value }, text)),
    );
    controls.push(node);
    return node;
  };
  const search = el('input', {
    type: 'search',
    placeholder: 'Search name, species, nickname…',
    'aria-label': 'Search plants',
    value: filters.q,
    oninput: (e) => {
      filters.q = e.target.value.trim();
      redraw();
    },
  });
  controls.push(search);
  const bar = el(
    'div',
    { class: 'filter-bar' },
    search,
    select('Room', () => filters.room, (v) => (filters.room = v), rooms.map((r) => [r, r])),
    select('Sun', () => filters.sun, (v) => (filters.sun = v), [
      ['low', 'low sun'],
      ['medium', 'medium sun'],
      ['high', 'high sun'],
    ]),
    select('Pets', () => filters.pets, (v) => (filters.pets = v), [
      ['safe', 'pet-safe'],
      ['toxic', 'toxic to pets'],
    ]),
  );
  const resetBar = () => {
    for (const node of controls) node.value = '';
  };
  return { bar, resetBar };
}

export function render(container) {
  const root = el('div');
  container.appendChild(root);

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'Care'),
      el('span', { class: 'muted small' }, `${store.currentSeason()} rhythm`),
    ),
  );
  const listRoot = el('div');
  let clearFilters = null;
  const draw = () => {
    clear(listRoot);
    drawContent(listRoot, draw, clearFilters);
  };
  const { bar, resetBar } = filterBar(
    store.getSnapshot().plants.filter((p) => p.status === 'active'),
    draw,
  );
  clearFilters = () => {
    filters = { ...EMPTY_FILTERS };
    resetBar();
    draw();
  };
  root.appendChild(bar);
  root.appendChild(listRoot);

  const onLayoutChange = () => draw();
  wideQuery?.addEventListener('change', onLayoutChange);
  const cleanupObserver = new MutationObserver(() => {
    if (!document.contains(root)) {
      wideQuery?.removeEventListener('change', onLayoutChange);
      cleanupObserver.disconnect();
    }
  });
  cleanupObserver.observe(document.getElementById('view'), { childList: true });
  draw();
}

/** One row model feeds both layouts — one gate, one source of truth. */
function rowModel(plant, events, today, season, pending, canEdit) {
  const status = wateringStatus(plant, events, today, season, { mode: store.scheduleMode() });
  const care = effectiveCare(plant);
  const seasonKey = season === 'summer' ? 'watering_days_summer' : 'watering_days_winter';
  const lastFeed = lastEventOfType(events, plant.id, 'feeding', today);
  const next =
    status?.lastWatering && status.interval ? addDays(status.lastWatering, status.interval) : null;

  const actions = canEdit
    ? [
        {
          iconName: 'water',
          label: 'Water',
          done: pending.has(plant.id),
          onClick: () => store.quickLog([plant.id], 'watering'),
        },
        {
          iconName: 'feeding',
          label: 'Feed',
          done: false,
          onClick: () => store.quickLog([plant.id], 'feeding'),
        },
        {
          iconName: 'note',
          label: 'Log / note',
          onClick: () => openEventDialog(plant, { type: 'note' }),
        },
      ]
    : [];

  return { plant, status, care, seasonKey, lastFeed, next, actions };
}

function observedMark(plant, key, field, canEdit) {
  if (field?.source !== 'observed') return null;
  return el(
    'button',
    {
      class: 'observed-mark',
      title: `Observed override — literature says ${field.reference ?? '—'}`,
      'aria-label': 'Observed override, tap for details',
      onclick: (e) => {
        e.stopPropagation();
        if (canEdit) openCareEdit(plant, key);
        else explainOverride(key, field);
      },
    },
    'o',
  );
}

function drawContent(root, draw, clearFilters) {
  const { plants, events } = store.getSnapshot();
  const today = store.today();
  const season = store.currentSeason();
  const canEdit = isGardener();
  const pending = store.pendingPlantIds('watering');

  const activeAll = plants.filter((p) => p.status === 'active');
  const visible = activeAll.filter((p) => matchesFilters(p, effectiveCare(p)));
  const active = visible
    .map((p) => rowModel(p, events, today, season, pending, canEdit))
    .sort(
      (a, b) => compareUrgency(a.status, b.status) || a.plant.name.localeCompare(b.plant.name),
    );
  const rest = plants.filter((p) => p.status !== 'active');

  if (!activeAll.length && !rest.length) {
    root.appendChild(
      el(
        'div',
        { class: 'empty-state' },
        icon('leaf'),
        el('p', {}, 'No plants yet.'),
        canEdit ? el('a', { class: 'btn btn--primary', href: '#/add' }, 'Add the first one') : null,
      ),
    );
    return;
  }

  if (filtersActive()) {
    root.appendChild(
      el(
        'p',
        { class: 'small muted' },
        `${visible.length} of ${activeAll.length} plants match. `,
        el('button', { class: 'btn btn--sm btn--ghost', onclick: () => clearFilters?.() }, 'Clear filters'),
      ),
    );
  }

  if (activeAll.length && !visible.length) {
    root.appendChild(
      el('div', { class: 'empty-state', style: 'padding: 1rem' }, icon('leaf'),
        el('p', {}, 'No plants match these filters.')),
    );
  }

  if (active.length) {
    if (wideQuery?.matches) {
      root.appendChild(renderTable(active, canEdit));
    } else {
      renderCards(root, active, canEdit);
    }
  }

  // Past & wished-for plants moved to their own page — the Care view stays
  // a chore list for active plants only.
  if (rest.length) {
    root.appendChild(
      el(
        'p',
        { class: 'small muted' },
        `${rest.length} more ${rest.length === 1 ? 'record lives' : 'records live'} in the `,
        el('a', { href: '#/encyclopedia' }, 'Encyclopedia'),
        ' — past plants and the wishlist.',
      ),
    );
  }
  void draw;
}

/* ---------------- desktop table ---------------- */

function renderTable(rows, canEdit) {
  const editableCell = (label, onClick, marker) =>
    canEdit
      ? el('span', {}, el('button', { class: 'editable-cell', onclick: onClick }, label), marker)
      : el('span', { class: 'num' }, label, marker);

  return el(
    'div',
    { class: 'care-table-wrap' },
    el(
      'table',
      { class: 'care-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ['Plant', 'Status', 'Watered', 'Next', 'Fed', 'Rhythm', 'Sun', 'Room', canEdit ? 'Actions' : null]
            .filter(Boolean)
            .map((h) => el('th', { scope: 'col' }, h)),
        ),
      ),
      el(
        'tbody',
        {},
        rows.map((row) => {
          const { plant, status, care, seasonKey, lastFeed, next, actions } = row;
          const intervalField = care.fields[seasonKey];
          const sunField = care.fields.sun_need;
          return el(
            'tr',
            {},
            el(
              'td',
              {},
              el(
                'a',
                {
                  class: 'plant-card__name',
                  href: `#/plant/${encodeURIComponent(plant.id)}`,
                  style: 'display:flex;align-items:center;gap:8px',
                },
                plantPhoto(plant, 'plant-card__photo'),
                el('span', {}, plant.name),
              ),
            ),
            el('td', {}, stateChip(status)),
            el('td', { class: 'num' }, fmtRelativeDay(status?.lastWatering)),
            el('td', { class: 'num' }, next ? fmtRelativeDay(next) : '—'),
            el('td', { class: 'num' }, lastFeed ? fmtRelativeDay(dayOf(lastFeed.date)) : 'never'),
            el(
              'td',
              {},
              editableCell(
                intervalField?.value ? `every ${intervalField.value} d` : '—',
                () => openCareEdit(plant, seasonKey),
                observedMark(plant, seasonKey, intervalField, canEdit),
              ),
            ),
            el(
              'td',
              {},
              editableCell(
                sunField?.value ?? '—',
                () => openCareEdit(plant, 'sun_need'),
                observedMark(plant, 'sun_need', sunField, canEdit),
              ),
            ),
            el('td', {}, plant.location?.room ?? '—'),
            canEdit
              ? el(
                  'td',
                  {},
                  el(
                    'div',
                    { class: 'plant-card__actions' },
                    actions.map((action) =>
                      el(
                        'button',
                        {
                          class: 'btn btn--icon btn--sm',
                          'aria-label': `${action.label}: ${plant.name}`,
                          title: action.label,
                          disabled: action.done,
                          onclick: action.onClick,
                        },
                        icon(action.done ? 'check' : action.iconName),
                      ),
                    ),
                  ),
                )
              : null,
          );
        }),
      ),
    ),
  );
}

/* ---------------- mobile cards ---------------- */

function renderCards(root, rows, canEdit) {
  for (const row of rows) {
    const { plant, status, care, seasonKey, lastFeed, actions } = row;
    const intervalField = care.fields[seasonKey];
    const meta = [
      status?.lastWatering ? `watered ${fmtRelativeDay(status.lastWatering)}` : 'never watered',
      lastFeed ? `fed ${fmtRelativeDay(dayOf(lastFeed.date))}` : 'never fed',
      plant.location?.room,
    ].filter(Boolean);

    const cardActions = canEdit
      ? [
          actions[0], // water
          actions[1], // feed
          {
            iconName: 'edit',
            label: 'More',
            onClick: () => openMoreSheet(plant, row),
          },
        ]
      : [];

    const card = plantCard(plant, { status, meta, canEdit, actions: cardActions });

    // Effective rhythm with its override marker, tappable like a table cell.
    const rhythm = el(
      'span',
      {},
      intervalField?.value ? `every ${intervalField.value} d` : 'no rhythm',
      observedMark(plant, seasonKey, intervalField, canEdit),
    );
    card.querySelector('.plant-card__meta')?.appendChild(rhythm);
    root.appendChild(card);
  }
}

/** Overflow sheet on mobile: log + the quick-editable values in one place. */
function openMoreSheet(plant, row) {
  const { close, body } = showSheet({ title: plant.name });
  const item = (label, fn) =>
    el(
      'button',
      {
        class: 'btn',
        style: 'width:100%;justify-content:flex-start;margin-bottom:8px',
        onclick: () => {
          close();
          fn();
        },
      },
      label,
    );
  body.append(
    item('Log an event…', () => openEventDialog(plant, { type: 'note' })),
    item('Edit watering rhythm (summer)', () => openCareEdit(plant, 'watering_days_summer')),
    item('Edit watering rhythm (winter)', () => openCareEdit(plant, 'watering_days_winter')),
    item('Edit sun need', () => openCareEdit(plant, 'sun_need')),
    item('Edit feeding (summer)', () => openCareEdit(plant, 'feeding_summer')),
    item('Edit feeding (winter)', () => openCareEdit(plant, 'feeding_winter')),
    item('Open profile', () => {
      window.location.hash = `#/plant/${encodeURIComponent(plant.id)}`;
    }),
  );
  void row;
}
