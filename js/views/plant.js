// Placeholder — replaced by the real view in an upcoming commit.
import { el } from '../ui.js';

export function render(container) {
  container.appendChild(el('div', { class: 'empty-state' }, 'This view sprouts in the next commit.'));
}
