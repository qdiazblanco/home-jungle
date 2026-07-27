import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextPotDiameter, potVolumeLiters, parseRatio, repotPlan, normalizePot } from '../shared/pot.js';

describe('nextPotDiameter', () => {
  it('sizes up gently across the bands', () => {
    assert.equal(nextPotDiameter(10), 12); // < 15 → +2
    assert.equal(nextPotDiameter(14), 16);
    assert.equal(nextPotDiameter(15), 18); // 15–24 → +3
    assert.equal(nextPotDiameter(24), 27);
    assert.equal(nextPotDiameter(25), 29); // > 24 → +4
  });

  it('rejects nonsense', () => {
    assert.equal(nextPotDiameter(0), null);
    assert.equal(nextPotDiameter(-3), null);
    assert.equal(nextPotDiameter('big'), null);
    assert.equal(nextPotDiameter(undefined), null);
  });
});

describe('potVolumeLiters', () => {
  it('matches real-world pot volumes roughly (assumed taper)', () => {
    // An 18 cm pot holds ~2.5–3 L in practice.
    const v18 = potVolumeLiters(18);
    assert.ok(v18 > 2.2 && v18 < 3.0, `18cm → ${v18} L`);
    const v12 = potVolumeLiters(12);
    assert.ok(v12 > 0.6 && v12 < 1.0, `12cm → ${v12} L`);
  });

  it('uses the real base diameter when given — wider base, more volume', () => {
    const tapered = potVolumeLiters(18, 12);   // steep taper
    const assumed = potVolumeLiters(18);       // default 0.7 → base 12.6
    const straight = potVolumeLiters(18, 18);  // cylinder
    assert.ok(tapered < assumed && assumed < straight,
      `${tapered} < ${assumed} < ${straight}`);
    // Cylinder check against π/4·D²·h·fill exactly:
    const exact = (0.8 * (Math.PI / 4) * 18 ** 2 * 18) / 1000;
    assert.ok(Math.abs(straight - exact) < 0.01);
  });
});

describe('normalizePot', () => {
  it('accepts numbers and pot objects, defaults the base to 0.7×top', () => {
    assert.deepEqual(normalizePot(20), { top: 20, base: 14 });
    assert.deepEqual(normalizePot({ diameter_cm: 20, base_diameter_cm: 16 }), { top: 20, base: 16 });
    assert.equal(normalizePot({ base_diameter_cm: 16 }), null);
    assert.equal(normalizePot('wide'), null);
  });
});

describe('parseRatio', () => {
  it('reads percents, parts and numbers', () => {
    assert.equal(parseRatio('60%'), 60);
    assert.equal(parseRatio('2 parts'), 2);
    assert.equal(parseRatio('1,5'), 1.5);
    assert.equal(parseRatio(30), 30);
  });

  it('returns null for junk', () => {
    assert.equal(parseRatio('a pinch'), null);
    assert.equal(parseRatio(''), null);
    assert.equal(parseRatio(null), null);
    assert.equal(parseRatio('0%'), null);
  });
});

describe('repotPlan', () => {
  const recipe = [
    { component: 'Potting mix', ratio: '60%' },
    { component: 'Perlite', ratio: '30%' },
    { component: 'Bark', ratio: '10%' },
  ];

  it('produces a coherent plan with a current-vs-next comparison', () => {
    const plan = repotPlan(18, recipe);
    assert.equal(plan.next.diameter, 21);
    assert.equal(plan.current.diameter, 18);
    assert.ok(plan.next.volumeLiters > plan.current.volumeLiters);
    assert.ok(Math.abs(plan.deltaLiters - (plan.next.volumeLiters - plan.current.volumeLiters)) < 0.11);
    assert.ok(plan.deltaPercent > 20 && plan.deltaPercent < 100, `Δ ${plan.deltaPercent}%`);
    assert.ok(plan.next.volumeLiters > plan.substrateLiters, 'root ball reduces fresh substrate');
    const sum = plan.components.reduce((a, c) => a + c.liters, 0);
    assert.ok(Math.abs(sum - plan.substrateLiters) < 0.35, `split ${sum} ≈ ${plan.substrateLiters}`);
    assert.equal(plan.components[0].component, 'Potting mix');
    assert.ok(plan.components[0].liters > plan.components[2].liters);
  });

  it('accepts a pot object and preserves its taper in the next pot', () => {
    const plan = repotPlan({ diameter_cm: 20, base_diameter_cm: 16 }, recipe);
    assert.equal(plan.current.baseDiameter, 16);
    assert.equal(plan.next.diameter, 23);
    // taper 0.8 preserved: 23 × 0.8 = 18.4
    assert.ok(Math.abs(plan.next.baseDiameter - 18.4) < 0.05);
    // straighter pot holds more than the assumed-taper equivalent
    const assumed = repotPlan(20, recipe);
    assert.ok(plan.current.volumeLiters > assumed.current.volumeLiters);
  });

  it('normalizes ratios that do not sum to 100', () => {
    const plan = repotPlan(12, [
      { component: 'Cactus mix', ratio: '2 parts' },
      { component: 'Perlite', ratio: '1 part' },
    ]);
    assert.ok(Math.abs(plan.components[0].liters - 2 * plan.components[1].liters) <= 0.15);
  });

  it('skips junk ratio rows and survives an empty recipe', () => {
    const plan = repotPlan(16, [{ component: 'Mystery', ratio: 'a pinch' }]);
    assert.deepEqual(plan.components, []);
    assert.ok(plan.substrateLiters > 0);
    assert.deepEqual(repotPlan(16, []).components, []);
  });

  it('returns null without a usable diameter', () => {
    assert.equal(repotPlan(undefined, recipe), null);
  });
});
