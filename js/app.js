// Bootstrap: load data, mount chrome (tab bar + sync chip), start the router.

import * as store from './store.js';
import { startRouter } from './router.js';
import { isGardener, onSettingsChange } from './settings.js';
import { el, icon, clear, snackbar } from './ui.js';
import { mountSyncStatus } from './components/sync-status.js';
import * as today from './views/today.js';
import * as care from './views/care.js';
import * as plant from './views/plant.js';
import * as plantForm from './views/plant-form.js';
import * as settingsView from './views/settings-view.js';

const VIEWS = {
  today,
  care,
  plant,
  'plant-edit': plantForm,
  add: plantForm,
  settings: settingsView,
};

// Form views manage their own inputs; re-rendering them on every store
// change would wipe what the gardener is typing.
const SELF_MANAGED = new Set(['plant-edit', 'add']);

const viewEl = document.getElementById('view');
const tabBarEl = document.getElementById('tab-bar');

let route = { name: 'today', params: {} };
let dismissedIssues = false;

/* ---------------- tab bar ---------------- */

function renderTabBar() {
  clear(tabBarEl);
  const tabs = [
    { href: '#/', label: 'Today', iconName: 'leaf', active: route.name === 'today' },
    { href: '#/care', label: 'Care', iconName: 'table', active: route.name === 'care' },
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

startRouter((next) => {
  route = next;
  window.scrollTo(0, 0);
  renderView();
});

store.subscribe(() => {
  if (SELF_MANAGED.has(route.name)) return;
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

      const promptUpdate = (worker) => {
        snackbar({
          message: 'A new version of the garden is ready.',
          actionLabel: 'Refresh',
          duration: 0,
          onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
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
        if (!reloaded) {
          reloaded = true;
          window.location.reload();
        }
      });
    } catch {
      /* PWA is progressive — the app works without it */
    }
  });
}
