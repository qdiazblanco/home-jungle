// Plant profile (MVP 4 & 6): photo, full care profile with reference vs
// observed side by side, substrate recipe, location, markdown notes, event
// history in reverse chronological order — everything editable in place in
// gardener mode.

import * as store from '../store.js';
import { isGardener } from '../settings.js';
import {
  el,
  icon,
  clear,
  fmtDay,
  fmtRelativeDay,
  fmtDateTime,
  confirmDialog,
  showSheet,
} from '../ui.js';
import { effectiveCare } from '../../shared/effective-care.js';
import { wateringStatus } from '../../shared/schedule.js';
import { renderMarkdown } from '../../shared/markdown.js';
import { dayOf } from '../../shared/dates.js';
import { plantPhoto, stateChip } from '../components/plant-row.js';
import { openCareEdit, QUICK_PARAMS } from '../components/care-edit-sheet.js';
import { openEventDialog } from '../components/event-dialog.js';

const EVENT_ICONS = {
  watering: 'water',
  feeding: 'feeding',
  repotting: 'repotting',
  pruning: 'pruning',
  misting: 'misting',
  treatment: 'treatment',
  cutting: 'cutting',
  note: 'note',
  photo: 'photo',
};

const CARE_ROWS = [
  ['light', 'Light'],
  ['sun_need', 'Sun need'],
  ['watering_days_summer', 'Watering · summer'],
  ['watering_days_winter', 'Watering · winter'],
  ['humidity', 'Humidity'],
  ['feeding', 'Feeding'],
  ['toxic_to_pets', 'Toxic to pets'],
];

export function render(container, params) {
  const root = el('div');
  container.appendChild(root);
  const draw = () => {
    clear(root);
    drawContent(root, params.id, draw);
  };
  draw();
}

const fmtCareValue = (key, value) => {
  if (value === undefined || value === null || value === '') return '—';
  if (key.startsWith('watering_days')) return `every ${value} days`;
  if (key === 'toxic_to_pets') return value ? 'yes — keep away from pets' : 'no';
  return String(value);
};

