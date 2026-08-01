// Theme switch: 'auto' | 'light' | 'dark', a device-local setting.
// Resolves 'auto' through prefers-color-scheme, stamps data-theme on <html>
// (tokens.css keys off it — there is no unthemed state), reacts to live
// system changes, and keeps <meta name="theme-color"> in sync so the PWA
// title bar matches the paper instead of staying leaf-green at night.
//
// index.html runs a tiny inline copy of this logic before first paint to
// avoid a light flash on dark systems — keep the two in sync.

import { getSettings, saveSettings, onSettingsChange } from './settings.js';

const THEME_COLORS = { light: '#3e6b4a', dark: '#181c16' };

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function resolvedTheme() {
  const { theme } = getSettings();
  if (theme === 'light' || theme === 'dark') return theme;
  return darkQuery.matches ? 'dark' : 'light';
}

export function applyTheme() {
  const mode = resolvedTheme();
  document.documentElement.dataset.theme = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[mode]);
}

export function initTheme() {
  applyTheme();
  darkQuery.addEventListener('change', applyTheme);
  onSettingsChange(applyTheme);
}

/** The theme currently in effect ('light' | 'dark'), after resolving auto. */
export function currentTheme() {
  return resolvedTheme();
}

/** Header toggle: flip the RESOLVED theme, stored as an explicit choice
 * (Settings still offers 'auto' to hand control back to the system). */
export function toggleTheme() {
  saveSettings({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' });
}
