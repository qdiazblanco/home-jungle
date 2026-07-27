// Pot & repotting math (pure): suggested next pot size and how much
// substrate to prepare, split per the plant's substrate recipe.
//
// Conventions (documented so the numbers are arguable):
// - Pot sizes are the top inner diameter in cm (how shops label them).
// - A standard tapered round pot holds ≈ 0.45 × d³ cm³ (height ≈ diameter,
//   base ≈ 0.7 × d) — an 18 cm pot ≈ 2.6 L, matching real pots.
// - Size up gently: +2 cm below 15 cm, +3 cm up to 24 cm, +4 cm above.
//   Overpotting is the classic root-rot shortcut.
// - The root ball moves along and keeps ≈ 60% of the old pot's volume,
//   so fresh substrate ≈ new volume − 0.6 × old volume.

const round1 = (n) => Math.round(n * 10) / 10;

/** Suggested next pot diameter (cm), or null for unusable input. */
export function nextPotDiameter(diameter) {
  const d = Number(diameter);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (d < 15) return d + 2;
  if (d <= 24) return d + 3;
  return d + 4;
}

/** Approximate usable volume of a standard round pot, in liters. */
export function potVolumeLiters(diameter) {
  const d = Number(diameter);
  if (!Number.isFinite(d) || d <= 0) return null;
  return (0.45 * d ** 3) / 1000;
}

/** "60%" → 60, "2 parts" → 2, junk → null. */
export function parseRatio(ratio) {
  if (typeof ratio === 'number') return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  const match = /([0-9]+(?:[.,][0-9]+)?)/.exec(String(ratio ?? ''));
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The whole repotting plan for a plant.
 * @param {number} diameter current pot diameter in cm
 * @param {Array<{component, ratio}>} recipe effective substrate recipe
 * @returns {{ nextDiameter, nextVolumeLiters, substrateLiters,
 *             components: {component, liters}[] } | null}
 */
export function repotPlan(diameter, recipe = []) {
  const next = nextPotDiameter(diameter);
  if (next === null) return null;

  const newVolume = potVolumeLiters(next);
  const oldVolume = potVolumeLiters(diameter);
  // Root ball retained ≈ 60% of the old pot; never below a quarter of the
  // new pot (bare-rooted repots still need real substrate).
  const substrate = Math.max(newVolume - 0.6 * oldVolume, newVolume * 0.25);

  const parts = (Array.isArray(recipe) ? recipe : [])
    .map((part) => ({ component: part?.component, weight: parseRatio(part?.ratio) }))
    .filter((part) => part.component && part.weight !== null);
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  const components =
    total > 0
      ? parts.map((part) => ({
          component: part.component,
          liters: round1((substrate * part.weight) / total),
        }))
      : [];

  return {
    nextDiameter: next,
    nextVolumeLiters: round1(newVolume),
    substrateLiters: round1(substrate),
    components,
  };
}
