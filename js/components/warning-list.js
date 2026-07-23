// Renders the shared warnings module's output as the panel on Today.

import { el, icon } from '../ui.js';
import { formatWarning } from '../../shared/warnings.js';

const TYPE_ICONS = {
  'watering-overdue': 'water',
  'seasonal-light': 'sun',
  'feeding-resume': 'feeding',
  'feeding-stop': 'feeding',
};

export function warningList(warnings, plantsById) {
  if (!warnings.length) return null;
  return el(
    'div',
    { class: 'warning-list', role: 'list', 'aria-label': 'Warnings' },
    warnings.map((warning) => {
      const plant = warning.plantId ? plantsById.get(warning.plantId) : null;
      return el(
        'div',
        { class: `warning-item warning-item--${warning.severity}`, role: 'listitem' },
        icon(TYPE_ICONS[warning.type] ?? 'alert', 'warning-item__icon'),
        el(
          'div',
          {},
          el('span', {}, formatWarning(warning, plant), ' '),
          plant
            ? el('a', { href: `#/plant/${encodeURIComponent(plant.id)}` }, 'View')
            : null,
        ),
      );
    }),
  );
}
