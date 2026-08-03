// Daily notification runner (Phase 2) — executed by the notify workflow on
// a GitHub Actions runner, never by the browser.
//
// Reads the checked-out data files, reuses the exact same shared modules as
// the app (validate → warnings → digest), diffs info-warnings against the
// cached state so month-long notices fire once, and sends the digest to a
// Telegram chat via the bot API.
//
// Environment:
//   TELEGRAM_BOT_TOKEN  bot token from @BotFather        (repo secret)
//   TELEGRAM_CHAT_ID    target chat/group id             (repo secret)
//   SITE_URL            deployed app URL for the footer link (optional)
//   STATE_FILE          path of the dedup state JSON (default .notify-state.json)
//
// Missing secrets are a graceful no-op (exit 0) so the cron doesn't turn
// red before the bot is configured. Broken data is a LOUD failure (exit 1)
// and, when possible, its own Telegram alert.

import { readFile, writeFile } from 'node:fs/promises';
import { validateData } from '../shared/validate.js';
import { getWarnings } from '../shared/warnings.js';
import { todayString } from '../shared/dates.js';
import { buildDigest, escapeTelegramHtml, clampLines } from '../shared/notify-digest.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';
const SITE_URL = process.env.SITE_URL ?? '';
const STATE_FILE = process.env.STATE_FILE || '.notify-state.json';

async function sendTelegram(html) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`Telegram API error ${res.status}: ${body.description ?? 'unknown'}`);
  }
}

async function readState() {
  try {
    const state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    return Array.isArray(state.infoIds) ? state : { infoIds: [] };
  } catch {
    return { infoIds: [] }; // first run or evicted cache → worst case one repeat
  }
}

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('Telegram secrets not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) — skipping.');
    return;
  }

  // Two crons bracket the DST change so the digest lands at ~08:00 Madrid
  // year-round. Schedule-run rules, lateness-tolerant on purpose (GitHub
  // fires crons best-effort — sometimes hours late, sometimes dropping one
  // entirely — so an exact-hour match would silently lose those days):
  // - before 08:00 local: this is the off-season cron; the sibling covers it;
  // - state already stamped with today: a sibling run has handled today.
  const state = await readState();
  if (process.env.NOTIFY_DST_GUARD === 'true') {
    if (new Date().getHours() < 8) {
      console.log('Before 08:00 in Madrid — the sibling cron covers today.');
      return;
    }
    if (state.date === todayString()) {
      console.log('Today was already handled by the sibling run.');
      return;
    }
  }

  // Manual test from the workflow_dispatch "ping" input: prove the bot
  // wiring end-to-end even when nothing is due. Leaves the dedup state
  // untouched.
  if (process.env.NOTIFY_PING === 'true') {
    await sendTelegram(
      "<b>Kipe's Home Jungle 🌿</b>\n\nTest ping — the bot wiring works. Daily digests arrive at 08:00.",
    );
    console.log('Ping sent.');
    return;
  }

  const plants = JSON.parse(await readFile('data/plants.json', 'utf8'));
  const events = JSON.parse(await readFile('data/events.json', 'utf8'));

  const today = todayString(); // workflow sets TZ=Europe/Madrid
  const { errors } = validateData(plants, events, { today });
  if (errors.length) {
    const list = errors.map((e) => `- ${e.path}: ${e.message}`);
    console.error(`Data validation failed:\n${list.join('\n')}`);
    // Escape: validator messages embed raw data values, and an unescaped
    // "<" would make Telegram reject the alert exactly when it matters.
    await sendTelegram(
      clampLines(
        ["<b>Kipe's Home Jungle 🌿</b>", '', '⚠️ The garden data has a problem and notifications are paused:'],
        list.map((line) => escapeTelegramHtml(line)),
        [],
        3900,
      ),
    );
    process.exit(1);
  }

  const warnings = getWarnings({ plants, events, today });
  const digest = buildDigest({
    warnings,
    plantsById: new Map(plants.map((p) => [p.id, p])),
    previousInfoIds: state.infoIds,
    siteUrl: SITE_URL,
  });

  if (!digest.send) {
    await writeFile(STATE_FILE, JSON.stringify({ date: today, infoIds: digest.infoIds }, null, 2));
    console.log(`Nothing to report for ${today} — the jungle is content.`);
    return;
  }

  // Send FIRST, persist after: if the send fails, yesterday's state file
  // survives (the cache re-saves it), so tomorrow retries the info notices
  // instead of marking them delivered when they never were.
  await sendTelegram(digest.html);
  await writeFile(STATE_FILE, JSON.stringify({ date: today, infoIds: digest.infoIds }, null, 2));
  console.log(`Sent digest for ${today}:\n${digest.text}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
