// Bootstrap: load data, mount chrome (tab bar + sync chip), start the router.

import * as store from './store.js';
import { startRouter } from './router.js';
import { initTheme } from './theme.js';
import { isGardener, onSettingsChange } from './settings.js';
import { el, icon, clear, snackbar } from './ui.js';
import { mountSyncStatus } from './components/sync-status.js';
import * as today from './views/today.js';
import * as care from './views/care.js';
import * as plant from './views/plant.js';
import * as plantForm from './views/plant-form.js';
import * as settingsView from './views/settings-view.js';
import * as wishlist from './views/wishlist.js';
import * as calendar from './views/calendar.js';
import * as houseMap from './views/map.js';

const VIEWS = {
  today,
  care,
  plant,
  'plant-edit': plantForm,
  add: plantForm,
  settings: settingsView,
  wishlist,
  calendar,
  map: houseMap,
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
  const entries = [
    { href: '#/calendar', label: 'Calendar', iconName: 'calendar', active: route.name === 'calendar' },
    { href: '#/map', label: 'House map', iconName: 'mapIcon', active: route.name === 'map' },
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
    { href: '#/wishlist', label: 'Wishlist', iconName: 'star', active: route.name === 'wishlist' },
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

  clear(viewEl);
  viewEl.className = `view${route.name === 'care' ? ' view--wide' : ''}`;
  if (state.issues.length && !dismissedIssues && route.name !== 'settings') {
    renderIssuesBanner(viewEl, state.issues);
  }
  (VIEWS[route.name] ?? today).render(viewEl, route.params, route.name);
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
