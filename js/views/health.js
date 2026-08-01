// Plant health: the pest & treatment diary. Every 'treatment' event, newest
// first, grouped into EPISODES (same plant, entries within 3 weeks of each
// other) so one mealybug campaign reads as one story — dates, dosages from
// the notes, photos taken while it ran, and how it ended. The search box is
// the whole point: next infestation, look up what worked last time.
//
// No schema of its own: episodes are derived from the existing event log
// (treatment events + nearby photo events), so hand-edits and old data
// group correctly for free.

import * as store from '../store.js';
import { isGardener } from '../settings.js';
import { el, icon, clear, fmtDay, fmtRelativeDay, showSheet } from '../ui.js';
import { dayOf, daysBetween } from '../../shared/dates.js';
import { plantPhoto, stateChip } from '../components/plant-row.js';
import { photoImg } from '../components/photo-img.js';
import { wateringStatus } from '../../shared/schedule.js';
import { openEventDialog } from '../components/event-dialog.js';

const EPISODE_GAP_DAYS = 21; // entries this close (same plant) = one episode
const ONGOING_DAYS = 14; // last entry this recent = still being fought

let query = '';
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    query = '';
  });
}

/** Treatment events grouped into per-plant episodes, newest first. */
function buildEpisodes(events, plantsById, today) {
  const byPlant = new Map();
  for (const event of events) {
    if (event.type !== 'treatment' || !dayOf(event.date)) continue;
    if (!byPlant.has(event.plantId)) byPlant.set(event.plantId, []);
    byPlant.get(event.plantId).push(event);
  }

  const episodes = [];
  for (const [plantId, list] of byPlant) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    let current = null;
    for (const event of list) {
      const day = dayOf(event.date);
      if (current && daysBetween(current.lastDay, day) <= EPISODE_GAP_DAYS) {
        current.entries.push(event);
        current.lastDay = day;
      } else {
        current = { plantId, entries: [event], firstDay: day, lastDay: day };
        episodes.push(current);
      }
    }
  }

  for (const episode of episodes) {
    episode.plant = plantsById.get(episode.plantId) ?? null;
    episode.ongoing = daysBetween(episode.lastDay, today) <= ONGOING_DAYS;
    // photos taken while the episode ran (±3 days) tell the visual story
    episode.photos = events.filter((event) => {
      if (event.type !== 'photo' || event.plantId !== episode.plantId) return false;
      if (typeof event.src !== 'string') return false;
      const day = dayOf(event.date);
      return (
        day &&
        daysBetween(episode.firstDay, day) >= -3 &&
        daysBetween(day, episode.lastDay) >= -3
      );
    });
  }

  episodes.sort((a, b) => (a.lastDay < b.lastDay ? 1 : -1));
  return episodes;
}

