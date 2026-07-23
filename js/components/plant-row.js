// The single row/card component shared by Today and the Care view's mobile
// layout — one place renders plant rows, one `canEdit` flag gates every
// action, so visitor mode cannot leak an edit affordance from a second
// code path.

import { el, icon, fmtRelativeDay } from '../ui.js';

/* ---------- photo with deterministic placeholder ---------- */

const PLACEHOLDER_TINTS = ['#e1ecdc', '#dfe8d2', '#e7e3cf', '#dbe6df'];

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/** <div> holding the plant photo, or a tinted leaf placeholder on null/404. */
export function plantPhoto(plant, cls = 'plant-card__photo') {
  const holder = el('div', { class: cls });
  const placeholder = () => {
    holder.textContent = '';
    holder.style.background = PLACEHOLDER_TINTS[hashCode(plant.id) % PLACEHOLDER_TINTS.length];
    holder.style.display = 'flex';
    holder.style.alignItems = 'center';
    holder.style.justifyContent = 'center';
    holder.style.color = 'var(--leaf)';
    holder.appendChild(icon('leaf'));
  };
  if (plant.photo) {
    const img = el('img', {
      src: plant.photo,
      alt: plant.name,
      loading: 'lazy',
      onerror: placeholder, // broken path → placeholder, never a broken-image glyph
    });
    holder.appendChild(img);
  } else {
    placeholder();
  }
  return holder;
}

/* ---------- urgency chip (color + icon + text, never color alone) ---------- */

const STATE_CHIP = {
  fine: (s) => ['check', s.dueIn != null ? `in ${s.dueIn} d` : 'fine'],
  soon: () => ['water', 'tomorrow'],
  due: () => ['water', 'due today'],
  overdue: (s) => ['alert', `${-s.dueIn} d late`],
  unknown: (s) => ['info', s.reason === 'no-interval' ? 'no schedule' : 'no log yet'],
};

export function stateChip(status) {
  if (!status) return null;
  const [iconName, label] = STATE_CHIP[status.state](status);
  return el(
    'span',
    { class: `state-chip state-chip--${status.state}` },
    icon(iconName),
    el('span', {}, label),
  );
}

/* ---------- card ---------- */

/**
 * @param {object} plant
 * @param {object} opts
 *   status        wateringStatus() result (or null)
 *   meta          array of strings for the secondary line
 *   actions       [{iconName, label, onClick, disabled, done}] — only
 *                 rendered when canEdit
 *   canEdit       gardener switch (default false)
 *   selectable    multi-select mode
 *   selected      current selection state
 *   onToggle      selection toggle callback
 */
export function plantCard(plant, opts = {}) {
  const {
    status = null,
    meta = [],
    actions = [],
    canEdit = false,
    selectable = false,
    selected = false,
    onToggle = null,
  } = opts;

  const card = el(
    'div',
    {
      class: `plant-card${selectable ? ' plant-card--selectable' : ''}${
        selected ? ' plant-card--selected' : ''
      }`,
      ...(selectable
        ? {
            role: 'checkbox',
            'aria-checked': String(selected),
            tabindex: '0',
            onclick: () => onToggle?.(plant.id),
            onkeydown: (e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                onToggle?.(plant.id);
              }
            },
          }
        : {}),
    },
    selectable
      ? el('span', { class: 'select-check' }, icon(selected ? 'checkbox' : 'square'))
      : null,
    plantPhoto(plant),
    el(
      'div',
      { class: 'plant-card__body' },
      selectable
        ? el('span', { class: 'plant-card__name' }, plant.name)
        : el(
            'a',
            { class: 'plant-card__name', href: `#/plant/${encodeURIComponent(plant.id)}` },
            plant.name,
          ),
      el(
        'div',
        { class: 'plant-card__meta' },
        status ? stateChip(status) : null,
        meta.map((m) => el('span', {}, m)),
      ),
    ),
    !selectable && canEdit && actions.length
      ? el(
          'div',
          { class: 'plant-card__actions' },
          actions.map((action) =>
            el(
              'button',
              {
                class: `btn btn--icon${action.done ? ' btn--ghost' : ''}`,
                'aria-label': `${action.label}: ${plant.name}`,
                title: action.label,
                disabled: action.disabled || action.done,
                onclick: action.onClick,
              },
              icon(action.done ? 'check' : action.iconName),
            ),
          ),
        )
      : null,
  );
  return card;
}

/** Standard meta line for a watering status. */
export function wateringMeta(status) {
  if (!status) return [];
  const meta = [];
  if (status.lastWatering) meta.push(`watered ${fmtRelativeDay(status.lastWatering)}`);
  if (status.interval) meta.push(`every ${status.interval} d`);
  return meta;
}
