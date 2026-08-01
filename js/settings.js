// Device-local settings (localStorage): token, author, season override,
// repo coordinates. The token IS the auth — no token means visitor mode.

const KEY = 'digital-garden:settings';

const DEFAULTS = {
  token: '',
  author: '',
  seasonOverride: 'auto', // 'auto' | 'summer' | 'winter'
  seasonMode: 'binary', // 'binary' | 'blended' (monthly interval interpolation)
  theme: 'auto', // 'auto' | 'light' | 'dark' (js/theme.js applies it)
  owner: '',
  repo: '',
  branch: '',
};

let cache = null;
const listeners = new Set();

export function getSettings() {
  if (!cache) {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      stored = {};
    }
    cache = { ...DEFAULTS, ...stored };
  }
  return cache;
}

export function saveSettings(patch) {
  cache = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(cache));
  for (const fn of listeners) fn(cache);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Gardener mode = a token is configured. Everything write-shaped keys off this. */
export function isGardener() {
  return Boolean(getSettings().token);
}

/**
 * Repo coordinates for the GitHub API. Auto-derived from the Pages URL
 * (owner.github.io/repo/), with a manual override in Settings for custom
 * domains and local development.
 */
export function repoCoords() {
  const s = getSettings();
  if (s.owner && s.repo) {
    return { owner: s.owner, repo: s.repo, branch: s.branch || 'main' };
  }
  const match = window.location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!match) return null;
  const owner = match[1];
  const firstSegment = window.location.pathname.split('/').filter(Boolean)[0];
  return {
    owner,
    repo: firstSegment || `${owner}.github.io`,
    branch: s.branch || 'main',
  };
}
