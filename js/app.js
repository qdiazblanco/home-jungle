// Bootstrap: load data, mount chrome (tab bar + sync chip), start the router.

import * as store from './store.js';
import { startRouter } from './router.js';
import { initTheme, currentTheme, toggleTheme } from './theme.js';
import { isGardener, onSettingsChange } from './settings.js';
import { el, icon, clear, snackbar } from './ui.js';
import { mountSyncStatus } from './components/sync-status.js';
import * as today from './views/today.js';
import * as care from './views/care.js';
import * as plant from './views/plant.js';
import * as plantForm from './views/plant-form.js';
import * as settingsView from './views/settings-view.js';
import * as encyclopedia from './views/encyclopedia.js';
import * as calendar from './views/calendar.js';
import * as houseMap from './views/map.js';
import * as health from './views/health.js';

const VIEWS = {
  today,
  care,
  plant,
  'plant-edit': plantForm,
  add: plantForm,
  settings: settingsView,
  encyclopedia,
  calendar,
  map: houseMap,
  health,
};

// Form views manage their own inputs; re-rendering them on every store
// change would wipe what the gardener is typing.
const SELF_MANAGED = new Set(['plant-edit', 'add']);

const viewEl = document.getElementById('view');
const tabBarEl = document.getElementById('tab-bar');
const headerNavEl = document.getElementById('header-nav');

let route = { name: 'today', params: {} };
let dismissedIssues = false;
let renderedPhase = null;

/* ---------------- tab bar ---------------- */

function renderHeaderNav() {
  clear(headerNavEl);
  // Theme toggle first: one tap flips light/dark (stored as an explicit
  // choice; Settings' "Auto" hands control back to the system).
  const dark = currentTheme() === 'dark';
  headerNavEl.appendChild(
    el(
      'button',
      {
        class: 'header-nav__link',
        type: 'button',
        'aria-label': dark ? 'Switch to the light theme' : 'Switch to the dark theme',
        title: dark ? 'Light theme' : 'Dark theme',
        onclick: toggleTheme,
      },
      icon(dark ? 'sun' : 'moon'),
    ),
  );
  const entries = [
    { href: '#/calendar', label: 'Calendar', iconName: 'calendar', active: route.name === 'calendar' },
    { href: '#/map', label: 'House map', iconName: 'mapIcon', active: route.name === 'map' },
    { href: '#/health', label: 'Plant health', iconName: 'bug', active: route.name === 'health' },
  ];
  for (const entry of entries) {
    headerNavEl.appendChild(
      el(
        'a',
        {
          class: `header-nav__link${entry.active ? ' header-nav__link--active' : ''}`,
          href: entry.href,
          'aria-label': entry.label,
          title: entry.label,
          ...(entry.active ? { 'aria-current': 'page' } : {}),
        },
        icon(entry.iconName),
      ),
    );
  }
}

function renderTabBar() {
  renderHeaderNav();
  clear(tabBarEl);
  const tabs = [
    { href: '#/', label: 'Today', iconName: 'leaf', active: route.name === 'today' },
    { href: '#/care', label: 'Care', iconName: 'table', active: route.name === 'care' },
    { href: '#/encyclopedia', label: 'Plants', iconName: 'book', active: route.name === 'encyclopedia' },
  ];
  if (isGardener()) {
    tabs.push({ href: '#/add', label: 'Add', iconName: 'plus', active: route.name === 'add' });
  }
  tabs.push({
    href: '#/settings',
    label: 'Settings',
    iconName: 'gear',
    active: route.name === 'settings',
  });
  for (const tab of tabs) {
    tabBarEl.appendChild(
      el(
        'a',
        {
          class: 'tab-bar__link',
          href: tab.href,
          ...(tab.active ? { 'aria-current': 'page' } : {}),
        },
        icon(tab.iconName),
        el('span', {}, tab.label),
      ),
    );
  }
}

/* ---------------- error & loading screens ---------------- */

function renderErrorScreen(state) {
  clear(viewEl);
  viewEl.appendChild(
    el(
      'div',
      { class: 'error-screen' },
      el('h1', {}, 'The garden data has a problem'),
      el(
        'p',
        {},
        'The app refused to render (and will not write) until this is fixed, ',
        'so nothing gets corrupted:',
      ),
      el(
        'pre',
        {},
        state.errors.map((e) => `• ${e.path}: ${e.message}`).join('\n'),
      ),
      el(
        'p',
        { class: 'small muted' },
        'Fix it by editing the file on GitHub (data folder) or reverting the ',
        'last data commit. The README covers hand-editing rules.',
      ),
      el('button', { class: 'btn btn--primary', onclick: () => store.load() }, 'Reload data'),
    ),
  );
}

