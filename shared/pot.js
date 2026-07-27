// Pot & repotting math (pure): suggested next pot size and how much
// substrate to prepare, split per the plant's substrate recipe.
//
// Model (documented so the numbers are arguable):
// - Pots are truncated cones: top inner diameter D (how shops label them)
//   and base diameter d. When the base is unknown we assume d = 0.7 × D,
//   the common taper. Height ≈ D, as on standard round pots.
// - Usable volume = 80% of the geometric frustum (rim headroom + drainage):
//   V = 0.8 × (π·h/12) × (D² + D·d + d²), h = D.
//   An 18 cm pot → ≈ 2.7 L, matching real pots.
// - Size up gently: +2 cm below 15 cm, +3 cm up to 24 cm, +4 cm above.
//   The next pot keeps the current pot's taper.
// - The root ball moves along and keeps ≈ 60% of the old pot's volume,
//   so fresh substrate ≈ new volume − 0.6 × old volume.

const round1 = (n) => Math.round(n * 10) / 10;

const DEFAULT_TAPER = 0.7;
const FILL_FACTOR = 0.8;

/** Normalize number | {diameter_cm, base_diameter_cm} → {top, base} | null. */
export function normalizePot(pot) {
  const top = Number(typeof pot === 'object' && pot !== null ? pot.diameter_cm : pot);
  if (!Number.isFinite(top) || top <= 0) return null;
  const rawBase = typeof pot === 'object' && pot !== null ? Number(pot.base_diameter_cm) : NaN;
  const base = Number.isFinite(rawBase) && rawBase > 0 ? rawBase : round1(top * DEFAULT_TAPER);
  return { top, base };
}

/** Suggested next pot top diameter (cm), or null for unusable input. */
export function nextPotDiameter(diameter) {
  const d = Number(diameter);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (d < 15) return d + 2;
  if (d <= 24) return d + 3;
  return d + 4;
}

/**
 * Usable volume of a tapered round pot, in liters.
 * Accepts a top diameter (assumed taper) or top + base diameters.
 */
export function potVolumeLiters(diameter, baseDiameter) {
  const pot = normalizePot(
    baseDiameter === undefined ? diameter : { diameter_cm: diameter, base_diameter_cm: baseDiameter },
  );
  if (!pot) return null;
  const { top, base } = pot;
  const height = top;
  const frustum = (Math.PI * height / 12) * (top ** 2 + top * base + base ** 2);
  return (FILL_FACTOR * frustum) / 1000;
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
 * @param {number|{diameter_cm, base_diameter_cm}} pot current pot
 * @param {Array<{component, ratio}>} recipe effective substrate recipe
 * @returns {{
 *   current: { diameter, baseDiameter, volumeLiters },
 *   next: { diameter, baseDiameter, volumeLiters },
 *   deltaLiters, deltaPercent, substrateLiters,
 *   components: {component, liters}[]
 * } | null}
 */
export function repotPlan(pot, recipe = []) {
  const current = normalizePot(pot);
  if (!current) return null;

  const nextTop = nextPotDiameter(current.top);
  const taper = current.base / current.top;
  const nextBase = round1(nextTop * taper);

  const currentVolume = potVolumeLiters(current.top, current.base);
  const nextVolume = potVolumeLiters(nextTop, nextBase);

  // Root ball retained ≈ 60% of the old pot; never below a quarter of the
  // new pot (bare-rooted repots still need real substrate).
  const substrate = Math.max(nextVolume - 0.6 * currentVolume, nextVolume * 0.25);

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
    current: { diameter: current.top, baseDiameter: current.base, volumeLiters: round1(currentVolume) },
    next: { diameter: nextTop, baseDiameter: nextBase, volumeLiters: round1(nextVolume) },
    deltaLiters: round1(nextVolume - currentVolume),
    deltaPercent: Math.round(((nextVolume - currentVolume) / currentVolume) * 100),
    substrateLiters: round1(substrate),
    components,
  };
}
