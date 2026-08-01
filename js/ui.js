// Small DOM helpers: element builder, icon set, overlays (sheet, dialog,
// snackbar) and date formatting for the UI layer.

import { todayString, daysBetween, dayOf } from '../shared/dates.js';

/* ---------- element builder ---------- */

/**
 * el('button', { class: 'btn', onclick: fn, 'aria-label': 'Water' }, child…)
 * Children: nodes, strings, arrays, or null/undefined (skipped).
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'class') {
      node.className = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled') {
      node[key] = value;
    } else if (key === 'html') {
      node.innerHTML = value; // only ever fed from shared/markdown.js or our own icon constants
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      append(node, child);
    } else if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
}

export function clear(node) {
  node.textContent = '';
  return node;
}

/* ---------- icons (24×24, stroke=currentColor) ---------- */

const stroke = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths}</svg>`;

const ICONS = {
  water: stroke('<path d="M12 3c3.5 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.5 6-11z"/>'),
  feeding: stroke('<path d="M13 2 5 13h5l-1 9 8-11h-5l1-9z"/>'),
  note: stroke('<path d="M17 3a2.8 2.8 0 1 1 4 4L8 20l-5 1 1-5L17 3z"/>'),
  misting: stroke(
    '<path d="M7 9h4a2 2 0 0 1 2 2v9H5v-9a2 2 0 0 1 2-2z"/><path d="M9 9V5h4"/><path d="M17 5h.01M20 8h.01M17 11h.01M20 14h.01"/>',
  ),
  pruning: stroke(
    '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.2 7.7 20 19M8.2 16.3 20 5"/>',
  ),
  repotting: stroke('<path d="M4 9h16l-2 12H6L4 9z"/><path d="M12 9V5m0 0c0-2 2-3 4-3 0 2-2 3-4 3z"/>'),
  treatment: stroke(
    '<circle cx="12" cy="13" r="5"/><path d="M12 8V5m-6 8H3m18 0h-3M7 8 5 6m12 2 2-2M7 18l-2 2m12-2 2 2"/>',
  ),
  cutting: stroke('<path d="M12 21V11m0 0c0-4 3-6 7-6 0 4-3 6-7 6zm0 2c0-3-2.5-5-6-5 0 3 2.5 5 6 5z"/>'),
  photo: stroke(
    '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13" r="3.5"/>',
  ),
  watering: stroke('<path d="M12 3c3.5 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.5 6-11z"/>'),
  check: stroke('<path d="M4 12.5 9.5 18 20 6"/>'),
  checkbox: stroke('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.5 11 15l4.5-5.5"/>'),
  square: stroke('<rect x="4" y="4" width="16" height="16" rx="4"/>'),
  alert: stroke('<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4m0 3.5h.01"/>'),
  info: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8.5h.01"/>'),
  sun: stroke(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ),
  moon: stroke('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>'),
  spinner: stroke('<path d="M12 3a9 9 0 1 0 9 9"/>'),
  cloudOff: stroke('<path d="M4 15a4.5 4.5 0 0 1 3.2-7.7A6 6 0 0 1 18.5 9 4 4 0 0 1 18 17H7"/><path d="M3 3l18 18"/>'),
  leaf: stroke('<path d="M6 21c0-9 4-14 13-16-1 9-5 14-13 16z"/><path d="M6 21c3-6 6-9 10-12"/>'),
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  back: stroke('<path d="M15 5l-7 7 7 7"/>'),
  trash: stroke('<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13"/>'),
  edit: stroke('<path d="M17 3a2.8 2.8 0 1 1 4 4L8 20l-5 1 1-5L17 3z"/>'),
  gear: stroke(
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1l2.1-2.1m10-10 2.1-2.1"/>',
  ),
  table: stroke('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>'),
  calendar: stroke('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>'),
  chevronRight: stroke('<path d="M9 5l7 7-7 7"/>'),
  close: stroke('<path d="M6 6l12 12M18 6 6 18"/>'),
  external: stroke('<path d="M14 4h6v6m0-6L10 14"/><path d="M20 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>'),
  star: stroke('<path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.9 6.4 20l1.3-6.2L3 9.5l6.3-.7L12 3z"/>'),
  book: stroke('<path d="M12 6c-2-1.5-5-2-9-2v14c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2z"/><path d="M12 6v14"/>'),
  mapIcon: stroke('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14m6-12v14"/>'),
};

/** Inline SVG icon as a span.icon element. */
export function icon(name, cls = '') {
  return el('span', { class: `icon ${cls}`.trim(), html: ICONS[name] ?? ICONS.leaf });
}

/* ---------- overlays ---------- */

const overlayRoot = () => document.getElementById('overlay-root');

/**
 * Bottom sheet (mobile) / centered card (via opts.center).
 * Returns { close, body }. Backdrop tap and Esc close it.
 */
export function showSheet({ title, center = false, onClose } = {}) {
  const body = el('div');
  const sheet = el(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title ?? 'Dialog' },
    center ? null : el('div', { class: 'sheet__grab' }),
    title ? el('h2', {}, title) : null,
    body,
  );
  const backdrop = el(
    'div',
    { class: `overlay-backdrop${center ? ' overlay-backdrop--center' : ''}` },
    sheet,
  );

  const opener = document.activeElement;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (opener && document.contains(opener)) opener.focus?.();
    onClose?.();
  };

  const focusables = () =>
    [...sheet.querySelectorAll('input, select, textarea, button, a[href], [tabindex]')].filter(
      (n) => !n.disabled && n.offsetParent !== null,
    );

  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    // Light focus trap: Tab cycles inside the sheet.
    if (e.key === 'Tab') {
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!sheet.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  overlayRoot().appendChild(backdrop);
  sheet.querySelector('input, select, textarea, button')?.focus?.();
  return { close, body, sheet };
}

/* ---------- labelled form field ---------- */

let fieldSeq = 0;

/**
 * A .field block whose <label> is programmatically associated with the
 * control (for/id) when the content is or contains a real form control.
 * Button-group controls (steppers, segmented) keep sibling labels — wrapping
 * them in a <label> would forward label clicks to the first button.
 */
export function formField(labelText, input, { hint } = {}) {
  const labelEl = el('label', {}, labelText);
  const target = ['INPUT', 'SELECT', 'TEXTAREA'].includes(input?.tagName)
    ? input
    : input?.querySelector?.('input, select, textarea');
  if (target) {
    if (!target.id) target.id = `field-${++fieldSeq}`;
    labelEl.setAttribute('for', target.id);
  }
  return el(
    'div',
    { class: 'field' },
    labelEl,
    input,
    hint ? el('p', { class: 'hint' }, hint) : null,
  );
}

/** Confirmation dialog → Promise<boolean>. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const { close, body } = showSheet({
      title,
      center: true,
      onClose: () => resolve(false),
    });
    body.append(
      message ? el('p', { class: 'small' }, message) : '',
      el(
        'div',
        { class: 'sheet__actions' },
        el('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
        el(
          'button',
          {
            class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
            onclick: () => {
              resolve(true);
              // resolve before close so onClose's resolve(false) is a no-op
              close();
            },
          },
          confirmLabel,
        ),
      ),
    );
  });
}

let activeSnackbar = null;

/**
 * Snackbar with optional action ("Watered Monstera — Undo").
 * Returns { dismiss }. A new snackbar replaces the previous one.
 */
export function snackbar({ message, actionLabel, onAction, duration = 5000, onTimeout }) {
  // A replaced snackbar can no longer offer its Undo, so its pending outcome
  // must COMMIT (fire onTimeout), never silently vanish — otherwise a second
  // quick-log within the grace window would strand the first op unsynced.
  activeSnackbar?.dismiss(false);

  const bar = el(
    'div',
    { class: 'snackbar', role: 'status' },
    el('span', {}, message),
    actionLabel
      ? el(
          'button',
          {
            class: 'btn btn--sm',
            onclick: () => {
              dismiss(true);
              onAction?.();
            },
          },
          actionLabel,
        )
      : null,
  );

  let timer = null;
  const dismiss = (silent = false) => {
    if (timer) clearTimeout(timer);
    timer = null;
    bar.remove();
    if (activeSnackbar?.bar === bar) activeSnackbar = null;
    if (!silent) onTimeout?.();
  };
  if (duration) timer = setTimeout(() => dismiss(false), duration);

  overlayRoot().appendChild(bar);
  activeSnackbar = { dismiss, bar };
  return { dismiss };
}

/* ---------- date formatting ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jul 22" / "Jul 22, 2024" when not the current year. */
export function fmtDay(day, { withYear = 'auto' } = {}) {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  const thisYear = Number(todayString().slice(0, 4));
  const year = withYear === 'always' || (withYear === 'auto' && y !== thisYear) ? ` ${y}` : '';
  return `${MONTHS[m - 1]} ${d}${year}`;
}

/** "today" / "yesterday" / "3 days ago" / "in 2 days". */
export function fmtRelativeDay(day) {
  if (!day) return 'never';
  const diff = daysBetween(day, todayString());
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff === -1) return 'tomorrow';
  if (diff > 1) return `${diff} days ago`;
  return `in ${-diff} days`;
}

/** "Jul 22, 09:30" from a stored event timestamp. */
export function fmtDateTime(timestamp) {
  const day = dayOf(timestamp);
  if (!day) return String(timestamp);
  const time = /T(\d{2}:\d{2})/.exec(timestamp)?.[1];
  return time ? `${fmtDay(day)}, ${time}` : fmtDay(day);
}
