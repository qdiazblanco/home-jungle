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
import { wateringStatus, lastEventOfType } from '../../shared/schedule.js';
import { renderMarkdown } from '../../shared/markdown.js';
import { dayOf, todayString } from '../../shared/dates.js';
import { plantPhoto, stateChip } from '../components/plant-row.js';
import { ensureAuthor, KNOWN_GARDENERS } from '../components/author-gate.js';
import { repotPlan } from '../../shared/pot.js';
import { uniquePlantId } from '../slug.js';
import { navigate } from '../router.js';
import { openCareEdit, QUICK_PARAMS } from '../components/care-edit-sheet.js';
import { openEventDialog } from '../components/event-dialog.js';
import { FURNITURE_KINDS } from './map.js';

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

/** Care rows; legacy single 'feeding' shows only when no seasonal split exists. */
function careRowsFor(fields) {
  const seasonalFeeding = fields.feeding_summer || fields.feeding_winter;
  return [
    ['light', 'Light'],
    ['sun_need', 'Sun need'],
    ['watering_days_summer', 'Watering · summer'],
    ['watering_days_winter', 'Watering · winter'],
    ['humidity', 'Humidity'],
    ...(seasonalFeeding
      ? [
          ['feeding_summer', 'Feeding · summer'],
          ['feeding_winter', 'Feeding · winter'],
        ]
      : [['feeding', 'Feeding']]),
    ['toxic_to_pets', 'Toxic to pets'],
  ];
}

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
  const potDiameter = Number(plant.pot?.diameter_cm) || null;
  const potBase = Number(plant.pot?.base_diameter_cm) || null;
  if (potDiameter) {
    facts.push(potBase ? `${potDiameter} cm pot (${potBase} cm at the base)` : `${potDiameter} cm pot`);
  }

  /* spot in the house (furniture placement, lives in house.json) */
  const { house } = store.getSnapshot();
  const plantRoomKey = String(plant.location?.room ?? '').trim().toLowerCase();
  const houseRoom = (house.rooms ?? []).find(
    (room) => String(room.name ?? '').trim().toLowerCase() === plantRoomKey,
  );
  const roomFurniture = houseRoom
    ? (house.furniture ?? []).filter(
        (piece) => piece.roomId === houseRoom.id && FURNITURE_KINDS[piece.kind],
      )
    : [];
  const placedOn = roomFurniture.find((piece) => piece.id === house.placements?.[plant.id]);
  if (placedOn) {
    facts.push(`on the ${FURNITURE_KINDS[placedOn.kind].label.toLowerCase()} (house map)`);
  }
  if (plant.status === 'active') {
    const lastRepot = lastEventOfType(events, plant.id, 'repotting', today);
    facts.push(
      lastRepot
        ? `last repotted ${fmtRelativeDay(dayOf(lastRepot.date))}`
        : 'never repotted (in our log)',
    );
  }
  const parent = plant.parent ? plantsById.get(plant.parent) : null;
  const children = plants.filter((p) => p.parent === plant.id);

  root.appendChild(
    el(
      'div',
      { class: 'card' },
      facts.map((f) => el('p', { class: 'small', style: 'margin-bottom:4px' }, f)),
      canEdit && plant.status === 'active' && roomFurniture.length
        ? el(
            'button',
            {
              class: 'btn btn--sm',
              style: 'margin-top: 4px',
              onclick: () => openSpotSheet(plant, house, roomFurniture, placedOn, draw),
            },
            icon('mapIcon'),
            placedOn ? 'Move its spot' : 'Place on furniture',
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

  for (const [key, label] of careRowsFor(care.fields)) {
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

  /* ---------- substrate: current (observed) vs ideal (reference) ---------- */

  const substrateField = care.fields.substrate_recipe;
  const currentMix = substrateField?.source === 'observed' ? substrateField.observed : null;
  const idealMix = substrateField?.reference;
  const effectiveMix = care.values.substrate_recipe;

  if ((Array.isArray(effectiveMix) && effectiveMix.length) || canEdit) {
    root.appendChild(
      el(
        'div',
        { class: 'section-title' },
        el('h2', {}, 'Substrate'),
        canEdit
          ? el(
              'button',
              { class: 'btn btn--sm', onclick: () => openMixSheet(plant, care, draw) },
              currentMix ? 'Edit current mix' : 'Log current mix',
            )
          : null,
      ),
    );

    const mixList = (mix) =>
      (mix ?? []).map((part) =>
        el(
          'div',
          { class: 'care-param' },
          el('span', {}, part.component),
          el('strong', { class: 'num' }, String(part.ratio)),
        ),
      );

    const substrateCard = el('div', { class: 'card' });
    if (currentMix) {
      substrateCard.appendChild(
        el('p', { class: 'small', style: 'margin-bottom:4px' },
          el('strong', {}, 'Current mix'), el('span', { class: 'muted' }, ' — what’s in the pot')),
      );
      substrateCard.append(...mixList(currentMix));
      if (Array.isArray(idealMix) && idealMix.length) {
        substrateCard.appendChild(
          el('p', { class: 'small', style: 'margin:0.75rem 0 4px' },
            el('strong', {}, 'Ideal recipe'), el('span', { class: 'muted' }, ' — the goal for the next repot')),
        );
        substrateCard.append(...mixList(idealMix));
      }
    } else if (Array.isArray(effectiveMix) && effectiveMix.length) {
      substrateCard.append(...mixList(effectiveMix));
      if (canEdit) {
        substrateCard.appendChild(
          el('p', { class: 'small muted', style: 'margin-top:0.5rem;margin-bottom:0' },
            'This is the ideal recipe — “Log current mix” records what the pot actually holds.'),
        );
      }
    } else {
      substrateCard.appendChild(el('p', { class: 'muted small' }, 'No substrate recipe yet.'));
    }
    root.appendChild(substrateCard);

    /* ---------- repotting calculator ---------- */
    if (plant.status === 'active') {
      const plan = potDiameter ? repotPlan(plant.pot, idealMix?.length ? idealMix : effectiveMix) : null;
      if (plan) {
        root.appendChild(
          el(
            'div',
            { class: 'card' },
            el('p', { class: 'small', style: 'margin-bottom:4px' },
              el('strong', {}, 'Next repot (calculator)')),
            el('div', { class: 'care-param' },
              el('span', { class: 'care-param__label' }, 'Current pot'),
              el('span', { class: 'num' },
                `${plan.current.diameter} cm · ~${plan.current.volumeLiters} L`)),
            el('div', { class: 'care-param' },
              el('span', { class: 'care-param__label' }, 'Suggested next'),
              el('strong', { class: 'num' },
                `${plan.next.diameter} cm · ~${plan.next.volumeLiters} L`)),
            el('div', { class: 'care-param' },
              el('span', { class: 'care-param__label' }, 'Step up'),
              el('strong', { class: 'num state-chip state-chip--fine' },
                `+${plan.next.diameter - plan.current.diameter} cm · +${plan.deltaLiters} L (+${plan.deltaPercent}%)`)),
            el('div', { class: 'care-param' },
              el('span', { class: 'care-param__label' }, 'Substrate to prepare'),
              el('strong', { class: 'num' }, `~${plan.substrateLiters} L`)),
            plan.components.map((part) =>
              el('div', { class: 'care-param' },
                el('span', {}, part.component),
                el('span', { class: 'num' }, `~${part.liters} L`))),
            el('p', { class: 'small muted', style: 'margin:0.5rem 0 0' },
              `Tapered-pot volumes${potBase ? '' : ' (base assumed 70% of the top)'}, root ball moving along; the split follows the ideal recipe when one is set, otherwise the mix above.`),
          ),
        );
      } else if (canEdit) {
        root.appendChild(
          el('p', { class: 'small muted' },
            'Set the pot diameter (Edit → pot) to unlock the repotting calculator.'),
        );
      }
    }
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
                'aria-label': 'Edit this entry',
                title: 'Edit this entry',
                onclick: () => openEventEdit(event, draw),
              },
              icon('edit'),
            )
          : null,
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

function renderFamilyNode(node, plants, currentId, seen = new Set()) {
  // Cycle guard: hand-edited data (or a mistaken parent pick in the form)
  // can produce parent loops; render each family member at most once.
  if (seen.has(node.id)) return null;
  seen.add(node.id);
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
      ? el(
          'div',
          { class: 'tree-children' },
          children.map((c) => renderFamilyNode(c, plants, currentId, seen)),
        )
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

/* ---------- edit a logged event (author, date, note) ---------- */

function openEventEdit(event, draw) {
  const { close, body } = showSheet({ title: `Edit — ${event.type}` });
  const today = todayString();
  const originalDay = dayOf(event.date) ?? today;

  const dateInput = el('input', { type: 'date', value: originalDay, max: today });
  const noteInput = el('input', { type: 'text', value: event.note ?? '', placeholder: 'Optional note…' });

  let author = event.author ?? '';
  const authorSeg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Author' });
  const drawAuthors = () => {
    authorSeg.textContent = '';
    for (const name of KNOWN_GARDENERS) {
      authorSeg.appendChild(
        el(
          'button',
          {
            type: 'button',
            'aria-pressed': String(author === name),
            onclick: () => {
              author = name;
              drawAuthors();
            },
          },
          name,
        ),
      );
    }
  };
  drawAuthors();
  const otherAuthor = el('input', {
    type: 'text',
    placeholder: 'Someone else…',
    value: KNOWN_GARDENERS.includes(author) ? '' : author,
    oninput: (e) => {
      author = e.target.value.trim() || event.author;
      drawAuthors();
    },
  });

  body.append(
    el('p', { class: 'small muted' }, 'Wrong name on a watering? Logged on the wrong day? Fix it here.'),
    el('div', { class: 'field' }, el('label', {}, 'Who did it'), authorSeg),
    formField('…or another name', otherAuthor),
    formField('When', dateInput),
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
            const changes = {};
            if (author && author !== event.author) changes.author = author;
            const day = dateInput.value && dateInput.value <= today ? dateInput.value : originalDay;
            if (day !== originalDay) {
              // Keep the original wall-clock time, move the calendar day.
              const time = /T(\d{2}:\d{2}:\d{2})/.exec(event.date)?.[1] ?? '12:00:00';
              changes.date = `${day}T${time}`;
            }
            const note = noteInput.value.trim() || null;
            if (note !== (event.note ?? null)) changes.note = note;
            if (Object.keys(changes).length) store.updateEvent(event.id, changes);
            close();
            draw();
          },
        },
        'Save changes',
      ),
    ),
  );
}

