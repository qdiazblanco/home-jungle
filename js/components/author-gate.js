// First-write author prompt: events need an author (Kike/Pepa) and commits
// are attributed to them, so the first logging action on a fresh device asks
// once and saves the answer to Settings.

import { getSettings, saveSettings } from '../settings.js';
import { el, showSheet } from '../ui.js';

export const KNOWN_GARDENERS = ['Kike', 'Pepa'];

/** Resolves with the author name, prompting once if unset; null on cancel. */
export function ensureAuthor() {
  const current = getSettings().author;
  if (current) return Promise.resolve(current);

  return new Promise((resolve) => {
    let done = false;
    const { close, body } = showSheet({
      title: 'Who is gardening?',
      center: true,
      onClose: () => {
        if (!done) resolve(null);
      },
    });

    const pick = (name) => {
      done = true;
      saveSettings({ author: name });
      close();
      resolve(name);
    };

    const otherInput = el('input', { type: 'text', placeholder: 'Another name…' });
    body.append(
      el('p', { class: 'small muted' }, 'Logged events and commits will carry this name. You can change it in Settings.'),
      el(
        'div',
        { class: 'sheet__actions' },
        KNOWN_GARDENERS.map((name) =>
          el('button', { class: 'btn btn--primary', onclick: () => pick(name) }, name),
        ),
      ),
      el(
        'div',
        { class: 'sheet__actions' },
        otherInput,
        el(
          'button',
          {
            class: 'btn',
            onclick: () => {
              const name = otherInput.value.trim();
              if (name) pick(name);
            },
          },
          'Use',
        ),
      ),
    );
  });
}