function renderIssuesBanner(container, issues) {
  container.appendChild(
    el(
      'div',
      { class: 'banner banner--info' },
      icon('info', 'warning-item__icon'),
      el(
        'div',
        {},
        el('strong', {}, `${issues.length} data ${issues.length === 1 ? 'wrinkle' : 'wrinkles'} worth a look. `),
        el('span', { class: 'small' }, issues.map((i) => i.message).join(' ')),
      ),
      el(
        'button',
        {
          class: 'btn btn--sm btn--ghost',
          'aria-label': 'Dismiss',
          onclick: () => {
            dismissedIssues = true;
            renderView();
          },
        },
        'Dismiss',
      ),
    ),
  );
}

/* ---------------- view rendering ---------------- */

function renderView() {
  const state = store.getState();
  renderedPhase = state.phase;
  renderTabBar();

  if (state.phase === 'loading') {
    clear(viewEl).appendChild(
      el('div', { class: 'boot-message' }, el('p', {}, 'Watering the data…')),
    );
    return;
  }
  if (state.phase === 'error') {
    renderErrorScreen(state);
    return;
  }

  // A store-driven re-render can land mid-word in a filter/search box (e.g.
  // a background flush finishing). Remember which labelled control held
  // focus and restore it (with the cursor) after the rebuild.
  const focused = document.activeElement;
  const restore =
    focused &&
    viewEl.contains(focused) &&
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(focused.tagName) &&
    focused.getAttribute('aria-label')
      ? {
          label: focused.getAttribute('aria-label'),
          start: focused.selectionStart,
          end: focused.selectionEnd,
        }
      : null;

  clear(viewEl);
  viewEl.className = `view${route.name === 'care' ? ' view--wide' : ''}`;
  if (state.issues.length && !dismissedIssues && route.name !== 'settings') {
    renderIssuesBanner(viewEl, state.issues);
  }
  (VIEWS[route.name] ?? today).render(viewEl, route.params, route.name);

  if (restore) {
    const again = viewEl.querySelector(
      `input[aria-label="${CSS.escape(restore.label)}"], select[aria-label="${CSS.escape(restore.label)}"], textarea[aria-label="${CSS.escape(restore.label)}"]`,
    );
    if (again) {
      again.focus({ preventScroll: true });
      if (restore.start != null && typeof again.setSelectionRange === 'function') {
        try {
          again.setSelectionRange(restore.start, restore.end ?? restore.start);
        } catch {
          /* selection is not supported on every input type */
        }
      }
      return; // keep the user's caret — skip the container focus below
    }
  }
  viewEl.focus({ preventScroll: true });
}

/* ---------------- boot ---------------- */

initTheme();

startRouter((next) => {
  route = next;
  window.scrollTo(0, 0);
  renderView();
});

store.subscribe(() => {
  // Skip store-driven re-renders of form views only once they have rendered
  // with ready data — the initial loading→ready transition must still draw
  // (otherwise a deep link to #/add would hang on the loading screen).
  if (SELF_MANAGED.has(route.name) && renderedPhase === 'ready') return;
  renderView();
});
onSettingsChange(() => renderTabBar());
// In Auto mode an OS scheme flip restyles the page via js/theme.js — the
// header's sun/moon toggle must follow, or its label promises the opposite
// of what a tap would do.
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => renderTabBar());

mountSyncStatus(document.getElementById('sync-status'));
store.load();

/* ---------------- service worker & update flow ---------------- */
// Registered on real hosts only — localhost stays SW-free so development
// never fights a cache. New deploys install in the background; the user
// activates them from a persistent "new version" snackbar (no torn,
// mixed-version module graphs).
if ('serviceWorker' in navigator && !/^(localhost|127\.|192\.168\.)/.test(location.hostname)) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');

      // Reload only when the user explicitly activated an update — the
      // first install also fires controllerchange (clients.claim) and must
      // not yank the page from under the visitor.
      let activationRequested = false;

      const promptUpdate = (worker) => {
        snackbar({
          message: 'A new version of the garden is ready.',
          actionLabel: 'Refresh',
          duration: 0,
          onAction: () => {
            activationRequested = true;
            worker.postMessage({ type: 'SKIP_WAITING' });
          },
        });
      };

      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            promptUpdate(worker);
          }
        });
      });

      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (activationRequested && !reloaded) {
          reloaded = true;
          window.location.reload();
        }
      });
    } catch {
      /* PWA is progressive — the app works without it */
    }
  });
}
