import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, escapeTelegramHtml, clampLines } from '../shared/notify-digest.js';
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

describe('buildDigest — length budget (Telegram caps messages at 4096)', () => {
  it('drops whole trailing lines, never bisecting a tag, entity or emoji', () => {
    // A jungle of 60 overdue plants would overflow a raw 4000-char slice.
    const plants = [];
    const events = [];
    for (let i = 0; i < 60; i++) {
      const plant = makePlant({ id: `p-${i}`, name: `Extraordinarily thirsty specimen №${i} & co` });
      plants.push(plant);
      events.push(makeEvent({ plantId: plant.id, date: '2026-07-01T10:00:00' }));
    }
    const warnings = getWarnings({ plants, events, today: '2026-07-22' });
    const digest = buildDigest({
      warnings,
      plantsById: new Map(plants.map((p) => [p.id, p])),
      siteUrl: 'https://example.github.io/home-jungle/',
    });
    assert.ok(digest.html.length <= 3900, `html is ${digest.html.length} chars`);
    assert.ok(digest.html.trimEnd().endsWith('</a>'), 'footer link stays intact');
    assert.match(digest.html, /… and \d+ more — everything is in the app\./);
    // No line was cut mid-way: every remaining warning line is complete.
    for (const line of digest.html.split('\n')) {
      assert.ok(!/&[a-z]*$/.test(line), `broken entity in: ${line.slice(-30)}`);
    }
  });

  it('keeps short digests untouched', () => {
    const { warnings, plantsById } = overdueSetup();
    const digest = buildDigest({ warnings, plantsById, siteUrl: 'https://x.y/' });
    assert.doesNotMatch(digest.html, /more — everything is in the app/);
  });
});

describe('clampLines', () => {
  it('joins under budget without a dropped-count line', () => {
    assert.equal(clampLines(['t'], ['a', 'b'], ['f'], 100), 't\na\nb\nf');
  });

  it('drops from the tail and reports the count', () => {
    const out = clampLines(['title'], ['line-1', 'line-2', 'line-3'], ['footer'], 30);
    assert.match(out, /^title\nline-1\n… and 2 more/);
    assert.ok(out.endsWith('footer'));
  });
});

describe('escapeTelegramHtml', () => {
  it('escapes the three Telegram-HTML specials', () => {
    assert.equal(escapeTelegramHtml('a<b>&c'), 'a&lt;b&gt;&amp;c');
  });
});
