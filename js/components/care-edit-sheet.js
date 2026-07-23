// Care parameter editor — THE observed-layer chokepoint. Quick-edit from the
// table and the profile's per-parameter override editor are the same sheet:
// it always writes care.observed.* (never the reference/literature value),
// shows both layers side by side, and "Remove override" deletes the key and
// its _note sibling per the effective-care contract.

import * as store from '../store.js';
import { effectiveCare } from '../../shared/effective-care.js';
import { SUN_NEEDS } from '../../shared/validate.js';
import { el, showSheet, snackbar, formField } from '../ui.js';

export const QUICK_PARAMS = {
  watering_days_summer: { label: 'Watering rhythm — summer', kind: 'days', unit: 'days' },
  watering_days_winter: { label: 'Watering rhythm — winter', kind: 'days', unit: 'days' },
  sun_need: { label: 'Sun need', kind: 'enum', options: SUN_NEEDS },
  light: { label: 'Light', kind: 'text' },
  humidity: { label: 'Humidity', kind: 'text' },
  feeding: { label: 'Feeding', kind: 'text' },
  toxic_to_pets: { label: 'Toxic to pets', kind: 'bool' },
};

const fmtValue = (key, value) => {
  if (value === undefined || value === null || value === '') return '—';
  const spec = QUICK_PARAMS[key];
  if (spec?.kind === 'days') return `every ${value} days`;
  if (spec?.kind === 'bool') return value ? 'yes' : 'no';
  return String(value);
};

/** Explain an observed override to a visitor (read-only tap on the marker). */
export function explainOverride(key, field) {
  snackbar({
    message: `Observed override — literature says ${fmtValue(key, field.reference)}, our experience says ${fmtValue(key, field.observed)}.`,
    duration: 5000,
  });
}

export function openCareEdit(plant, key) {
  const spec = QUICK_PARAMS[key] ?? { label: key, kind: 'text' };
  const { fields } = effectiveCare(plant);
  const field = fields[key] ?? { value: undefined, source: 'reference' };
  const overridden = field.source === 'observed';

  const { close, body } = showSheet({ title: `${spec.label} — ${plant.name}` });

  /* Both layers, side by side, so the semantics are self-evident. */
  body.appendChild(
    el(
      'p',
      { class: 'small' },
      el('span', { class: 'muted' }, 'Literature: '),
      el('strong', {}, fmtValue(key, field.reference)),
      overridden
        ? [el('span', { class: 'muted' }, '   ·   Ours: '), el('strong', { class: 'num' }, fmtValue(key, field.observed))]
        : null,
    ),
  );

  let getValue;
  const startValue = field.value;

  if (spec.kind === 'days') {
    let days = Number(startValue) || 7;
    const output = el('output', { class: 'num' }, String(days));
    const set = (next) => {
      days = Math.min(365, Math.max(1, next));
      output.textContent = String(days);
    };
    body.appendChild(
      el(
        'div',
        { class: 'field' },
        el('label', {}, 'Our observed rhythm (days)'),
        el(
          'div',
          { class: 'stepper' },
          el('button', { type: 'button', 'aria-label': 'Fewer days', onclick: () => set(days - 1) }, '−'),
          output,
          el('button', { type: 'button', 'aria-label': 'More days', onclick: () => set(days + 1) }, '+'),
        ),
      ),
    );
    getValue = () => days;
  } else if (spec.kind === 'enum') {
    let value = startValue ?? spec.options[0];
    const seg = el('div', { class: 'segmented', role: 'group' });
    const drawSeg = () => {
      seg.textContent = '';
      for (const option of spec.options) {
        seg.appendChild(
          el(
            'button',
            {
              type: 'button',
              'aria-pressed': String(option === value),
              onclick: () => {
                value = option;
                drawSeg();
              },
            },
            option,
          ),
        );
      }
    };
    drawSeg();
    body.appendChild(el('div', { class: 'field' }, el('label', {}, 'Our observation'), seg));
    getValue = () => value;
  } else if (spec.kind === 'bool') {
    let value = Boolean(startValue);
    const seg = el('div', { class: 'segmented', role: 'group' });
    const drawSeg = () => {
      seg.textContent = '';
      for (const option of [true, false]) {
        seg.appendChild(
          el(
            'button',
            {
              type: 'button',
              'aria-pressed': String(option === value),
              onclick: () => {
                value = option;
                drawSeg();
              },
            },
            option ? 'Yes' : 'No',
          ),
        );
      }
    };
    drawSeg();
    body.appendChild(el('div', { class: 'field' }, el('label', {}, 'Our observation'), seg));
    getValue = () => value;
  } else {
    const input = el('input', { type: 'text', value: startValue == null ? '' : String(startValue) });
    body.appendChild(formField('Our observation', input));
    getValue = () => input.value.trim();
  }

  const noteInput = el('input', {
    type: 'text',
    value: field.note ?? '',
    placeholder: 'Why? e.g. "thrives with far less water"',
  });
  body.appendChild(formField('Note (the why)', noteInput));

  const actions = el('div', { class: 'sheet__actions' });

  if (overridden) {
    actions.appendChild(
      el(
        'button',
        {
          class: 'btn btn--danger',
          onclick: () => {
            store.patchPlant(plant.id, {}, [`care.observed.${key}`, `care.observed.${key}_note`]);
            close();
          },
        },
        'Remove override',
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
          const value = getValue();
          if (value === '' || value === undefined) {
            close();
            return;
          }
          const changes = { [`care.observed.${key}`]: value };
          const removals = [];
          const note = noteInput.value.trim();
          if (note) changes[`care.observed.${key}_note`] = note;
          else if (field.note) removals.push(`care.observed.${key}_note`);
          store.patchPlant(plant.id, changes, removals);
          close();
        },
      },
      overridden ? 'Update override' : 'Save as observed',
    ),
  );

  body.appendChild(actions);
}
