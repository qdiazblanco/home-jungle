// Seasonal calendar view (Phase 2): the whole year month by month, current
// month first in focus. Fed by shared/calendar.js — the same seasonal logic
// the warnings use.

import * as store from '../store.js';
import { el, icon, clear } from '../ui.js';
import { yearTasks } from '../../shared/calendar.js';
import { monthOf } from '../../shared/dates.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TASK_ICONS = {
  'feeding-resume': 'feeding',
  'feeding-stop': 'feeding',
  'seasonal-light': 'sun',
  repotting: 'repotting',
  'protect-tropicals': 'misting',
  'heating-season': 'misting',
  'summer-rhythm': 'water',
  'winter-rhythm': 'water',
  'peak-heat': 'sun',
  'peak-growth': 'leaf',
  'holiday-check': 'note',
  'deep-winter': 'water',
  'late-winter': 'sun',
};

const iconFor = (task) => {
  const key = task.id.split(':')[1];
  return TASK_ICONS[key] ?? 'calendar';
};

export function render(container) {
  const root = el('div');
  container.appendChild(root);
  clear(root);

  const { plants, plantsById } = store.getSnapshot();
  const currentMonth = monthOf(store.today());

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'Seasonal calendar'),
      el('span', { class: 'muted small' }, 'what the year asks of the jungle'),
    ),
  );

  // Current month first, then the rest of the year in reading order.
  const year = yearTasks(plants);
  const ordered = [...year.slice(currentMonth - 1), ...year.slice(0, currentMonth - 1)];

  let currentCard = null;
  for (const { month, tasks } of ordered) {
    const isNow = month === currentMonth;
    const card = el(
      'div',
      { class: `card month-card${isNow ? ' month-card--now' : ''}` },
      el(
        'div',
        { class: 'month-card__head' },
        el('h2', {}, MONTH_NAMES[month - 1]),
        isNow ? el('span', { class: 'state-chip state-chip--fine' }, icon('calendar'), el('span', {}, 'now')) : null,
      ),
      tasks.map((task) =>
        el(
          'div',
          { class: 'task-item' },
          el('span', { class: 'task-item__icon' }, icon(iconFor(task))),
          el(
            'div',
            {},
            el('strong', {}, task.title),
            el('div', { class: 'small muted' }, task.detail),
            task.plantIds.length
              ? el(
                  'div',
                  { class: 'small task-item__plants' },
                  task.plantIds.flatMap((id, i) => {
                    const plant = plantsById.get(id);
                    if (!plant) return [];
                    return [
                      i ? ', ' : '',
                      el('a', { href: `#/plant/${encodeURIComponent(id)}` }, plant.name),
                    ];
                  }),
                )
              : null,
          ),
        ),
      ),
    );
    root.appendChild(card);
    if (isNow) currentCard = card;
  }

  void currentCard; // current month is already first — no scrolling needed
}