function drawContent(root, id, draw) {
  const { plants, events, plantsById } = store.getSnapshot();
  const plant = plantsById.get(id);
  const canEdit = isGardener();

  if (!plant) {
    root.appendChild(
      el(
        'div',
        { class: 'empty-state' },
        icon('leaf'),
        el('p', {}, 'This plant is not in the encyclopedia.'),
        el('a', { class: 'btn', href: '#/' }, 'Back to Today'),
      ),
    );
    return;
  }

  const today = store.today();
  const season = store.currentSeason();
  const status = wateringStatus(plant, events, today, season);
  const care = effectiveCare(plant);
  const pending = store.pendingPlantIds();

  /* ---------- header ---------- */

  root.appendChild(
    el('a', { class: 'btn btn--ghost btn--sm', href: '#/care' }, icon('back'), 'All plants'),
  );

  root.appendChild(
    el(
      'div',
      { class: 'profile-head' },
      plantPhoto(plant, 'profile-head__photo'),
      el(
        'div',
        {},
        el('h1', {}, plant.name),
        el('p', { class: 'species' }, plant.species ?? ''),
        plant.nickname ? el('p', { class: 'muted small' }, `a.k.a. “${plant.nickname}”`) : null,
        el(
          'div',
          { class: 'plant-card__meta' },
          el('span', { class: `status-badge status-badge--${plant.status}` }, plant.status),
          status ? stateChip(status) : null,
        ),
      ),
    ),
  );

  /* ---------- quick facts ---------- */

  const facts = [];
  if (plant.location?.room) {
    facts.push(
      `${plant.location.room}${plant.location.orientation ? ` · ${plant.location.orientation}-facing` : ''}${
        plant.location.detail ? ` · ${plant.location.detail}` : ''
      }`,
    );
  }
  if (plant.acquired) facts.push(`with us since ${fmtDay(plant.acquired, { withYear: 'always' })}`);
  const parent = plant.parent ? plantsById.get(plant.parent) : null;
  const children = plants.filter((p) => p.parent === plant.id);

  root.appendChild(
    el(
      'div',
      { class: 'card' },
      facts.map((f) => el('p', { class: 'small', style: 'margin-bottom:4px' }, f)),
      parent
        ? el(
            'p',
            { class: 'small', style: 'margin-bottom:4px' },
            'cutting from ',
            el('a', { href: `#/plant/${encodeURIComponent(parent.id)}` }, parent.name),
          )
        : null,
      children.length
        ? el(
            'p',
            { class: 'small', style: 'margin-bottom:0' },
            'cuttings taken: ',
            children.flatMap((child, i) => [
              i ? ', ' : '',
              el('a', { href: `#/plant/${encodeURIComponent(child.id)}` }, child.name),
            ]),
          )
        : null,
    ),
  );

  /* ---------- actions ---------- */

  if (canEdit && plant.status === 'active') {
    root.appendChild(
      el(
        'div',
        { class: 'sheet__actions', style: 'margin: 0 0 1rem' },
        el(
          'button',
          {
            class: 'btn btn--primary',
            disabled: pending.has(plant.id),
            onclick: () => store.quickLog([plant.id], 'watering'),
          },
          icon('water'),
          pending.has(plant.id) ? 'Watered ✓' : 'Water now',
        ),
        el(
          'button',
          { class: 'btn', onclick: () => openEventDialog(plant, { type: 'note' }) },
          icon('note'),
          'Log event',
        ),
        el(
          'a',
          { class: 'btn', href: `#/plant/${encodeURIComponent(plant.id)}/edit` },
          icon('edit'),
          'Edit',
        ),
      ),
    );
  } else if (canEdit) {
    root.appendChild(
      el(
        'div',
        { class: 'sheet__actions', style: 'margin: 0 0 1rem' },
        el(
          'button',
          { class: 'btn', onclick: () => openEventDialog(plant, { type: 'note' }) },
          icon('note'),
          'Log event',
        ),
        el(
          'a',
          { class: 'btn', href: `#/plant/${encodeURIComponent(plant.id)}/edit` },
          icon('edit'),
          'Edit',
        ),
      ),
    );
  }

  /* ---------- care profile: reference vs observed ---------- */

  root.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Care')));
  const careCard = el('div', { class: 'card' });

  for (const [key, label] of CARE_ROWS) {
    const field = care.fields[key];
    if (!field || (field.value === undefined && field.reference === undefined)) continue;
    const overridden = field.source === 'observed';

    const valueCell = el(
      'div',
      { class: 'care-param__value' },
      el(
        'div',
        {},
        el('strong', { class: 'num' }, fmtCareValue(key, field.value)),
        overridden
          ? el('span', { class: 'observed-mark', title: 'Observed override', 'aria-hidden': 'true' }, 'o')
          : null,
      ),
      overridden && field.reference !== undefined
        ? el(
            'div',
            { class: 'care-param__compare' },
            `Literature: ${fmtCareValue(key, field.reference)} · Ours: ${fmtCareValue(key, field.observed)}`,
          )
        : null,
      field.note ? el('div', { class: 'care-param__note' }, `“${field.note}”`) : null,
    );

    const row = el(
      'div',
      { class: 'care-param' },
      el('span', { class: 'care-param__label' }, label),
      canEdit && QUICK_PARAMS[key]
        ? el(
            'button',
            {
              class: 'editable-cell',
              style: 'text-align:right',
              'aria-label': `Edit ${label}`,
              onclick: () => openCareEdit(plant, key),
            },
            valueCell,
          )
        : valueCell,
    );
    careCard.appendChild(row);
  }

  if (care.values.source) {
    careCard.appendChild(
      el(
        'div',
        { class: 'care-param' },
        el('span', { class: 'care-param__label' }, 'Reference source'),
        el('span', { class: 'care-param__value small muted' }, String(care.values.source)),
      ),
    );
  }
  root.appendChild(careCard);

  if (canEdit) {
    root.appendChild(
      el(
        'p',
        { class: 'small muted' },
        'Tap a value to record what works in our house — the literature value is never overwritten.',
      ),
    );
  }

  /* ---------- substrate ---------- */

  const recipe = care.values.substrate_recipe;
  if (Array.isArray(recipe) && recipe.length) {
    root.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Substrate mix')));
    root.appendChild(
      el(
        'div',
        { class: 'card' },
        recipe.map((part) =>
          el(
            'div',
            { class: 'care-param' },
            el('span', {}, part.component),
            el('strong', { class: 'num' }, part.ratio),
          ),
        ),
      ),
    );
  }

  /* ---------- notes (markdown) ---------- */

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h2', {}, 'Notebook'),
      canEdit
        ? el('button', { class: 'btn btn--sm', onclick: () => editNotes(plant, draw) }, 'Edit notes')
        : null,
    ),
  );
  root.appendChild(
    el(
      'div',
      { class: 'card notes-rendered' },
      plant.general_notes?.trim()
        ? el('div', { html: renderMarkdown(plant.general_notes) })
        : el('p', { class: 'muted small' }, 'No notes yet — the story starts here.'),
    ),
  );

  /* ---------- history ---------- */

  const history = events
    .filter((e) => e.plantId === plant.id)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h2', {}, 'History'),
      el('span', { class: 'muted small' }, `${history.length} entries`),
    ),
  );

  const historyCard = el('div', { class: 'card' });
  if (!history.length) {
    historyCard.appendChild(el('p', { class: 'muted small' }, 'Nothing logged yet.'));
  }
  for (const event of history) {
    historyCard.appendChild(
      el(
        'div',
        { class: 'event-item' },
        el('span', { class: 'event-item__icon' }, icon(EVENT_ICONS[event.type] ?? 'note')),
        el(
          'div',
          { class: 'event-item__body' },
          el(
            'div',
            {},
            el('strong', {}, event.type),
            el('span', { class: 'muted' }, ` · ${fmtRelativeDay(dayOf(event.date))}`),
          ),
          el('div', { class: 'event-item__meta' }, `${fmtDateTime(event.date)} — ${event.author ?? '?'}`),
          event.note ? el('div', { class: 'small' }, event.note) : null,
        ),
        canEdit
          ? el(
              'button',
              {
                class: 'btn btn--icon btn--ghost',
                'aria-label': 'Delete this entry',
                title: 'Delete this entry',
                onclick: async () => {
                  const sure = await confirmDialog({
                    title: 'Delete this log entry?',
                    message: `${event.type} on ${fmtDateTime(event.date)} will be removed from the history.`,
                    confirmLabel: 'Delete',
                    danger: true,
                  });
                  if (sure) store.removeEvent(event.id);
                },
              },
              icon('trash'),
            )
          : null,
      ),
    );
  }
  root.appendChild(historyCard);
}

