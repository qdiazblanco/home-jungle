// Calendar view (Phase 2, v2): a real month calendar — navigate months,
// see every logged event on its day, tap a day for the full detail. The
// month's seasonal notes (shared/calendar.js) sit condensed at the top.

import * as store from '../store.js';
import { el, icon, clear, fmtDateTime, fmtDay } from '../ui.js';
import { monthTasks } from '../../shared/calendar.js';
import { monthGrid, addMonths, monthOf, yearOf, dayOf } from '../../shared/dates.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

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

// Which month is shown; survives store-driven re-renders, resets on route
// change like the Today view's selection.
let shown = null; // { year, month }
let selectedDay = null;

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    shown = null;
    selectedDay = null;
  });
}

export function render(container) {
  const root = el('div');
  container.appendChild(root);
  const draw = () => {
    clear(root);
    drawContent(root, draw);
  };
  draw();
}

function drawContent(root, draw) {
  const { plants, events, plantsById } = store.getSnapshot();
  const today = store.today();
  shown ??= { year: yearOf(today), month: monthOf(today) };
  const { year, month } = shown;

  /* ---- events by day, once per draw ---- */
  const byDay = new Map();
  for (const event of events) {
    const day = dayOf(event.date);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(event);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /* ---- header with month navigation ---- */
  const shift = (n) => {
    shown = addMonths(year, month, n);
    selectedDay = null;
    draw();
  };

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'Calendar'),
      el(
        'span',
        { class: 'cal-nav' },
        el(
          'button',
          { class: 'btn btn--icon btn--sm', 'aria-label': 'Previous month', onclick: () => shift(-1) },
          icon('back'),
        ),
        el('strong', { class: 'cal-nav__label num' }, `${MONTH_NAMES[month - 1]} ${year}`),
        el(
          'button',
          { class: 'btn btn--icon btn--sm', 'aria-label': 'Next month', onclick: () => shift(1) },
          icon('chevronRight'),
        ),
      ),
    ),
  );

  if (year !== yearOf(today) || month !== monthOf(today)) {
    root.appendChild(
      el(
        'button',
        {
          class: 'btn btn--ghost btn--sm',
          onclick: () => {
            shown = null;
            selectedDay = null;
            draw();
          },
        },
        'Back to this month',
      ),
    );
  }

  /* ---- seasonal notes for the shown month, condensed ---- */
  const tasks = monthTasks(month, plants);
  if (tasks.length) {
    root.appendChild(
      el(
        'div',
        { class: 'card cal-season' },
        tasks.map((task) =>
          el(
            'div',
            { class: 'cal-season__item small' },
            el('strong', {}, task.title),
            el('span', { class: 'muted' }, ` — ${task.detail}`),
            task.plantIds.length
              ? el(
                  'span',
                  {},
                  ' ',
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
  }

  /* ---- the month grid ---- */
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthEventCount = [...byDay.entries()]
    .filter(([day]) => day.startsWith(monthPrefix))
    .reduce((sum, [, list]) => sum + list.length, 0);

  const grid = el(
    'div',
    { class: 'cal-grid' },
    WEEKDAYS.map((wd) => el('div', { class: 'cal-grid__weekday small muted' }, wd)),
    monthGrid(year, month)
      .flat()
      .map((cell) => {
        const dayEvents = byDay.get(cell.day) ?? [];
        const isToday = cell.day === today;
        const isSelected = cell.day === selectedDay;
        return el(
          'button',
          {
            class:
              'cal-cell' +
              (cell.inMonth ? '' : ' cal-cell--outside') +
              (isToday ? ' cal-cell--today' : '') +
              (isSelected ? ' cal-cell--selected' : ''),
            'aria-label': `${fmtDay(cell.day, { withYear: 'always' })}, ${dayEvents.length} ${
              dayEvents.length === 1 ? 'entry' : 'entries'
            }`,
            'aria-pressed': String(isSelected),
            onclick: () => {
              selectedDay = selectedDay === cell.day ? null : cell.day;
              draw();
            },
          },
          el('span', { class: 'cal-cell__num num' }, String(Number(cell.day.slice(8)))),
          dayEvents.length
            ? el(
                'span',
                { class: 'cal-cell__dots' },
                dayEvents
                  .slice(0, 3)
                  .map((event) => el('span', { class: `cal-dot cal-dot--${event.type}`, title: event.type })),
                dayEvents.length > 3
                  ? el('span', { class: 'cal-cell__more' }, `+${dayEvents.length - 3}`)
                  : null,
              )
            : null,
        );
      }),
  );
  root.appendChild(el('div', { class: 'card cal-card' }, grid));
  root.appendChild(
    el(
      'p',
      { class: 'small muted num' },
      `${monthEventCount} ${monthEventCount === 1 ? 'entry' : 'entries'} logged this month.`,
    ),
  );

  /* ---- selected-day detail ---- */
  if (selectedDay) {
    const dayEvents = byDay.get(selectedDay) ?? [];
    root.appendChild(
      el(
        'div',
        { class: 'section-title' },
        el('h2', {}, fmtDay(selectedDay, { withYear: 'always' })),
        el('span', { class: 'muted small' }, selectedDay === today ? 'today' : ''),
      ),
    );
    const card = el('div', { class: 'card' });
    if (!dayEvents.length) {
      card.appendChild(el('p', { class: 'muted small' }, 'Nothing logged this day.'));
    }
    for (const event of dayEvents) {
      const plant = plantsById.get(event.plantId);
      card.appendChild(
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
              ' · ',
              plant
                ? el('a', { href: `#/plant/${encodeURIComponent(plant.id)}` }, plant.name)
                : el('span', { class: 'muted' }, event.plantId),
            ),
            el('div', { class: 'event-item__meta' }, `${fmtDateTime(event.date)} — ${event.author ?? '?'}`),
            event.note ? el('div', { class: 'small' }, event.note) : null,
          ),
        ),
      );
    }
    root.appendChild(card);
  } else {
    root.appendChild(el('p', { class: 'small muted' }, 'Tap a day to see everything logged on it.'));
  }
}
