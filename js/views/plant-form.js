// Add / edit plant form (MVP 5). Serves both #/add and #/plant/:id/edit
// (the router only mounts it in gardener mode).
//
// - New plants get a slug id from the name with a uniqueness check ("-2" on
//   collision); ids are foreign keys (events, parent) so editing never
//   changes them.
// - Room offers a datalist of existing rooms so the Phase 2 house map gets
//   consistent keys.
// - Reference care is entered here; observed overrides live in the
//   care-edit sheet, so the form can't confuse the two layers.
// - Saving an edit stores a field-level diff (patch op), not a snapshot.

import * as store from '../store.js';
import { el, icon, clear, formField } from '../ui.js';
import { PLANT_STATUSES, SUN_NEEDS } from '../../shared/validate.js';
import { todayString } from '../../shared/dates.js';
import { diffPlant } from '../../shared/ops.js';
import { navigate } from '../router.js';

const ORIENTATIONS = ['', 'north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

// Presets keep entries consistent (and thumbs happy) while the datalist
// still allows any free text.
const LIGHT_OPTIONS = [
  'Direct sun',
  'Bright indirect',
  'Bright indirect, tolerates low light',
  'Medium indirect',
  'Medium indirect, never direct sun',
  'Low light',
];
const HUMIDITY_OPTIONS = [
  'High — 60%+',
  'Medium-high, appreciates misting',
  'Medium',
  'Undemanding',
  'Irrelevant',
];
const FEEDING_OPTIONS = [
  'Biweekly in spring–summer',
  'Monthly in the growing season',
  'Monthly at half strength, spring–summer',
  'Every 2–3 weeks in the growing season',
  'Twice a year at most',
  'None',
];

export function render(container, params, routeName) {
  const editing = routeName === 'plant-edit';
  const { plants, plantsById } = store.getSnapshot();
  const base = editing ? plantsById.get(params.id) : null;

  if (editing && !base) {
    container.appendChild(
      el('div', { class: 'empty-state' }, el('p', {}, 'Plant not found.'),
        el('a', { class: 'btn', href: '#/care' }, 'Back')),
    );
    return;
  }

  const root = el('div');
  container.appendChild(root);

  const rooms = [...new Set(plants.map((p) => p.location?.room).filter(Boolean))];
  const state = structuredClone(
    base ?? {
      id: '',
      name: '',
      species: '',
      nickname: null,
      location: { room: '', orientation: '', detail: '' },
      pot: null,
      photo: null,
      acquired: todayString(),
      parent: null,
      care: {
        reference: {
          source: '',
          light: '',
          sun_need: 'medium',
          watering_days_summer: 7,
          watering_days_winter: 14,
          humidity: '',
          feeding: '',
          substrate_recipe: [],
          toxic_to_pets: false,
        },
        observed: {},
      },
      general_notes: '',
      status: 'active',
    },
  );

  // Hand-edited plants may lack these blocks; the form reads them directly.
  state.location ??= { room: '', orientation: '', detail: '' };
  state.care ??= {};
  state.care.reference ??= {};
  state.care.observed ??= {};

  /* ---------- field helpers ---------- */

  const field = (label, input, hint = null) => formField(label, input, { hint });

  const textInput = (get, set, attrs = {}) =>
    el('input', {
      type: 'text',
      value: get() ?? '',
      oninput: (e) => set(e.target.value),
      ...attrs,
    });

  const selectInput = (options, get, set, labels = null) =>
    el(
      'select',
      { onchange: (e) => set(e.target.value) },
      options.map((option, i) =>
        el(
          'option',
          { value: option, selected: String(get() ?? '') === String(option) },
          labels ? labels[i] : option === '' ? '—' : option,
        ),
      ),
    );

  const presetInput = (listId, options, get, set, attrs = {}) =>
    el(
      'span',
      {},
      el('input', {
        type: 'text',
        list: listId,
        value: get() ?? '',
        oninput: (e) => set(e.target.value),
        ...attrs,
      }),
      el('datalist', { id: listId }, options.map((o) => el('option', { value: o }))),
    );

  // "Water every [n] [days|weeks]" — stored as days; whole weeks display
  // as weeks (Pepa's request: dropdowns over bare numbers).
  const wateringInput = (get, set) => {
    const days = get();
    let unit = days != null && days % 7 === 0 && days >= 7 ? 'weeks' : 'days';
    let amount = days == null ? '' : unit === 'weeks' ? days / 7 : days;
    const commit = () => set(amount === '' ? undefined : Number(amount) * (unit === 'weeks' ? 7 : 1));
    const amountInput = el('input', {
      type: 'number',
      min: '1',
      max: '365',
      inputmode: 'numeric',
      value: amount,
      'aria-label': 'Every how many',
      oninput: (e) => {
        amount = e.target.value;
        commit();
      },
    });
    const unitSelect = el(
      'select',
      {
        'aria-label': 'Days or weeks',
        onchange: (e) => {
          unit = e.target.value;
          commit();
        },
      },
      el('option', { value: 'days', selected: unit === 'days' }, 'days'),
      el('option', { value: 'weeks', selected: unit === 'weeks' }, 'weeks'),
    );
    return el(
      'span',
      { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' },
      amountInput,
      unitSelect,
    );
  };

  /* ---------- id slug ---------- */

  const slugify = (name) =>
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const uniqueId = (name) => {
    const baseSlug = slugify(name) || 'plant';
    let slug = baseSlug;
    let n = 2;
    while (plantsById.has(slug)) slug = `${baseSlug}-${n++}`;
    return slug;
  };

  const idPreview = el('code', {}, editing ? state.id : '(from the name)');

  /* ---------- substrate recipe rows ---------- */

  const recipeWrap = el('div');
  const drawRecipe = () => {
    clear(recipeWrap);
    const recipe = state.care.reference.substrate_recipe ?? [];
    recipe.forEach((part, index) => {
      recipeWrap.appendChild(
        el(
          'div',
          { class: 'field-row', style: 'align-items:center;grid-template-columns: 1fr 6rem 44px' },
          textInput(
            () => part.component,
            (v) => {
              part.component = v;
            },
            { placeholder: 'Component', 'aria-label': `Component ${index + 1}` },
          ),
          textInput(
            () => part.ratio,
            (v) => {
              part.ratio = v;
            },
            { placeholder: '60%', 'aria-label': `Ratio ${index + 1}` },
          ),
          el(
            'button',
            {
              type: 'button',
              class: 'btn btn--icon',
              'aria-label': 'Remove component',
              onclick: () => {
                recipe.splice(index, 1);
                drawRecipe();
              },
            },
            icon('trash'),
          ),
        ),
      );
    });
    recipeWrap.appendChild(
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--sm',
          onclick: () => {
            (state.care.reference.substrate_recipe ??= []).push({ component: '', ratio: '' });
            drawRecipe();
          },
        },
        icon('plus'),
        'Add component',
      ),
    );
  };
  drawRecipe();

  /* ---------- form ---------- */

  const errorBox = el('div');

  const parentOptions = plants.filter((p) => p.id !== state.id);

  const form = el(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        save();
      },
    },

    el('h1', {}, editing ? `Edit — ${base.name}` : 'New plant'),
    errorBox,

    el('div', { class: 'card' },
      field('Name *', textInput(() => state.name, (v) => {
        state.name = v;
        if (!editing) idPreview.textContent = uniqueId(v);
      })),
      field('Id', idPreview, editing
        ? 'Ids never change — events and cuttings point at them.'
        : 'Created from the name, must be unique.'),
      field('Species', textInput(() => state.species, (v) => { state.species = v; }),
        'Botanical name, e.g. Monstera deliciosa'),
      field('Nickname', textInput(() => state.nickname, (v) => { state.nickname = v || null; })),
      field('Status', selectInput(PLANT_STATUSES, () => state.status, (v) => { state.status = v; })),
      field('Acquired', el('input', {
        type: 'date',
        value: state.acquired ?? '',
        max: todayString(),
        onchange: (e) => { state.acquired = e.target.value || null; },
      })),
      field('Cutting from', selectInput(
        ['', ...parentOptions.map((p) => p.id)],
        () => state.parent ?? '',
        (v) => { state.parent = v || null; },
        ['— not a cutting —', ...parentOptions.map((p) => p.name)],
      )),
      field('Photo path', textInput(() => state.photo, (v) => { state.photo = v || null; }),
        'e.g. img/my-plant.jpg — add the image file to the repo by hand (see README).'),
    ),

    el('h2', {}, 'Where it lives'),
    el('div', { class: 'card' },
      field('Room', el('span', {},
        el('input', {
          type: 'text',
          list: 'room-list',
          value: state.location?.room ?? '',
          oninput: (e) => { (state.location ??= {}).room = e.target.value; },
        }),
        el('datalist', { id: 'room-list' }, rooms.map((r) => el('option', { value: r }))),
      ), 'Reusing existing room names keeps the future house map tidy.'),
      field('Window orientation', selectInput(ORIENTATIONS,
        () => state.location?.orientation ?? '',
        (v) => { (state.location ??= {}).orientation = v; })),
      field('Detail', textInput(
        () => state.location?.detail,
        (v) => { (state.location ??= {}).detail = v; },
        { placeholder: 'Next to the window, 1 m from the glass' },
      )),
      el('div', { class: 'field-row' },
        field('Pot Ø top (cm)', el('input', {
          type: 'number',
          min: '4',
          max: '80',
          inputmode: 'numeric',
          value: state.pot?.diameter_cm ?? '',
          oninput: (e) => {
            const v = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(v) && v > 0) {
              (state.pot ??= {}).diameter_cm = v;
            } else if (state.pot) {
              delete state.pot.diameter_cm;
              if (!Object.keys(state.pot).length) state.pot = null;
            }
          },
        })),
        field('Ø base (optional)', el('input', {
          type: 'number',
          min: '3',
          max: '80',
          inputmode: 'numeric',
          value: state.pot?.base_diameter_cm ?? '',
          oninput: (e) => {
            const v = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(v) && v > 0) {
              (state.pot ??= {}).base_diameter_cm = v;
            } else if (state.pot) {
              delete state.pot.base_diameter_cm;
              if (!Object.keys(state.pot).length) state.pot = null;
            }
          },
        })),
      ),
      el('p', { class: 'hint', style: 'margin-top:-0.5rem' },
        'Inner diameters. Pots taper — the base makes the repot calculator exact (otherwise it assumes 70%). Top Ø unlocks the calculator.'),
    ),

    el('h2', {}, 'Care — from the literature'),
    el('p', { class: 'small muted' },
      'What the books/internet say. What actually works in our house is recorded later as observed overrides on the profile.'),
    el('div', { class: 'card' },
      field('Light', presetInput('light-list', LIGHT_OPTIONS,
        () => state.care.reference.light,
        (v) => { state.care.reference.light = v; },
        { placeholder: 'Bright indirect' },
      )),
      field('Sun need', selectInput(SUN_NEEDS,
        () => state.care.reference.sun_need,
        (v) => { state.care.reference.sun_need = v; })),
      field('Watering · summer — every', wateringInput(
        () => state.care.reference.watering_days_summer,
        (v) => { state.care.reference.watering_days_summer = v; })),
      field('Watering · winter — every', wateringInput(
        () => state.care.reference.watering_days_winter,
        (v) => { state.care.reference.watering_days_winter = v; })),
      field('Humidity', presetInput('humidity-list', HUMIDITY_OPTIONS,
        () => state.care.reference.humidity,
        (v) => { state.care.reference.humidity = v; })),
      field('Feeding', presetInput('feeding-list', FEEDING_OPTIONS,
        () => state.care.reference.feeding,
        (v) => { state.care.reference.feeding = v; },
        { placeholder: 'Biweekly in spring–summer' },
      )),
      field('Toxic to pets', selectInput(['no', 'yes'],
        () => (state.care.reference.toxic_to_pets ? 'yes' : 'no'),
        (v) => { state.care.reference.toxic_to_pets = v === 'yes'; })),
      field('Reference source', textInput(
        () => state.care.reference.source,
        (v) => { state.care.reference.source = v; },
        { placeholder: 'Book, website, the plant shop…' },
      )),
      field('Substrate recipe', recipeWrap),
    ),

    el('h2', {}, 'Notebook'),
    el('div', { class: 'card' },
      field('Notes (markdown)', el('textarea', {
        rows: '6',
        oninput: (e) => { state.general_notes = e.target.value; },
      }, state.general_notes ?? '')),
    ),

    el('div', { class: 'sheet__actions' },
      el('a', { class: 'btn', href: editing ? `#/plant/${encodeURIComponent(state.id)}` : '#/' }, 'Cancel'),
      el('button', { class: 'btn btn--primary', type: 'submit' }, editing ? 'Save changes' : 'Add plant'),
    ),
  );

  root.appendChild(form);

  /* ---------- save ---------- */

  function save() {
    clear(errorBox);
    const problems = [];
    if (!state.name?.trim()) problems.push('The plant needs a name.');
    const recipe = state.care.reference.substrate_recipe ?? [];
    state.care.reference.substrate_recipe = recipe.filter((p) => p.component?.trim());
    if (problems.length) {
      errorBox.appendChild(
        el('div', { class: 'banner banner--danger' }, problems.join(' ')),
      );
      window.scrollTo(0, 0);
      return;
    }

    state.name = state.name.trim();

    // Drop empty-string reference fields so the JSON stays tidy.
    for (const [key, value] of Object.entries(state.care.reference)) {
      if (value === '' || value === undefined) delete state.care.reference[key];
    }
    if (state.pot == null) delete state.pot;

    if (editing) {
      const { changes, removals } = diffPlant(base, state);
      if (Object.keys(changes).length || removals.length) {
        store.patchPlant(base.id, changes, removals);
      }
      navigate(`#/plant/${encodeURIComponent(base.id)}`);
    } else {
      state.id = uniqueId(state.name);
      store.createPlant(state);
      navigate(`#/plant/${encodeURIComponent(state.id)}`);
    }
  }
}