/* ---------- notes editor (textarea + preview toggle) ---------- */

function editNotes(plant, draw) {
  const { close, body } = showSheet({ title: `Notes — ${plant.name}` });
  const textarea = el('textarea', { rows: '10', style: 'width:100%' });
  textarea.value = plant.general_notes ?? '';
  const preview = el('div', { class: 'notes-rendered', style: 'display:none' });

  const toggle = el(
    'button',
    {
      class: 'btn btn--sm',
      onclick: () => {
        const showingPreview = preview.style.display !== 'none';
        if (showingPreview) {
          preview.style.display = 'none';
          textarea.style.display = '';
          toggle.textContent = 'Preview';
        } else {
          preview.innerHTML = renderMarkdown(textarea.value);
          preview.style.display = '';
          textarea.style.display = 'none';
          toggle.textContent = 'Write';
        }
      },
    },
    'Preview',
  );

  body.append(
    el(
      'p',
      { class: 'small muted' },
      'Markdown: **bold**, *italic*, `code`, - lists, ## headings, [links](https://…).',
    ),
    textarea,
    preview,
    el(
      'div',
      { class: 'sheet__actions' },
      toggle,
      el('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
      el(
        'button',
        {
          class: 'btn btn--primary',
          onclick: () => {
            store.patchPlant(plant.id, { general_notes: textarea.value });
            close();
            draw();
          },
        },
        'Save notes',
      ),
    ),
  );
}
