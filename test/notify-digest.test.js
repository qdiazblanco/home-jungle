import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, escapeTelegramHtml } from '../shared/notify-digest.js';
import { getWarnings } from '../shared/warnings.js';
import { makePlant, makeEvent } from './fixtures.js';

const overdueSetup = () => {
  const plant = makePlant(); // summer interval 7
  const events = [makeEvent({ date: '2026-07-12T10:00:00' })]; // 10 days before the 22nd
  const warnings = getWarnings({ plants: [plant], events, today: '2026-07-22' });
  return { plant, warnings, plantsById: new Map([[plant.id, plant]]) };
};

describe('buildDigest', () => {
  it('sends nothing when there are no warnings', () => {
    const digest = buildDigest({ warnings: [], plantsById: new Map() });
    assert.equal(digest.send, false);
    assert.deepEqual(digest.infoIds, []);
  });

  it('includes actionable warnings every day, regardless of previous state', () => {
    const { warnings, plantsById } = overdueSetup();
    const digest = buildDigest({
      warnings,
      plantsById,
      previousInfoIds: warnings.map((w) => w.id), // even if somehow recorded
    });
    assert.equal(digest.send, true);
    assert.match(digest.text, /10 days since you watered Test plant/);
  });

  it('sends info warnings once, then suppresses them by stable id', () => {
    const plant = makePlant();
    plant.care.reference.sun_need = 'high';
    const plantsById = new Map([[plant.id, plant]]);
    const warnings = getWarnings({ plants: [plant], events: [makeEvent({ date: '2026-09-09T10:00:00' })], today: '2026-09-10' });
    const infoIds = warnings.filter((w) => w.severity === 'info').map((w) => w.id);
    assert.ok(infoIds.length >= 1, 'setup should produce a seasonal-light info warning');

    const first = buildDigest({ warnings, plantsById, previousInfoIds: [] });
    assert.equal(first.send, true);
    assert.match(first.text, /October is coming/);
    assert.deepEqual(first.infoIds, infoIds);

    const second = buildDigest({ warnings, plantsById, previousInfoIds: first.infoIds });
    // The overdue line still goes out daily; the info line does not repeat.
    assert.doesNotMatch(second.text, /October is coming/);
  });

  it('orders urgent before warn before info', () => {
    const thirsty = makePlant({ id: 'thirsty' }); // very overdue → urgent
    const sunny = makePlant({ id: 'sunny', name: 'Sunny' });
    sunny.care.reference.sun_need = 'high';
    const events = [
      makeEvent({ plantId: 'thirsty', date: '2026-08-20T10:00:00' }),
      makeEvent({ plantId: 'sunny', date: '2026-09-09T10:00:00' }),
    ];
    const warnings = getWarnings({ plants: [thirsty, sunny], events, today: '2026-09-10' });
    const digest = buildDigest({
      warnings,
      plantsById: new Map([[thirsty.id, thirsty], [sunny.id, sunny]]),
    });
    const lines = digest.text.split('\n').filter((l) => /^[❗💧ℹ]/u.test(l));
    assert.match(lines[0], /^❗/u);
    assert.match(lines[lines.length - 1], /^ℹ/u);
  });

  it('escapes plant names in the HTML variant and appends the site link', () => {
    const villain = makePlant({ id: 'villain', name: '<b>Ficus & Sons</b>' });
    const events = [makeEvent({ plantId: 'villain', date: '2026-07-12T10:00:00' })];
    const warnings = getWarnings({ plants: [villain], events, today: '2026-07-22' });
    const digest = buildDigest({
      warnings,
      plantsById: new Map([[villain.id, villain]]),
      siteUrl: 'https://example.github.io/home-jungle/',
    });
    assert.ok(!digest.html.includes('<b>Ficus'));
    assert.ok(digest.html.includes('&lt;b&gt;Ficus &amp; Sons&lt;/b&gt;'));
    assert.ok(digest.html.includes('href="https://example.github.io/home-jungle/"'));
  });
});

describe('escapeTelegramHtml', () => {
  it('escapes the three Telegram-HTML specials', () => {
    assert.equal(escapeTelegramHtml('a<b>&c'), 'a&lt;b&gt;&amp;c');
  });
});
