// Shared test fixtures, shaped like the real sample data.

export function makePlant(overrides = {}) {
  return {
    id: 'test-plant',
    name: 'Test plant',
    species: 'Testus plantus',
    nickname: null,
    location: { room: 'Living room', orientation: 'east', detail: '' },
    photo: null,
    acquired: '2024-03-15',
    parent: null,
    care: {
      reference: {
        source: 'Test book',
        light: 'Bright indirect',
        sun_need: 'medium',
        watering_days_summer: 7,
        watering_days_winter: 12,
        humidity: 'Medium',
        feeding: 'Biweekly in spring–summer',
        substrate_recipe: [
          { component: 'Potting mix', ratio: '70%' },
          { component: 'Perlite', ratio: '30%' },
        ],
        toxic_to_pets: false,
      },
      observed: {},
    },
    general_notes: '',
    status: 'active',
    ...overrides,
  };
}

let eventSeq = 0;

export function makeEvent(overrides = {}) {
  eventSeq += 1;
  return {
    id: `ev-${eventSeq}`,
    plantId: 'test-plant',
    type: 'watering',
    date: '2026-07-01T10:00:00',
    author: 'Kike',
    note: null,
    ...overrides,
  };
}
