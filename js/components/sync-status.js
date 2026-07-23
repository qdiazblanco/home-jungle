// Sync status chip — always visible in gardener mode (feature 8) — plus the
// detail sheet listing pending/parked changes with retry and discard.

import * as gh from '../github.js';
import { isGardener, onSettingsChange } from '../settings.js';
import { el, icon, clear, showSheet, confirmDialog, fmtDateTime } from '../ui.js';
import { describeOp } from '../../shared/ops.js';
import * as store from '../store.js';

const CHIP_CONTENT = {
  idle: () => [icon('check'), 'Saved'],
  saving: (s) => [icon('spinner'), s.pending > 1 ? `Saving… (${s.pending})` : 'Saving…'],
  offline: (s) => [icon('cloudOff'), `Offline — ${s.pending} queued`],
  auth: () => [icon('alert'), 'Token expired'],
  error: () => [icon('alert'), 'Sync issue'],
};

export function mountSyncStatus(container) {
  const render = () => {
    clear(container);
    if (!isGardener()) return; // visitors have nothing to sync
    const status = gh.getStatus();
    const content = (CHIP_CONTENT[status.state] ?? CHIP_CONTENT.idle)(status);
    container.appendChild(
      el(
        'button',
        {
          class: `sync-chip sync-chip--${status.state}`,
          'aria-label': `Sync status: ${status.state}`,
          onclick: () => openDetail(),
        },
        ...content,
      ),
    );
  };

  gh.onSyncChange(render);
  onSettingsChange(render);
  render();
}

function openDetail() {
  const { close, body } = showSheet({ title: 'Sync' });

  const render = () => {
    clear(body);
    const status = gh.getStatus();
    const queue = gh.pendingOps();
    const { plantsById } = store.getSnapshot();

    if (status.message) {
      body.appendChild(
        el(
          'div',
          { class: `banner ${status.state === 'auth' || status.state === 'error' ? 'banner--danger' : 'banner--info'}` },
          el('span', {}, status.message),
        ),
      );
    }

    if (!queue.length) {
      body.appendChild(
        el('p', { class: 'muted small' },
          status.lastSyncAt
            ? `Everything is saved to GitHub. Last sync ${fmtDateTime(status.lastSyncAt)}.`
            : 'Everything is saved to GitHub.'),
      );
    } else {
      body.appendChild(el('p', { class: 'small muted' }, 'Waiting to be committed:'));
      for (const entry of queue) {
        body.appendChild(
          el(
            'div',
            { class: `banner ${entry.parked ? 'banner--danger' : 'banner--info'}` },
            el(
              'div',
              {},
              el('div', {}, describeOp(entry.op, plantsById)),
              el('div', { class: 'small muted' },
                `queued ${fmtDateTime(entry.createdAt)}${entry.lastError ? ` — ${entry.lastError}` : ''}`),
            ),
            entry.parked
              ? el(
                  'button',
                  {
                    class: 'btn btn--sm btn--danger',
                    onclick: async () => {
                      const sure = await confirmDialog({
                        title: 'Discard this change?',
                        message: `"${describeOp(entry.op, plantsById)}" could not be saved and will be lost.`,
                        confirmLabel: 'Discard',
                        danger: true,
                      });
                      if (sure) gh.discardOp(entry.qid);
                    },
                  },
                  'Discard',
                )
              : null,
          ),
        );
      }
    }

    const actions = el('div', { class: 'sheet__actions' });
    if (status.state === 'auth' || status.kind === 'config') {
      actions.appendChild(
        el(
          'a',
          { class: 'btn btn--primary', href: '#/settings', onclick: () => close() },
          'Open Settings',
        ),
      );
    } else if (queue.some((e) => !e.parked)) {
      actions.appendChild(
        el('button', { class: 'btn btn--primary', onclick: () => gh.scheduleFlush(0) }, 'Retry now'),
      );
    }
    actions.appendChild(el('button', { class: 'btn', onclick: () => close() }, 'Close'));
    body.appendChild(actions);
  };

  const unsub = gh.onSyncChange(render);
  const origClose = close;
  render();
  // ensure we unsubscribe when the sheet closes
  const observer = new MutationObserver(() => {
    if (!document.body.contains(body)) {
      unsub();
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById('overlay-root'), { childList: true });
  return origClose;
}
