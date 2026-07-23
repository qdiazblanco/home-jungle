// Effective care = reference (literature) overlaid with the sparse observed
// overrides (what actually works in our house). This is the ONLY place that
// merge happens — the UI, the warnings module and the Phase 2 Action all
// read from here, so reference and observed can never drift apart.
//
// Merge contract:
// - Union of reference and observed keys, skipping "*_note" companions.
// - Key PRESENCE decides the override, never truthiness: an observed `false`
//   or `0` wins over the reference value.
// - Whole-value replacement: arrays and objects replace, they are never
//   deep-merged (an observed substrate recipe fully replaces the reference
//   recipe).
// - Removing an override = deleting the key AND its "_note" sibling from
//   care.observed. Explicit nulls are flagged by validate.js.

function isNoteKey(key) {
  return key.endsWith('_note');
}

/**
 * @returns {{ values: object, fields: object }}
 *   values — effective care parameters, ready for scheduling/warnings.
 *   fields — per-parameter provenance:
 *     { value, source: 'observed'|'reference', reference, observed, note }
 *   so the table's override marker, the profile's side-by-side display and
 *   Phase 2 notification text all read one object.
 */
export function effectiveCare(plant) {
  const reference = plant?.care?.reference ?? {};
  const observed = plant?.care?.observed ?? {};

  const values = {};
  const fields = {};

  const keys = new Set(
    [...Object.keys(reference), ...Object.keys(observed)].filter((k) => !isNoteKey(k)),
  );

  for (const key of keys) {
    const overridden = Object.hasOwn(observed, key) && observed[key] !== null;
    const value = overridden ? observed[key] : reference[key];
    const note = observed[`${key}_note`];

    values[key] = value;
    fields[key] = {
      value,
      source: overridden ? 'observed' : 'reference',
      reference: Object.hasOwn(reference, key) ? reference[key] : undefined,
      observed: overridden ? observed[key] : undefined,
      note: typeof note === 'string' ? note : undefined,
    };
  }

  return { values, fields };
}
