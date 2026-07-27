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
import { uniquePlantId } from '../slug.js';

const ORIENTATIONS = ['', 'north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

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

  const numberInput = (get, set, attrs = {}) =>
    el('input', {
      type: 'number',
      min: '1',
      max: '365',
      inputmode: 'numeric',
      value: get() ?? '',
      oninput: (e) => set(e.target.value === '' ? undefined : Number(e.target.value)),
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

  /* ---------- id slug ---------- */

  const uniqueId = (name) => uniquePlantId(name, plantsById);

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
    ),

    el('h2', {}, 'Care — from the literature'),
    el('p', { class: 'small muted' },
      'What the books/internet say. What actually works in our house is recorded later as observed overrides on the profile.'),
    el('div', { class: 'card' },
      field('Light', textInput(
        () => state.care.reference.light,
        (v) => { state.care.reference.light = v; },
        { placeholder: 'Bright indirect' },
      )),
      field('Sun need', selectInput(SUN_NEEDS,
        () => state.care.reference.sun_need,
        (v) => { state.care.reference.sun_need = v; })),
      el('div', { class: 'field-row' },
        field('Watering · summer (days)', numberInput(
          () => state.care.reference.watering_days_summer,
          (v) => { state.care.reference.watering_days_summer = v; })),
        field('Watering · winter (days)', numberInput(
          () => state.care.reference.watering_days_winter,
          (v) => { state.care.reference.watering_days_winter = v; })),
      ),
      field('Humidity', textInput(
        () => state.care.reference.humidity,
        (v) => { state.care.reference.humidity = v; })),
      field('Feeding', textInput(
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
