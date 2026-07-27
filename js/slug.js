// Plant-id minting, shared by the add-plant form and the cutting flow.
// Ids are permanent foreign keys (events.plantId, parent), so they are
// created once from the name and never change.

export function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Unique id from a name, "-2"-suffixed on collision. */
export function uniquePlantId(name, plantsById) {
  const base = slugify(name) || 'plant';
  let slug = base;
  let n = 2;
  while (plantsById.has(slug)) slug = `${base}-${n++}`;
  return slug;
}
