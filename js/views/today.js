// Today view (MVP 1 & 3): warnings panel on top, plants sorted by watering
// urgency, one-tap watering with undo, and multi-select ("I watered these 6").

import * as store from '../store.js';
import { isGardener } from '../settings.js';
import { el, icon, clear } from '../ui.js';
import { getWarnings } from '../../shared/warnings.js';
import { monthTasks } from '../../shared/calendar.js';
import { monthOf } from '../../shared/dates.js';
import { wateringStatus, compareUrgency } from '../../shared/schedule.js';
import { warningList } from '../components/warning-list.js';
import { plantCard, wateringMeta } from '../components/plant-row.js';

// Selection lives in memory only; navigating away cancels it (safe: nothing
// has been logged until "Water N" is confirmed, and the bar's count makes an
// accidental exit obvious).
let selecting = false;
let selectedIds = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    selecting = false;
    selectedIds = new Set();
  });
}

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
  const { plants, events, plantsById } = store.getSnapshot();
  const today = store.today();
  const season = store.currentSeason();
  const canEdit = isGardener();
  const pending = store.pendingPlantIds();

  const active = plants.filter((p) => p.status === 'active');
  const entries = active
    .map((plant) => ({ plant, status: wateringStatus(plant, events, today, season) }))
    .sort(
      (a, b) => compareUrgency(a.status, b.status) || a.plant.name.localeCompare(b.plant.name),
    );

  const attention = entries.filter((e) => ['overdue', 'due', 'soon'].includes(e.status.state));
  const unknown = entries.filter((e) => e.status.state === 'unknown');
  const fine = entries.filter((e) => e.status.state === 'fine');

  /* ---- header ---- */
  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'Today'),
      el(
        'span',
        { class: 'muted small', title: 'Season used for watering rhythms' },
        season === 'summer' ? 'summer rhythm' : 'winter rhythm',
      ),
    ),
  );

  /* ---- warnings panel ---- */
  const panel = warningList(getWarnings({ plants, events, today, season }), plantsById);
  if (panel) root.appendChild(panel);

  /* ---- this-month teaser (seasonal calendar) ---- */
  const tasks = monthTasks(monthOf(today), plants);
  if (tasks.length) {
    root.appendChild(
      el(
        'a',
        { class: 'month-teaser', href: '#/calendar' },
        icon('calendar'),
        el(
          'span',
          { class: 'month-teaser__text' },
          el('strong', {}, tasks[0].title),
          el('span', { class: 'muted' }, ` — ${tasks[0].detail}`),
        ),
        el('span', { class: 'month-teaser__more small' }, 'month by month'),
      ),
    );
  }

  /* ---- empty garden ---- */
  if (!active.length) {
    root.appendChild(
      el(
        'div',
        { class: 'empty-state' },
        icon('leaf'),
        el('p', {}, 'No active plants yet.'),
        canEdit
          ? el('a', { class: 'btn btn--primary', href: '#/add' }, 'Add your first plant')
          : el('p', { class: 'small' }, 'The gardeners have not planted anything here yet.'),
      ),
    );
    return;
  }

  /* ---- multi-select toggle ---- */
  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h2', {}, 'Watering round'),
      canEdit
        ? el(
            'button',
            {
              class: `btn btn--sm${selecting ? ' btn--primary' : ''}`,
              onclick: () => {
                selecting = !selecting;
                selectedIds = new Set();
                draw();
              },
            },
            selecting ? 'Cancel selection' : 'Select several',
          )
        : null,
    ),
  );

  /* ---- plant groups ---- */
  const card = ({ plant, status }) =>
    plantCard(plant, {
      status,
      meta: wateringMeta(status),
      canEdit,
      selectable: selecting,
      selected: selectedIds.has(plant.id),
      onToggle: (id) => {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        draw();
      },
      actions: [
        {
          iconName: 'water',
          label: 'Water',
          done: pending.has(plant.id),
          onClick: () => store.quickLog([plant.id], 'watering'),
        },
      ],
    });

  const group = (title, list, note) => {
    if (!list.length) return;
    root.appendChild(
      el(
        'div',
        { class: 'section-title' },
        el('h3', {}, title),
        note ? el('span', { class: 'muted small' }, note) : null,
      ),
    );
    list.forEach((entry) => root.appendChild(card(entry)));
  };

  if (attention.length) {
    attention.forEach((entry) => root.appendChild(card(entry)));
  } else {
    root.appendChild(
      el(
        'div',
        { class: 'empty-state', style: 'padding: 1rem' },
        icon('check'),
        el('p', {}, 'All caught up — nobody is thirsty right now.'),
      ),
    );
  }
  group(
    'No log yet',
    unknown.filter((e) => e.status.reason === 'never-watered'),
    'log a first watering to start the rhythm',
  );
  group(
    'No rhythm set',
    unknown.filter((e) => e.status.reason === 'no-interval'),
    'set watering days in Care to start the schedule',
  );
  group('Doing fine', fine);

  /* ---- selection action bar ---- */
  if (selecting && canEdit) {
    const noteInput = el('input', {
      type: 'text',
      placeholder: 'Optional note for all…',
      'aria-label': 'Optional note for the whole round',
    });
    root.appendChild(
      el(
        'div',
        { class: 'select-bar' },
        noteInput,
        el(
          'button',
          {
            class: 'btn btn--primary',
            disabled: selectedIds.size === 0,
            onclick: () => {
              const ids = [...selectedIds];
              const note = noteInput.value.trim() || null;
              selecting = false;
              selectedIds = new Set();
              store.quickLog(ids, 'watering', { note });
              draw();
            },
          },
          selectedIds.size ? `Water ${selectedIds.size}` : 'Water',
        ),
      ),
    );
  }
}
