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
 * Join message lines, dropping trailing lines (the least severe — the list
 * is sorted urgent→info) until the result fits the budget. Never cuts
 * mid-line, so no HTML tag, entity or emoji surrogate pair is ever
 * bisected — a raw slice would make Telegram reject the whole message.
 */
export function clampLines(head, lines, tail, budget) {
  const assemble = (kept, dropped) =>
    [
      ...head,
      ...kept,
      ...(dropped > 0 ? [`… and ${dropped} more — everything is in the app.`] : []),
      ...tail,
    ].join('\n');

  let kept = lines.length;
  let message = assemble(lines, 0);
  while (message.length > budget && kept > 1) {
    kept -= 1;
    message = assemble(lines.slice(0, kept), lines.length - kept);
  }
  return message;
}

/**
 * @param {object} input
 *   warnings        getWarnings() output
 *   plantsById      Map<id, plant>
 *   previousInfoIds string[] — info-warning ids already notified
 *   siteUrl         absolute URL of the deployed app (for the footer link)
 *   budget          max message length (Telegram caps at 4096)
 * @returns {{ send, text, html, infoIds }}
 *   infoIds is the NEXT state to persist (all currently-firing info ids).
 */
export function buildDigest({
  warnings,
  plantsById,
  previousInfoIds = [],
  siteUrl = '',
  budget = 3900,
}) {
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
  const text = clampLines(
    [title, ''],
    lines.map((l) => `${l.bullet} ${l.message}`),
    [],
    budget,
  );

  const html = clampLines(
    [`<b>${escapeTelegramHtml(title)}</b>`, ''],
    lines.map((l) => `${l.bullet} ${escapeTelegramHtml(l.message)}`),
    siteUrl ? ['', `<a href="${escapeTelegramHtml(siteUrl)}">Open the jungle</a>`] : [],
    budget,
  );

  return { send: true, text, html, infoIds };
}