/* ---------- current-mix editor (writes care.observed.substrate_recipe) ---------- */

function openMixSheet(plant, care, draw) {
  const { close, body } = showSheet({ title: `Current mix — ${plant.name}` });
  const startFrom =
    (care.fields.substrate_recipe?.source === 'observed'
      ? care.fields.substrate_recipe.observed
      : care.fields.substrate_recipe?.reference) ?? [];
  const rows = structuredClone(startFrom);
  const hasOverride = care.fields.substrate_recipe?.source === 'observed';

  const rowsWrap = el('div');
  const drawRows = () => {
    rowsWrap.textContent = '';
    rows.forEach((part, index) => {
      rowsWrap.appendChild(
        el(
          'div',
          { class: 'field-row', style: 'align-items:center;grid-template-columns:1fr 6rem 44px;margin-bottom:8px' },
          el('input', {
            type: 'text',
            value: part.component ?? '',
            placeholder: 'Component',
            'aria-label': `Component ${index + 1}`,
            oninput: (e) => {
              part.component = e.target.value;
            },
          }),
          el('input', {
            type: 'text',
            value: part.ratio ?? '',
            placeholder: '60%',
            'aria-label': `Ratio ${index + 1}`,
            oninput: (e) => {
              part.ratio = e.target.value;
            },
          }),
          el(
            'button',
            {
              type: 'button',
              class: 'btn btn--icon',
              'aria-label': 'Remove component',
              onclick: () => {
                rows.splice(index, 1);
                drawRows();
              },
            },
            icon('trash'),
          ),
        ),
      );
    });
    rowsWrap.appendChild(
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--sm',
          onclick: () => {
            rows.push({ component: '', ratio: '' });
            drawRows();
          },
        },
        icon('plus'),
        'Add component',
      ),
    );
  };
  drawRows();

  const actions = el('div', { class: 'sheet__actions' });
  if (hasOverride) {
    actions.appendChild(
      el(
        'button',
        {
          class: 'btn btn--danger',
          onclick: () => {
            store.patchPlant(plant.id, {}, [
              'care.observed.substrate_recipe',
              'care.observed.substrate_recipe_note',
            ]);
            close();
            draw();
          },
        },
        'Back to ideal only',
      ),
    );
  } else {
    actions.appendChild(el('button', { class: 'btn', onclick: () => close() }, 'Cancel'));
  }
  actions.appendChild(
    el(
      'button',
      {
        class: 'btn btn--primary',
        onclick: () => {
          const cleaned = rows.filter((part) => part.component?.trim());
          if (cleaned.length) {
            store.patchPlant(plant.id, { 'care.observed.substrate_recipe': cleaned });
          } else if (hasOverride) {
            // Emptying the sheet means "no separate current mix" — remove
            // the override rather than storing a hollow [].
            store.patchPlant(plant.id, {}, [
              'care.observed.substrate_recipe',
              'care.observed.substrate_recipe_note',
            ]);
          }
          close();
          draw();
        },
      },
      'Save current mix',
    ),
  );

  body.append(
    el('p', { class: 'small muted' },
      'What the pot actually holds right now. The ideal recipe (edited in the plant form) stays untouched and drives the repot calculator whenever it exists.'),
    rowsWrap,
    actions,
  );
}

/* ---------- spot in the house (writes house.json placements) ---------- */

function openSpotSheet(plant, house, roomFurniture, placedOn, draw) {
  const { close, body } = showSheet({ title: `Spot — ${plant.name}` });

  const choose = (furnitureId) => {
    const placements = { ...(house.placements ?? {}) };
    if (furnitureId) placements[plant.id] = furnitureId;
    else delete placements[plant.id];
    store.setHouse({ ...house, placements });
    close();
    draw();
  };

  const option = (label, active, onPick) =>
    el(
      'button',
      {
        class: `btn${active ? ' btn--primary' : ''}`,
        style: 'width:100%;justify-content:flex-start;margin-bottom:8px',
        onclick: onPick,
      },
      label,
    );

  body.append(
    el('p', { class: 'small muted' },
      'Where this plant stands on the house map. Furniture is drawn in the map’s floor-plan editor.'),
    option('On the floor', !placedOn, () => choose(null)),
    roomFurniture.map((piece) =>
      option(
        FURNITURE_KINDS[piece.kind].label,
        placedOn?.id === piece.id,
        () => choose(piece.id),
      ),
    ),
  );
}