function matchesQuery(episode) {
  if (!query) return true;
  const q = query.toLowerCase();
  const hay = [
    episode.plant?.name ?? episode.plantId,
    episode.plant?.species ?? '',
    ...episode.entries.map((e) => e.note ?? ''),
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function render(container) {
  const root = el('div');
  container.appendChild(root);
  const canEdit = isGardener();

  root.appendChild(
    el(
      'div',
      { class: 'section-title' },
      el('h1', {}, 'Plant health'),
      canEdit
        ? el(
            'button',
            { class: 'btn btn--sm', onclick: () => pickPlantThenLog() },
            icon('treatment'),
            'Log a treatment',
          )
        : null,
    ),
  );

  const listRoot = el('div');
  const draw = () => {
    clear(listRoot);
    drawContent(listRoot);
  };

  root.appendChild(
    el(
      'div',
      { class: 'filter-bar' },
      el('input', {
        type: 'search',
        placeholder: 'Search treatments… (mealybugs, neem, mites)',
        'aria-label': 'Search the treatment diary',
        value: query,
        oninput: (e) => {
          query = e.target.value.trim();
          draw();
        },
      }),
    ),
  );
  root.appendChild(listRoot);
  draw();
}

function drawContent(root) {
  const { events, plantsById } = store.getSnapshot();
  const today = store.today();
  const canEdit = isGardener();

  const all = buildEpisodes(events, plantsById, today);
  const episodes = all.filter(matchesQuery);

  if (!all.length) {
    root.appendChild(
      el(
        'div',
        { class: 'empty-state' },
        icon('treatment'),
        el('p', {}, 'No treatments logged — the jungle is healthy. 🤞'),
        canEdit
          ? el(
              'p',
              { class: 'small' },
              'When pests show up, log a treatment with what you used and the dosage — future you will thank you.',
            )
          : null,
      ),
    );
    return;
  }

  if (query && !episodes.length) {
    root.appendChild(
      el('div', { class: 'empty-state', style: 'padding: 1rem' }, icon('treatment'),
        el('p', {}, 'No treatment matches that search.')),
    );
    return;
  }

  const ongoing = episodes.filter((e) => e.ongoing);
  const past = episodes.filter((e) => !e.ongoing);

  const section = (title, list, note) => {
    if (!list.length) return;
    root.appendChild(
      el(
        'div',
        { class: 'section-title' },
        el('h2', {}, title),
        note ? el('span', { class: 'muted small' }, note) : null,
      ),
    );
    for (const episode of list) root.appendChild(episodeCard(episode));
  };

  section('Being treated', ongoing, 'follow up and log the outcome');
  section('Past treatments', past, 'what worked, for next time');
}

function episodeCard(episode) {
  const { events, plantsById } = store.getSnapshot();
  const plant = episode.plant;
  const today = store.today();
  const season = store.currentSeason();
  const canEdit = isGardener();

  const range =
    episode.firstDay === episode.lastDay
      ? fmtDay(episode.firstDay, { withYear: 'always' })
      : `${fmtDay(episode.firstDay)} – ${fmtDay(episode.lastDay, { withYear: 'always' })}`;

  return el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'wish-card__head' },
      plant ? plantPhoto(plant) : null,
      el(
        'div',
        { class: 'plant-card__body' },
        plant
          ? el(
              'a',
              { class: 'plant-card__name', href: `#/plant/${encodeURIComponent(plant.id)}` },
              plant.name,
            )
          : el('span', { class: 'plant-card__name' }, episode.plantId),
        el(
          'div',
          { class: 'plant-card__meta' },
          el(
            'span',
            { class: `enc-badge ${episode.ongoing ? 'enc-badge--want' : 'enc-badge--got'}` },
            icon(episode.ongoing ? 'treatment' : 'check'),
            episode.ongoing ? 'being treated' : 'closed',
          ),
          el('span', { class: 'num' }, range),
          el('span', {}, `${episode.entries.length} ${episode.entries.length === 1 ? 'entry' : 'entries'}`),
        ),
      ),
      canEdit && plant && episode.ongoing
        ? el(
            'button',
            {
              class: 'btn btn--sm',
              onclick: () => openEventDialog(plant, { type: 'treatment' }),
            },
            'Follow up',
          )
        : null,
    ),
    // the entries themselves, oldest first — the story in order
    [...episode.entries].map((event) =>
      el(
        'div',
        { class: 'event-item' },
        el('span', { class: 'event-item__icon' }, icon('treatment')),
        el(
          'div',
          { class: 'event-item__body' },
          el(
            'div',
            {},
            el('strong', { class: 'num' }, fmtDay(dayOf(event.date))),
            el('span', { class: 'muted' }, ` · ${fmtRelativeDay(dayOf(event.date))} — ${event.author ?? '?'}`),
          ),
          event.note
            ? el('div', { class: 'small' }, event.note)
            : el('div', { class: 'small muted' }, 'no note — what was used?'),
        ),
      ),
    ),
    episode.photos.length
      ? el(
          'div',
          { class: 'photo-grid', style: 'margin-top: 0.5rem' },
          episode.photos.map((event) =>
            el(
              'a',
              {
                href: `#/plant/${encodeURIComponent(episode.plantId)}`,
                'aria-label': 'Photos from this treatment (on the profile)',
              },
              photoImg(event, {
                loading: 'lazy',
                alt: event.note ?? 'Treatment photo',
              }),
            ),
          ),
        )
      : null,
  );
}

/** "Log a treatment" from the diary: pick the plant, then the usual dialog. */
function pickPlantThenLog() {
  const { plants, events } = store.getSnapshot();
  const today = store.today();
  const season = store.currentSeason();
  const active = plants
    .filter((p) => p.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));
  const { close, body } = showSheet({ title: 'Treat which plant?' });
  if (!active.length) {
    body.append(
      el('p', { class: 'small muted' }, 'No active plants to treat.'),
      el('button', { class: 'btn', onclick: () => close() }, 'Close'),
    );
    return;
  }
  body.append(
    // Native append stringifies arrays — spread, always.
    ...active.map((plant) =>
      el(
        'button',
        {
          class: 'btn',
          style: 'width:100%;justify-content:flex-start;margin-bottom:8px',
          onclick: () => {
            close();
            openEventDialog(plant, { type: 'treatment' });
          },
        },
        plant.name,
        stateChip(wateringStatus(plant, events, today, season, { mode: store.scheduleMode() })),
      ),
    ),
  );
}
