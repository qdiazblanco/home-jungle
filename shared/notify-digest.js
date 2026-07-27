// Builds the daily Telegram digest from the warnings module's output
// (Phase 2). Pure: warnings + plants + previous state in, message out —
// unit-tested in Node, executed by scripts/notify.js in the Action.
//
// Digest policy:
// - Actionable warnings (watering-overdue: severity warn/urgent) appear
//   EVERY day until resolved — a thirsty plant deserves the nagging, and
//   the day count in the message changes daily anyway.
// - Informational warnings (seasonal light, feeding transitions) fire for
//   a whole month; they are sent ONCE, deduplicated by their stable ids
//   against the previous runs' state.

import { formatWarning, SEVERITY_RANK } from './warnings.js';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

export function escapeTelegramHtml(text) {
  return String(text).replace(/[&<>]/g, (c) => HTML_ESCAPES[c]);
}

const BULLETS = { urgent: '❗', warn: '💧', info: 'ℹ️' };

/**
 * @param {object} input
 *   warnings        getWarnings() output
 *   plantsById      Map<id, plant>
 *   previousInfoIds string[] — info-warning ids already notified
 *   siteUrl         absolute URL of the deployed app (for the footer link)
 * @returns {{ send, text, html, infoIds }}
 *   infoIds is the NEXT state to persist (all currently-firing info ids).
 */
export function buildDigest({ warnings, plantsById, previousInfoIds = [], siteUrl = '' }) {
  const actionable = warnings.filter((w) => w.severity !== 'info');
  const info = warnings.filter((w) => w.severity === 'info');
  const freshInfo = info.filter((w) => !previousInfoIds.includes(w.id));
  const infoIds = info.map((w) => w.id);

  const toSend = [...actionable, ...freshInfo].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  if (!toSend.length) {
    return { send: false, text: '', html: '', infoIds };
  }

  const lines = toSend.map((w) => {
    const plant = w.plantId ? plantsById.get(w.plantId) : null;
    return { bullet: BULLETS[w.severity] ?? '•', message: formatWarning(w, plant) };
  });

  const title = "Kipe's Home Jungle 🌿";
  const text = [title, '', ...lines.map((l) => `${l.bullet} ${l.message}`)].join('\n');

  const html = [
    `<b>${escapeTelegramHtml(title)}</b>`,
    '',
    ...lines.map((l) => `${l.bullet} ${escapeTelegramHtml(l.message)}`),
    ...(siteUrl ? ['', `<a href="${escapeTelegramHtml(siteUrl)}">Open the jungle</a>`] : []),
  ].join('\n');

  return { send: true, text, html, infoIds };
}
