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
  formField,
} from '../ui.js';
import { effectiveCare } from '../../shared/effective-care.js';
import { wateringStatus } from '../../shared/schedule.js';
import { renderMarkdown } from '../../shared/markdown.js';
import { dayOf, todayString } from '../../shared/dates.js';
import { plantPhoto, stateChip } from '../components/plant-row.js';
import { ensureAuthor } from '../components/author-gate.js';
import { uniquePlantId } from '../slug.js';
import { navigate } from '../router.js';
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
          'button',
          { class: 'btn', onclick: () => openCuttingSheet(plant) },
          icon('cutting'),
          'Cutting',
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

  /* ---------- family line (propagation) ---------- */

  if (parent || children.length) {
    root.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Family line')));
    const familyCard = el('div', { class: 'card' });
    familyCard.appendChild(renderFamilyNode(findFamilyRoot(plant, plantsById), plants, plant.id));
    root.appendChild(familyCard);
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

/* ---------- propagation ---------- */

/** Walk up the parent chain to the family's founding plant (cycle-safe). */
function findFamilyRoot(plant, plantsById) {
  let root = plant;
  const seen = new Set([plant.id]);
  while (root.parent && plantsById.has(root.parent) && !seen.has(root.parent)) {
    root = plantsById.get(root.parent);
    seen.add(root.id);
  }
  return root;
}

function renderFamilyNode(node, plants, currentId) {
  const children = plants.filter((p) => p.parent === node.id);
  return el(
    'div',
    { class: `tree-node${node.id === currentId ? ' tree-node--current' : ''}` },
    el(
      'div',
      { class: 'tree-node__label' },
      icon(node.parent ? 'cutting' : 'leaf'),
      node.id === currentId
        ? el('strong', {}, node.name)
        : el('a', { href: `#/plant/${encodeURIComponent(node.id)}` }, node.name),
      node.status !== 'active'
        ? el('span', { class: `status-badge status-badge--${node.status}` }, node.status)
        : null,
      node.acquired ? el('span', { class: 'small muted num' }, fmtDay(node.acquired, { withYear: 'always' })) : null,
    ),
    children.length
      ? el('div', { class: 'tree-children' }, children.map((c) => renderFamilyNode(c, plants, currentId)))
      : null,
  );
}

/** "Take a cutting": one flow logs the cutting event on the mother and
 * creates the child plant with `parent` set and the mother's reference
 * care copied over (observed starts empty — the child earns its own). */
async function openCuttingSheet(mother) {
  if (!(await ensureAuthor())) return;
  const { plants, plantsById } = store.getSnapshot();
  const rooms = [...new Set(plants.map((p) => p.location?.room).filter(Boolean))];

  const { close, body } = showSheet({ title: `Take a cutting — ${mother.name}` });
  const nameInput = el('input', { type: 'text', value: `${mother.name} cutting` });
  const roomInput = el('input', { type: 'text', list: 'cutting-room-list', value: mother.location?.room ?? '' });
  const noteInput = el('input', { type: 'text', placeholder: 'Optional note (node count, method…)' });

  body.append(
    el('p', { class: 'small muted' },
      'Logs a cutting event on the mother and creates the child plant, linked as family.'),
    formField('Child plant name', nameInput),
    formField('Room', el('span', {},
      roomInput,
      el('datalist', { id: 'cutting-room-list' }, rooms.map((r) => el('option', { value: r }))),
    )),
    formField('Note', noteInput),
    el(
      'div',
      { class: 'sheet__actions' },
      el('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
      el(
        'button',
        {
          class: 'btn btn--primary',
          onclick: () => {
            const name = nameInput.value.trim() || `${mother.name} cutting`;
            const id = uniquePlantId(name, plantsById);
            const today = todayString();
            const child = {
              id,
              name,
              species: mother.species ?? '',
              nickname: null,
              location: {
                room: roomInput.value.trim() || mother.location?.room || '',
                orientation: '',
                detail: '',
              },
              photo: null,
              acquired: today,
              parent: mother.id,
              care: {
                reference: structuredClone(mother.care?.reference ?? {}),
                observed: {},
              },
              general_notes: `Cutting taken from ${mother.name}.`,
              status: 'active',
            };
            store.createPlant(child);
            store.logEvent(mother.id, 'cutting', {
              note: noteInput.value.trim() || `Cutting taken → ${name}`,
            });
            close();
            navigate(`#/plant/${encodeURIComponent(id)}`);
          },
        },
        'Take the cutting ✂️',
      ),
    ),
  );
}
