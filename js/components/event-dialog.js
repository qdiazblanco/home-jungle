// "Log event" dialog (MVP 6): any of the nine event types, an editable date
// (defaults to today, capped at today — backdating "I watered it yesterday"
// is a first-class flow), an optional note, author from Settings.

import * as store from '../store.js';
import { todayString } from '../../shared/dates.js';
import { el, icon, showSheet, formField } from '../ui.js';
import { ensureAuthor } from './author-gate.js';

// 'photo' is deliberately absent: photo events must reference a committed
// image (src), and the profile's "Add photo" capture flow is the only path
// that creates one. An imageless moment is a note.
const TYPES = [
  { type: 'watering', label: 'Watering', iconName: 'water' },
  { type: 'check', label: 'Still moist', iconName: 'check' },
  { type: 'feeding', label: 'Feeding', iconName: 'feeding' },
  { type: 'misting', label: 'Misting', iconName: 'misting' },
  { type: 'repotting', label: 'Repotting', iconName: 'repotting' },
  { type: 'pruning', label: 'Pruning', iconName: 'pruning' },
  { type: 'treatment', label: 'Treatment', iconName: 'treatment' },
  { type: 'cutting', label: 'Cutting', iconName: 'cutting' },
  { type: 'note', label: 'Note', iconName: 'note' },
];

const HINTS = {
  check: 'Substrate still damp on watering day — snoozes the schedule a couple of days without logging a watering.',
  treatment: 'Pests, fungus, tonics — say what and why in the note.',
  cutting: 'Taking a cutting for propagation? Add the child plant afterwards and set its parent.',
  note: 'For a photo with an actual image, use “Add photo” on the profile instead.',
};

export async function openEventDialog(plant, { type = 'note', onLogged } = {}) {
  const author = await ensureAuthor();
  if (!author) return;

  let selected = type;
  const { close, body } = showSheet({ title: `Log — ${plant.name}` });

  const hint = el('p', { class: 'small muted' });
  const typeGrid = el('div', { class: 'type-grid', role: 'radiogroup', 'aria-label': 'Event type' });

  const drawTypes = () => {
    typeGrid.textContent = '';
    for (const t of TYPES) {
      typeGrid.appendChild(
        el(
          'button',
          {
            class: `type-grid__btn${t.type === selected ? ' type-grid__btn--active' : ''}`,
            role: 'radio',
            'aria-checked': String(t.type === selected),
            onclick: () => {
              selected = t.type;
              drawTypes();
            },
          },
          icon(t.iconName),
          el('span', {}, t.label),
        ),
      );
    }
    hint.textContent = HINTS[selected] ?? '';
  };
  drawTypes();

  const today = todayString();
  const dateInput = el('input', { type: 'date', value: today, max: today });
  const noteInput = el('textarea', { placeholder: 'Optional note…', rows: '3' });

  body.append(
    typeGrid,
    hint,
    el('div', { class: 'field-row' },
      formField('When', dateInput),
      formField('By', el('input', { type: 'text', value: author, disabled: true })),
    ),
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
            const date = dateInput.value && dateInput.value <= today ? dateInput.value : today;
            store.logEvent(plant.id, selected, {
              note: noteInput.value.trim() || null,
              date: date === today ? null : date,
            });
            close();
            onLogged?.();
          },
        },
        'Log it',
      ),
    ),
  );
}
