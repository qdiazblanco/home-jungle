// Hash router with the visitor-mode chokepoint: edit/add routes are
// unreachable without a token — deep links redirect to the read view, so no
// edit form can ever mount in visitor mode.

import { isGardener } from './settings.js';

const ROUTES = [
  { name: 'today', pattern: /^$/ },
  { name: 'care', pattern: /^care$/ },
  {
    name: 'plant',
    pattern: /^plant\/([^/]+)$/,
    params: (m) => ({ id: decodeURIComponent(m[1]) }),
  },
  {
    name: 'plant-edit',
    pattern: /^plant\/([^/]+)\/edit$/,
    params: (m) => ({ id: decodeURIComponent(m[1]) }),
    gardenerOnly: true,
    fallback: (m) => `#/plant/${m[1]}`,
  },
  { name: 'add', pattern: /^add$/, gardenerOnly: true, fallback: () => '#/' },
  { name: 'settings', pattern: /^settings$/ },
  // 'wishlist' is the pre-encyclopedia name — old bookmarks must keep working.
  { name: 'encyclopedia', pattern: /^(?:encyclopedia|wishlist)$/ },
  { name: 'calendar', pattern: /^calendar$/ },
  { name: 'map', pattern: /^map$/ },
];

function normalize(hash) {
  return hash.replace(/^#\/?/, '').replace(/\/+$/, '');
}

export function currentRoute() {
  const path = normalize(window.location.hash);
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (!match) continue;
    if (route.gardenerOnly && !isGardener()) {
      return { redirect: route.fallback(match) };
    }
    return { name: route.name, params: route.params ? route.params(match) : {} };
  }
  return { name: 'today', params: {} };
}

export function startRouter(onChange) {
  const apply = () => {
    const route = currentRoute();
    if (route.redirect) {
      window.location.replace(route.redirect);
      return;
    }
    onChange(route);
  };
  window.addEventListener('hashchange', apply);
  apply();
}

export function navigate(hash) {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}
